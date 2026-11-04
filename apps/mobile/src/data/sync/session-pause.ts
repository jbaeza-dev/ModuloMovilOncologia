import type { SqlConnection } from '../local/core/sql';
import type { ClinicalScope } from './clinical-command';

export function isRecoverableSessionPause(code: string | null): boolean {
  return code === 'SESION_EXPIRED' || code === 'SESION_DENIED';
}
export function storedSessionPause(raw: string | null): string | null {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    if (
      value &&
      typeof value === 'object' &&
      'code' in value &&
      typeof value.code === 'string' &&
      isRecoverableSessionPause(value.code)
    )
      return value.code;
  } catch {
    /* Un error dañado requiere revisión, no se borra ni se reintenta automáticamente. */
  }
  return null;
}
export async function retrySessionCommands(
  connection: Pick<SqlConnection, 'run'>,
  scope: ClinicalScope,
) {
  await connection.run(
    `UPDATE qc_clinical_command SET status='pendiente',error_json=NULL
     WHERE owner=? AND environment=? AND status='pausado'
       AND CASE WHEN json_valid(error_json) THEN json_extract(error_json,'$.code') END
           IN ('SESION_EXPIRED','SESION_DENIED')`,
    [scope.owner, scope.environment],
  );
}
