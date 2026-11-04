import type { SqlConnection } from '../../data/local/core/sql';
import { canonical } from '../../data/sync/clinical-command';
import { isSignedPlan, type SignedPlan } from './palliative-plan';
import type { OrientationScope } from './triage-repository';

/** Stores a declaration/attestation, not a patient-editable "verified" flag.
 * A reader must independently verify provenance, trust and crisis applicability. */
export function createPalliativeRepository(db: SqlConnection, scope: OrientationScope) {
  if (!scope.patientId || !scope.environment)
    throw new Error('Falta el contexto del plan individual.');
  return {
    async recordDeclaration(envelope: SignedPlan, recordedAt: string) {
      if (
        !isSignedPlan(envelope) ||
        !Number.isFinite(Date.parse(recordedAt)) ||
        envelope.plan.patientId !== scope.patientId ||
        envelope.plan.environment !== scope.environment
      )
        throw new Error('El plan no corresponde al contexto o su formato es inválido.');
      const content = canonical(envelope);
      await db.transaction(async (tx) => {
        const old = await tx.first<{ content_json: string }>(
          'SELECT content_json FROM qc_palliative_plan_version WHERE id=? AND version=? AND paciente_id=? AND environment=?',
          [envelope.plan.id, envelope.plan.version, scope.patientId, scope.environment],
        );
        if (old) {
          if (old.content_json !== content)
            throw new Error('La versión del plan no se sobrescribe.');
          return;
        }
        await tx.run(
          'INSERT INTO qc_palliative_plan_version(id,version,paciente_id,environment,content_json,recorded_at) VALUES (?,?,?,?,?,?)',
          [
            envelope.plan.id,
            envelope.plan.version,
            scope.patientId,
            scope.environment,
            content,
            recordedAt,
          ],
        );
      });
      return { state: 'DECLARADO_NO_VERIFICADO' as const };
    },
    async get(id: string, version: number): Promise<SignedPlan | null> {
      const row = await db.first<{ content_json: string }>(
        'SELECT content_json FROM qc_palliative_plan_version WHERE id=? AND version=? AND paciente_id=? AND environment=?',
        [id, version, scope.patientId, scope.environment],
      );
      if (!row) return null;
      const value: unknown = JSON.parse(row.content_json);
      if (
        !isSignedPlan(value) ||
        value.plan.patientId !== scope.patientId ||
        value.plan.environment !== scope.environment
      )
        throw new Error('El contenido del plan requiere revisión.');
      return value;
    },
  };
}
