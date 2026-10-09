import type { ClinicalContextBundle } from './clinical-context-types';
import type { SqlConnection } from './sql';

export async function ingestClinicalContextInTransaction(
  tx: SqlConnection,
  bundle: ClinicalContextBundle,
  now: () => string = () => new Date().toISOString(),
): Promise<void> {
  const timestamp = now();

  // 1. Fichas clínicas
  if (bundle.fichas) {
    for (const f of bundle.fichas) {
      await tx.run(
        `INSERT INTO ficha_clinica_cache (ficha_id, paciente_id, obtenido_en)
         VALUES (?, ?, ?)
         ON CONFLICT (ficha_id) DO UPDATE SET
           paciente_id = excluded.paciente_id,
           obtenido_en = excluded.obtenido_en`,
        [f.fichaId, f.pacienteId, f.obtenidoEn ?? timestamp],
      );
    }
  }

  // 2. Profesionales médicos
  if (bundle.profesionales) {
    for (const p of bundle.profesionales) {
      await tx.run(
        `INSERT INTO profesional_medico_cache (id, nombre, especialidad, email, obtenido_en)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           nombre = excluded.nombre,
           especialidad = excluded.especialidad,
           email = excluded.email,
           obtenido_en = excluded.obtenido_en`,
        [p.id, p.nombre, p.especialidad, p.email ?? null, p.obtenidoEn ?? timestamp],
      );
    }
  }

  // 3. Vínculos paciente-profesional
  if (bundle.vinculos) {
    for (const v of bundle.vinculos) {
      await tx.run(
        `INSERT INTO paciente_clinico_cache (
           id, paciente_id, profesional_id, estado_conocido, fecha_vinculacion, codigo_origen, obtenido_en
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           estado_conocido = excluded.estado_conocido,
           fecha_vinculacion = excluded.fecha_vinculacion,
           codigo_origen = excluded.codigo_origen,
           obtenido_en = excluded.obtenido_en`,
        [
          v.id,
          v.pacienteId,
          v.profesionalId,
          v.estadoConocido,
          v.fechaVinculacion,
          v.codigoOrigen ?? null,
          v.obtenidoEn ?? timestamp,
        ],
      );
    }
  }

  // 4. Medicamentos
  if (bundle.medicamentos) {
    for (const m of bundle.medicamentos) {
      const activeInt =
        typeof m.estadoActivo === 'boolean' ? (m.estadoActivo ? 1 : 0) : (m.estadoActivo ?? 1);
      await tx.run(
        `INSERT INTO medicamento_activo_cache (
           id, paciente_id, ficha_id, nombre, dosis, frecuencia, fecha_inicio, fecha_fin, estado_activo, obtenido_en
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           paciente_id = excluded.paciente_id,
           ficha_id = excluded.ficha_id,
           nombre = excluded.nombre,
           dosis = excluded.dosis,
           frecuencia = excluded.frecuencia,
           fecha_inicio = excluded.fecha_inicio,
           fecha_fin = excluded.fecha_fin,
           estado_activo = excluded.estado_activo,
           obtenido_en = excluded.obtenido_en`,
        [
          m.id,
          m.pacienteId,
          m.fichaId ?? null,
          m.nombre,
          m.dosis,
          m.frecuencia,
          m.fechaInicio ?? null,
          m.fechaFin ?? null,
          activeInt,
          m.obtenidoEn ?? timestamp,
        ],
      );
    }
  }
}

export async function ingestClinicalContextBundle(
  database: SqlConnection,
  bundle: ClinicalContextBundle,
  now: () => string = () => new Date().toISOString(),
): Promise<void> {
  await database.transaction(async (tx) => {
    await ingestClinicalContextInTransaction(tx, bundle, now);
  });
}
