import type {
  ConsentEventRecord,
  ConsentStatusInfo,
  TermDefinitionRecord,
  UserConsentRecord,
} from './consent-types';
import type { SqlConnection } from '../core/sql';

export function createConsentRepository(
  database: SqlConnection,
  patientId: string,
  newId: () => string = () => {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    return 'gen-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  },
  now: () => string = () => new Date().toISOString(),
) {
  return {
    async listTerms(): Promise<TermDefinitionRecord[]> {
      return database.all<TermDefinitionRecord>(
        'SELECT * FROM definicion_terminos_cache ORDER BY titulo ASC, version ASC',
      );
    },

    async getTerm(terminoId: string, version: string): Promise<TermDefinitionRecord | null> {
      return (
        (await database.first<TermDefinitionRecord>(
          'SELECT * FROM definicion_terminos_cache WHERE termino_id = ? AND version = ?',
          [terminoId, version],
        )) ?? null
      );
    },

    async getActiveConsent(terminoId: string, version: string): Promise<UserConsentRecord | null> {
      return (
        (await database.first<UserConsentRecord>(
          `SELECT * FROM consentimiento_usuario
           WHERE paciente_id = ? AND termino_id = ? AND version = ? AND estado = 'otorgado'`,
          [patientId, terminoId, version],
        )) ?? null
      );
    },

    async getConsentStatus(terminoId: string, version: string): Promise<ConsentStatusInfo> {
      // 1. Obtener el evento de mayor secuencia causal para este término y versión del paciente activo
      const lastEvent = await database.first<ConsentEventRecord>(
        `SELECT * FROM evento_consentimiento
         WHERE paciente_id = ? AND termino_id = ? AND version = ?
         ORDER BY secuencia DESC
         LIMIT 1`,
        [patientId, terminoId, version],
      );

      if (!lastEvent) {
        return {
          terminoId,
          version,
          estado: 'nunca_otorgado',
          activeConsent: null,
          lastConsent: null,
          lastEvent: null,
        };
      }

      // 2. Obtener el consentimiento asociado a ese evento de mayor secuencia
      const lastConsent = await database.first<UserConsentRecord>(
        `SELECT * FROM consentimiento_usuario
         WHERE id = ? AND paciente_id = ?`,
        [lastEvent.consentimiento_id, patientId],
      );

      if (lastEvent.accion === 'otorgado') {
        return {
          terminoId,
          version,
          estado: 'otorgado',
          activeConsent: lastConsent ?? null,
          lastConsent: lastConsent ?? null,
          lastEvent,
        };
      }

      return {
        terminoId,
        version,
        estado: 'revocado',
        activeConsent: null,
        lastConsent: lastConsent ?? null,
        lastEvent,
      };
    },

    async grantConsent(
      terminoId: string,
      version: string,
    ): Promise<{ consentId: string; eventId: string }> {
      let result: { consentId: string; eventId: string } | undefined;
      await database.transaction(async (tx) => {
        const currentTime = now();
        const currentTimeMs = Date.parse(currentTime);

        // 1. Validar existencia y vigencia de términos dentro de la transacción
        const term = await tx.first<TermDefinitionRecord>(
          'SELECT * FROM definicion_terminos_cache WHERE termino_id = ? AND version = ?',
          [terminoId, version],
        );
        if (!term) {
          throw new Error(`No existe la definición de términos '${terminoId}' v${version}.`);
        }

        const desdeMs = Date.parse(term.vigente_desde);
        const hastaMs = term.vigente_hasta ? Date.parse(term.vigente_hasta) : null;

        if (
          isNaN(desdeMs) ||
          currentTimeMs < desdeMs ||
          (hastaMs !== null && (!isNaN(hastaMs) ? currentTimeMs > hastaMs : true))
        ) {
          throw new Error(
            `La versión '${version}' de '${terminoId}' no se encuentra vigente para su aceptación.`,
          );
        }

        // 2. Comprobar si ya existe un consentimiento activo (idempotente)
        const activeConsent = await tx.first<UserConsentRecord>(
          `SELECT * FROM consentimiento_usuario
           WHERE paciente_id = ? AND termino_id = ? AND version = ? AND estado = 'otorgado'`,
          [patientId, terminoId, version],
        );
        if (activeConsent) {
          const lastEv = await tx.first<ConsentEventRecord>(
            `SELECT * FROM evento_consentimiento
             WHERE consentimiento_id = ? AND accion = 'otorgado'
             ORDER BY secuencia DESC LIMIT 1`,
            [activeConsent.id],
          );
          result = { consentId: activeConsent.id, eventId: lastEv?.id ?? activeConsent.id };
          return;
        }

        // 3. Generar identificadores y siguiente secuencia local por paciente
        const consentId = newId();
        const eventId = newId();
        const queueId = newId();

        const seqRow = await tx.first<{ next_seq: number }>(
          'SELECT coalesce(max(secuencia), 0) + 1 AS next_seq FROM evento_consentimiento WHERE paciente_id = ?',
          [patientId],
        );
        const secuencia = seqRow?.next_seq ?? 1;

        // 4. Inserción de consentimiento_usuario
        await tx.run(
          `INSERT INTO consentimiento_usuario (
             id, paciente_id, termino_id, version, estado, fecha_otorgamiento, fecha_revocacion, creado_en
           ) VALUES (?, ?, ?, ?, 'otorgado', ?, NULL, ?)`,
          [consentId, patientId, terminoId, version, currentTime, currentTime],
        );

        // 5. Inserción de evento_consentimiento
        await tx.run(
          `INSERT INTO evento_consentimiento (
             id, paciente_id, consentimiento_id, termino_id, version, secuencia, accion, fecha_evento
           ) VALUES (?, ?, ?, ?, ?, ?, 'otorgado', ?)`,
          [eventId, patientId, consentId, terminoId, version, secuencia, currentTime],
        );

        // 6. Inserción en cola_envio
        const payloadJson = JSON.stringify({
          schemaVersion: 1,
          entity: 'evento_consentimiento',
          record: {
            id: eventId,
            consentimiento_id: consentId,
            paciente_id: patientId,
            termino_id: terminoId,
            version,
            secuencia,
            accion: 'otorgado',
            fecha_evento: currentTime,
          },
        });

        await tx.run(
          `INSERT INTO cola_envio (
             id, paciente_id, tipo_entidad, registro_id, payload_json, estado, creado_en, actualizado_en
           ) VALUES (?, ?, 'evento_consentimiento', ?, ?, 'pendiente', ?, ?)`,
          [queueId, patientId, eventId, payloadJson, currentTime, currentTime],
        );

        result = { consentId, eventId };
      });
      return result!;
    },

    async revokeConsent(consentId: string): Promise<{ eventId: string } | null> {
      let result: { eventId: string } | undefined;
      await database.transaction(async (tx) => {
        const currentTime = now();

        // 1. Validar pertenencia del consentimiento al paciente activo
        const consent = await tx.first<UserConsentRecord>(
          'SELECT * FROM consentimiento_usuario WHERE id = ? AND paciente_id = ?',
          [consentId, patientId],
        );
        if (!consent) {
          throw new Error('Consentimiento no encontrado o no pertenece al paciente activo.');
        }

        // 2. Si ya está revocado, retornar de forma idempotente
        if (consent.estado === 'revocado') {
          const lastRevEvent = await tx.first<ConsentEventRecord>(
            `SELECT * FROM evento_consentimiento
             WHERE consentimiento_id = ? AND accion = 'revocado'
             ORDER BY secuencia DESC LIMIT 1`,
            [consentId],
          );
          result = { eventId: lastRevEvent?.id ?? '' };
          return;
        }

        // 3. Generar nuevo UUID para el evento de revocación y cola
        const eventId = newId();
        const queueId = newId();

        const seqRow = await tx.first<{ next_seq: number }>(
          'SELECT coalesce(max(secuencia), 0) + 1 AS next_seq FROM evento_consentimiento WHERE paciente_id = ?',
          [patientId],
        );
        const secuencia = seqRow?.next_seq ?? 1;

        // 4. Actualizar estado del consentimiento a revocado
        await tx.run(
          "UPDATE consentimiento_usuario SET estado = 'revocado', fecha_revocacion = ? WHERE id = ?",
          [currentTime, consentId],
        );

        // 5. Insertar evento de revocación con nueva secuencia
        await tx.run(
          `INSERT INTO evento_consentimiento (
             id, paciente_id, consentimiento_id, termino_id, version, secuencia, accion, fecha_evento
           ) VALUES (?, ?, ?, ?, ?, ?, 'revocado', ?)`,
          [
            eventId,
            patientId,
            consentId,
            consent.termino_id,
            consent.version,
            secuencia,
            currentTime,
          ],
        );

        // 6. Insertar en cola_envio
        const payloadJson = JSON.stringify({
          schemaVersion: 1,
          entity: 'evento_consentimiento',
          record: {
            id: eventId,
            consentimiento_id: consentId,
            paciente_id: patientId,
            termino_id: consent.termino_id,
            version: consent.version,
            secuencia,
            accion: 'revocado',
            fecha_evento: currentTime,
          },
        });

        await tx.run(
          `INSERT INTO cola_envio (
             id, paciente_id, tipo_entidad, registro_id, payload_json, estado, creado_en, actualizado_en
           ) VALUES (?, ?, 'evento_consentimiento', ?, ?, 'pendiente', ?, ?)`,
          [queueId, patientId, eventId, payloadJson, currentTime, currentTime],
        );

        result = { eventId };
      });
      return result!;
    },

    async listConsentHistory(
      terminoId?: string,
      version?: string,
    ): Promise<
      Array<
        ConsentEventRecord & {
          termino_titulo: string;
        }
      >
    > {
      const sql = `
        SELECT e.*, t.titulo AS termino_titulo
        FROM evento_consentimiento e
        JOIN definicion_terminos_cache t ON e.termino_id = t.termino_id AND e.version = t.version
        WHERE e.paciente_id = ?
        ${terminoId ? 'AND e.termino_id = ?' : ''}
        ${version ? 'AND e.version = ?' : ''}
        ORDER BY e.secuencia DESC
      `;
      const params: string[] = [patientId];
      if (terminoId) params.push(terminoId);
      if (version) params.push(version);
      return database.all<ConsentEventRecord & { termino_titulo: string }>(sql, params);
    },
  };
}
