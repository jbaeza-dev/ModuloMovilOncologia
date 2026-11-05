import { storedSessionPause } from './session-pause';
import type {
  CrudEntry,
  CrudTransaction,
  PowerSyncBackendConnector,
  PowerSyncCredentials,
  CommonPowerSyncDatabase,
} from '@powersync/common';
import type { SqlConnection } from '../local/core/sql';
import type { HttpSessionAdapter } from '../../services/session/http-session-adapter';
import { SessionFailure } from '../../services/session/http-session-types';
import { canonical, payloadOf, type ClinicalCommand, type ClinicalScope } from './clinical-command';
import { coherentAck, classifyClinicalError } from './ack';
import { pruneSynchronizedRecords } from './local-retention';

export class ClinicalUploadPaused extends Error {
  constructor(readonly code: string) {
    super('Subida clínica pausada: ' + code);
    this.name = 'ClinicalUploadPaused';
  }
}
type Session = Pick<
  HttpSessionAdapter,
  'getCurrentUser' | 'credentialsForSync' | 'getContextSignal' | 'request'
>;
export class ClinicalConnector implements PowerSyncBackendConnector {
  private readonly signal: AbortSignal;
  constructor(
    private readonly scope: ClinicalScope,
    private readonly endpoint: string,
    private readonly session: Session,
    private readonly local: SqlConnection,
    private readonly onPause: (code: string) => void,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.signal = session.getContextSignal();
  }
  private assertOwner() {
    if (this.session.getCurrentUser()?.id !== this.scope.owner || this.signal.aborted)
      throw new ClinicalUploadPaused('CONTEXTO_CAMBIADO');
  }
  async fetchCredentials(): Promise<PowerSyncCredentials> {
    this.assertOwner();
    try {
      const credentials = await this.session.credentialsForSync();
      this.assertOwner();
      if (credentials.owner !== this.scope.owner || credentials.signal.aborted)
        throw new ClinicalUploadPaused('CONTEXTO_CAMBIADO');
      return {
        endpoint: this.endpoint,
        token: credentials.token,
        expiresAt: credentials.expiresAt,
      };
    } catch (error) {
      if (error instanceof SessionFailure && error.kind !== 'unavailable' && !this.signal.aborted)
        this.onPause('SESION_' + error.kind.toUpperCase());
      throw error;
    }
  }
  async uploadData(database: CommonPowerSyncDatabase): Promise<void> {
    this.assertOwner();
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;
    try {
      await this.uploadTransaction(transaction);
    } catch (error) {
      if (error instanceof ClinicalUploadPaused) this.onPause(error.code);
      throw error;
    }
  }
  async uploadTransaction(transaction: Pick<CrudTransaction, 'crud' | 'complete'>): Promise<void> {
    for (const operation of transaction.crud) await this.uploadOperation(operation);
    this.assertOwner();
    // ACK/rejection is durable before removing any SDK operation, including partial batches.
    await transaction.complete();
  }
  private async pause(command: ClinicalCommand, code: string, details: unknown): Promise<never> {
    await this.local.run(
      `UPDATE qc_clinical_command SET status = 'pausado', error_json = ?, updated_at = ? WHERE id = ? AND owner = ?`,
      [canonical({ code, details }), this.now(), command.id, this.scope.owner],
    );
    throw new ClinicalUploadPaused(code);
  }
  private async uploadOperation(operation: CrudEntry) {
    this.assertOwner();
    const kind =
      operation.table === 'qc_upload_signos'
        ? 'signos'
        : operation.table === 'qc_upload_epro'
          ? 'epro'
          : null;
    if (!kind || operation.op !== 'PUT' || !operation.opData)
      throw new ClinicalUploadPaused('COMANDO_SDK_NO_PERMITIDO');
    const command = await this.local.first<ClinicalCommand>(
      'SELECT * FROM qc_clinical_command WHERE id = ?',
      [operation.id],
    );
    if (
      !command ||
      command.owner !== this.scope.owner ||
      command.environment !== this.scope.environment ||
      command.kind !== kind
    )
      throw new ClinicalUploadPaused('PROPIETARIO_O_SNAPSHOT_INCORRECTO');
    const expected = {
      owner: command.owner,
      environment: command.environment,
      captured_at: command.captured_at,
      payload_json: command.payload_json,
      legacy_queue_id: command.legacy_queue_id,
    };
    if (
      canonical({
        ...operation.opData,
        legacy_queue_id: operation.opData.legacy_queue_id ?? null,
      }) !== canonical(expected)
    )
      await this.pause(command, 'SNAPSHOT_SDK_INCOHERENTE', null);
    if (command.status === 'rechazado') {
      if (!command.error_json) await this.pause(command, 'RECHAZO_LOCAL_INCOMPLETO', null);
      return;
    }
    let body: Record<string, unknown>;
    try {
      body = payloadOf(command);
    } catch {
      return this.pause(command, 'SNAPSHOT_FUERA_CONTRATO', null);
    }

    if (command.status === 'aceptado') {
      const saved: unknown = JSON.parse(command.ack_json ?? 'null');
      if (
        !saved ||
        typeof saved !== 'object' ||
        !('status' in saved) ||
        !('body' in saved) ||
        !coherentAck(command, Number(saved.status), saved.body)
      )
        await this.pause(command, 'ACK_LOCAL_INCOHERENTE', null);
      return;
    }
    if (command.status === 'pausado')
      throw new ClinicalUploadPaused(storedSessionPause(command.error_json) ?? 'REQUIERE_REVISION');
    try {
      await this.session.credentialsForSync();
    } catch (error) {
      this.assertOwner();
      if (error instanceof SessionFailure && error.kind !== 'unavailable')
        await this.pause(command, 'SESION_' + error.kind.toUpperCase(), null);
      throw error;
    }
    this.assertOwner();
    await this.local.run(
      'UPDATE qc_clinical_command SET attempts = attempts + 1, updated_at = ? WHERE id = ? AND owner = ?',
      [this.now(), command.id, this.scope.owner],
    );
    const request = { ...body };
    if (kind === 'epro') {
      delete request.formulario_id;
      delete request.formulario_version;
      delete request.question_codes;
    }
    let response: { status: number; body: unknown };
    try {
      response = await this.session.request(
        'clinical',
        kind === 'signos'
          ? '/api/v1/pacientes/me/signos-vitales'
          : '/api/v1/formularios/' + String(body.formulario_id) + '/respuestas',
        'POST',
        request,
      );
    } catch (error) {
      this.assertOwner();
      if (error instanceof SessionFailure && error.kind !== 'unavailable')
        await this.pause(command, 'SESION_' + error.kind.toUpperCase(), null);
      throw error;
    }
    this.assertOwner();
    if (response.status >= 200 && response.status < 300) {
      if (!coherentAck(command, response.status, response.body))
        await this.pause(command, 'ACK_REMOTO_INCOHERENTE', null);
      await this.local.transaction(async (tx) => {
        await tx.run(
          `UPDATE qc_clinical_command SET status = 'aceptado', ack_json = ?, error_json = NULL, updated_at = ? WHERE id = ? AND owner = ?`,
          [canonical(response), this.now(), command.id, this.scope.owner],
        );
        if (command.legacy_queue_id)
          await tx.run(
            `UPDATE cola_envio SET estado = 'enviado', enviado_en = ?, actualizado_en = ?, ultimo_error_codigo = NULL WHERE id = ? AND paciente_id = ?`,
            [this.now(), this.now(), command.legacy_queue_id, this.scope.localPatientId],
          );

        if (kind === 'signos')
          await tx.run(
            'UPDATE signos_vitales SET fecha_subida = ? WHERE id = ? AND paciente_id = ?',
            [this.now(), command.id, this.scope.localPatientId],
          );

        await pruneSynchronizedRecords(tx, this.scope.localPatientId, this.scope.owner, kind);
      });
      return;
    }
    const decision = classifyClinicalError(response.status, response.body);
    if (decision.decision === 'retry')
      throw new Error('Dependencia clínica temporalmente no disponible.');
    if (decision.decision === 'pause') await this.pause(command, decision.code, response);
    await this.local.transaction(async (tx) => {
      await tx.run(
        `UPDATE qc_clinical_command SET status = 'rechazado', error_json = ?, updated_at = ? WHERE id = ? AND owner = ?`,
        [
          canonical({ code: decision.code, response, snapshot: body }),
          this.now(),
          command.id,
          this.scope.owner,
        ],
      );
      if (command.legacy_queue_id)
        await tx.run(
          `UPDATE cola_envio SET estado = 'conflicto', actualizado_en = ?, ultimo_error_codigo = ? WHERE id = ? AND paciente_id = ?`,
          [this.now(), decision.code, command.legacy_queue_id, this.scope.localPatientId],
        );
    });
  }
}
