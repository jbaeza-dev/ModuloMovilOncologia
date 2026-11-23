import type { SqlConnection } from '../local/core/sql';
import {
  canonical,
  type ClinicalCommand,
  type ClinicalKind,
  type ClinicalScope,
} from './clinical-command';
import { storedSessionPause } from './session-pause';

/** Código guardado cuando el paciente decide no reenviar un registro apartado. */
export const KEPT_ON_PHONE = 'CONSERVADO_EN_TELEFONO';

/** Estado visible derivado de un comando: distingue «conservado en el teléfono» de un rechazo. */
export const KEPT_VISIBLE_STATUS = 'conservado_local';

/** Subconsulta SQL con el estado visible del comando cuyo id es `idColumn`. */
export function visibleCommandStatusSql(idColumn: string): string {
  return `(SELECT CASE WHEN status='rechazado' AND CASE WHEN json_valid(error_json) THEN json_extract(error_json,'$.code') END='${KEPT_ON_PHONE}' THEN '${KEPT_VISIBLE_STATUS}' ELSE status END FROM qc_clinical_command WHERE id=${idColumn})`;
}

export interface SetAsideRecord {
  id: string;
  kind: ClinicalKind;
  capturedAt: string;
  code: string;
}

function errorCode(raw: string | null): string {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    if (value && typeof value === 'object' && 'code' in value && typeof value.code === 'string')
      return value.code;
  } catch {
    /* Un motivo dañado se presenta como no clasificado; el registro se conserva igual. */
  }
  return 'ERROR_NO_CLASIFICADO';
}

/** Un comando está apartado cuando quedó pausado por un error técnico y no por la sesión. */
export function isSetAside(command: Pick<ClinicalCommand, 'status' | 'error_json'>): boolean {
  return command.status === 'pausado' && storedSessionPause(command.error_json) === null;
}

/** Marca de «conservado solo en este teléfono» dentro de un comando rechazado. */
export function isKeptOnPhone(command: Pick<ClinicalCommand, 'status' | 'error_json'>): boolean {
  return command.status === 'rechazado' && errorCode(command.error_json) === KEPT_ON_PHONE;
}

/** Registros apartados del dueño y entorno activos, sin datos clínicos. */
export async function listSetAside(
  connection: Pick<SqlConnection, 'all'>,
  scope: ClinicalScope,
): Promise<SetAsideRecord[]> {
  const rows = await connection.all<ClinicalCommand>(
    `SELECT * FROM qc_clinical_command WHERE owner=? AND environment=? AND status='pausado' ORDER BY captured_at, id`,
    [scope.owner, scope.environment],
  );
  return rows.filter(isSetAside).map((row) => ({
    id: row.id,
    kind: row.kind,
    capturedAt: row.captured_at,
    code: errorCode(row.error_json),
  }));
}

async function ownedSetAside(tx: SqlConnection, scope: ClinicalScope, id: string) {
  const row = await tx.first<ClinicalCommand>(
    'SELECT * FROM qc_clinical_command WHERE id=? AND owner=? AND environment=?',
    [id, scope.owner, scope.environment],
  );
  if (!row || !isSetAside(row)) throw new Error('El registro ya no está apartado.');
  return row;
}

/**
 * Devuelve el registro a la cola del SDK con su mismo UUID, fecha y contenido. El servidor
 * reconoce el UUID, así que un reenvío de algo que ya había llegado no crea un duplicado.
 */
export async function retrySetAside(
  connection: SqlConnection,
  scope: ClinicalScope,
  id: string,
  now = new Date().toISOString(),
): Promise<void> {
  await connection.transaction(async (tx) => {
    const row = await ownedSetAside(tx, scope, id);
    await tx.run(
      `UPDATE qc_clinical_command SET status='pendiente', error_json=NULL, updated_at=? WHERE id=? AND owner=?`,
      [now, row.id, scope.owner],
    );
    const table = row.kind === 'signos' ? 'qc_upload_signos' : 'qc_upload_epro';
    await tx.run(
      `INSERT INTO ${table}(id, owner, environment, captured_at, payload_json, legacy_queue_id) VALUES (?, ?, ?, ?, ?, ?)`,
      [row.id, row.owner, row.environment, row.captured_at, row.payload_json, row.legacy_queue_id],
    );
  });
}

/** Reintenta todos los registros apartados del dueño y entorno activos. */
export async function retryAllSetAside(
  connection: SqlConnection,
  scope: ClinicalScope,
  now = new Date().toISOString(),
): Promise<number> {
  const records = await listSetAside(connection, scope);
  for (const record of records) await retrySetAside(connection, scope, record.id, now);
  return records.length;
}

/** El paciente decide no reenviarlo: queda en el historial como no enviado, sin borrarse. */
export async function keepSetAsideOnPhone(
  connection: SqlConnection,
  scope: ClinicalScope,
  id: string,
  now = new Date().toISOString(),
): Promise<void> {
  await connection.transaction(async (tx) => {
    const row = await ownedSetAside(tx, scope, id);
    await tx.run(
      `UPDATE qc_clinical_command SET status='rechazado', error_json=?, updated_at=? WHERE id=? AND owner=?`,
      [
        canonical({ code: KEPT_ON_PHONE, previo: errorCode(row.error_json) }),
        now,
        row.id,
        scope.owner,
      ],
    );
  });
}
