import type { PlanAssessment } from './palliative-plan';
import type { SqlConnection } from '../../data/local/core/sql';
import { canonical } from '../../data/sync/clinical-command';
import { proposal, questions } from './triage-definition';
import { evaluateOrientation, type OrientationInput } from './triage-engine';

export interface OrientationScope {
  patientId: string;
  environment: string;
}
export function createOrientationRepository(
  db: SqlConnection,
  scope: OrientationScope,
  resolveIndividualPlan?: (
    scope: OrientationScope,
    input: OrientationInput,
  ) => Promise<PlanAssessment>,
) {
  if (!scope.patientId || !scope.environment) throw new Error('Falta el contexto de orientación.');
  const parameters = [scope.patientId, scope.environment];
  return {
    async save(
      id: string,
      input: OrientationInput,
      mode: 'synthetic' | 'clinical',
      createdAt: string,
      previousId: string | null = null,
    ) {
      if (!id || !Number.isFinite(Date.parse(createdAt)))
        throw new Error('Registro de orientación inválido.');
      const plan = resolveIndividualPlan ? await resolveIndividualPlan(scope, input) : null;
      const result = evaluateOrientation(input, mode, proposal, plan ? { scope, plan } : undefined);
      if (result.availability !== 'evaluated')
        throw new Error('La orientación clínica no está habilitada.');
      const snapshot = canonical({
        input,
        result,
        definition: { ...proposal, questions },
        sourceHash: proposal.sourceHash,
      });
      await db.transaction(async (tx) => {
        if (
          previousId &&
          !(await tx.first(
            'SELECT id FROM qc_orientation_snapshot WHERE id=? AND paciente_id=? AND environment=? AND mode=?',
            [previousId, ...parameters, mode],
          ))
        )
          throw new Error('El antecedente no pertenece a esta evaluación.');
        const old = await tx.first<{
          paciente_id: string;
          environment: string;
          snapshot_json: string;
          created_at: string;
          previous_id: string | null;
        }>('SELECT * FROM qc_orientation_snapshot WHERE id=?', [id]);
        if (old) {
          if (
            old.paciente_id !== scope.patientId ||
            old.environment !== scope.environment ||
            old.snapshot_json !== snapshot ||
            old.created_at !== createdAt ||
            old.previous_id !== previousId
          )
            throw new Error('El UUID ya identifica otra evaluación.');
          return;
        }
        await tx.run(
          `INSERT INTO qc_orientation_snapshot(id,paciente_id,environment,definition_version,definition_status,mode,created_at,previous_id,snapshot_json) VALUES (?,?,?,?,?,?,?,?,?)`,
          [
            id,
            ...parameters,
            proposal.version,
            proposal.status,
            mode,
            createdAt,
            previousId,
            snapshot,
          ],
        );
      });
      return result;
    },
    async history(mode: 'synthetic' | 'clinical', limit = 30, offset = 0) {
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100 ||
        !Number.isSafeInteger(offset) ||
        offset < 0
      )
        throw new Error('Página de historial inválida.');
      return db.all<{
        id: string;
        created_at: string;
        definition_version: string;
        snapshot_json: string;
      }>(
        'SELECT id,created_at,definition_version,snapshot_json FROM qc_orientation_snapshot WHERE paciente_id=? AND environment=? AND mode=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?',
        [...parameters, mode, limit, offset],
      );
    },
  };
}
