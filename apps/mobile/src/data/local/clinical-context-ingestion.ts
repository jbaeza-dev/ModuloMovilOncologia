import { ConflictoIdentidadError, type ClinicalContextBundle } from './clinical-context-types';
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
      const existing = await tx.first<{ paciente_id: string }>(
        'SELECT paciente_id FROM ficha_clinica_cache WHERE ficha_id = ?',
        [f.fichaId],
      );
      if (existing && existing.paciente_id !== f.pacienteId) {
        throw new ConflictoIdentidadError(
          `Conflicto de identidad: la ficha clínica '${f.fichaId}' ya pertenece a otro paciente.`,
        );
      }

      await tx.run(
        `INSERT INTO ficha_clinica_cache (ficha_id, paciente_id, obtenido_en)
         VALUES (?, ?, ?)
         ON CONFLICT (ficha_id) DO UPDATE SET
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
      const existing = await tx.first<{
        paciente_id: string;
        profesional_id: string;
        estado_conocido: 'activo' | 'inactivo' | 'revocado';
      }>(
        'SELECT paciente_id, profesional_id, estado_conocido FROM paciente_clinico_cache WHERE id = ?',
        [v.id],
      );

      if (existing) {
        if (existing.paciente_id !== v.pacienteId || existing.profesional_id !== v.profesionalId) {
          throw new ConflictoIdentidadError(
            `Conflicto de identidad: el vínculo '${v.id}' ya existe con paciente o profesional diferente.`,
          );
        }
      }

      const finalEstado =
        v.estadoConocido !== undefined
          ? v.estadoConocido
          : existing
            ? existing.estado_conocido
            : 'activo';

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
          finalEstado,
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
      const existing = await tx.first<{
        paciente_id: string;
        ficha_id: string | null;
        estado_activo: number;
      }>('SELECT paciente_id, ficha_id, estado_activo FROM medicamento_activo_cache WHERE id = ?', [
        m.id,
      ]);

      if (existing) {
        const targetFicha = m.fichaId ?? null;
        if (
          existing.paciente_id !== m.pacienteId ||
          (targetFicha !== null && existing.ficha_id !== targetFicha)
        ) {
          throw new ConflictoIdentidadError(
            `Conflicto de identidad: el medicamento '${m.id}' ya pertenece a otro paciente o ficha.`,
          );
        }
      }

      let activeInt: number;
      if (m.estadoActivo !== undefined) {
        activeInt = typeof m.estadoActivo === 'boolean' ? (m.estadoActivo ? 1 : 0) : m.estadoActivo;
      } else if (existing) {
        // Conservar estado anterior cuando se omite en una actualización
        activeInt = existing.estado_activo;
      } else {
        // Valor predeterminado únicamente para registros nuevos
        activeInt = 1;
      }

      await tx.run(
        `INSERT INTO medicamento_activo_cache (
           id, paciente_id, ficha_id, nombre, dosis, frecuencia, fecha_inicio, fecha_fin, estado_activo, obtenido_en
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
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
