import type {
  ActiveMedicationRecord,
  AssignedProfessional,
  ClinicalFileRecord,
} from './clinical-context-types';
import type { SqlConnection } from './sql';

export function createClinicalContextRepository(database: SqlConnection, patientId: string) {
  return {
    async clinicalFile(): Promise<ClinicalFileRecord | null> {
      return (
        (await database.first<ClinicalFileRecord>(
          'SELECT * FROM ficha_clinica_cache WHERE paciente_id = ?',
          [patientId],
        )) ?? null
      );
    },

    async activeMedications(): Promise<ActiveMedicationRecord[]> {
      return database.all<ActiveMedicationRecord>(
        `SELECT * FROM medicamento_activo_cache
         WHERE paciente_id = ? AND estado_activo = 1
         ORDER BY fecha_inicio DESC, id ASC`,
        [patientId],
      );
    },

    async assignedMedicalTeam(): Promise<AssignedProfessional[]> {
      return database.all<AssignedProfessional>(
        `SELECT
           p.id,
           p.nombre,
           p.especialidad,
           p.email,
           pc.fecha_vinculacion,
           pc.estado_conocido AS estado_vinculo,
           p.obtenido_en
         FROM paciente_clinico_cache pc
         JOIN profesional_medico_cache p ON pc.profesional_id = p.id
         WHERE pc.paciente_id = ? AND pc.estado_conocido = 'activo'
         ORDER BY p.nombre ASC, p.id ASC`,
        [patientId],
      );
    },
  };
}
