import {
  deriveConditionsVersion,
  validateFormDefinition,
  type FormQuestion,
} from '@quimiocare/contracts/forms';
import { eligibleEducation, assertEducationRevisions } from './education-catalog';
import type { CommonPowerSyncDatabase } from '@powersync/common';
import type { SqlConnection } from '../local/core/sql';
import { object, isUuid } from '../../services/session/response-checks';
import { canonical } from './clinical-command';

export interface DefinitionSnapshot {
  form: Record<string, unknown>;
  questions: Record<string, unknown>[];
}
const json = (value: unknown): unknown => (typeof value === 'string' ? JSON.parse(value) : value);
const boolean = (value: unknown) => {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  throw new Error('Booleano de catálogo inválido.');
};
export function completeDefinition(
  form: Record<string, unknown>,
  rows: Record<string, unknown>[],
): DefinitionSnapshot {
  if (
    !isUuid(form.id) ||
    typeof form.codigo !== 'string' ||
    typeof form.titulo !== 'string' ||
    !Number.isInteger(form.version) ||
    Number(form.version) < 1 ||
    form.tratamiento !== 'quimioterapia' ||
    boolean(form.eliminado)
  )
    throw new Error('Edición no publicada.');
  const configuration = json(form.configuracion);
  if (!object(configuration) || rows.length === 0)
    throw new Error('La definición está incompleta.');
  const ids = new Set<string>(),
    codes = new Set<string>();
  const questions = rows
    .map<
      Record<string, unknown> & {
        configuracion: Record<string, unknown>;
        opciones: unknown[];
        requerida: boolean;
        eliminado: boolean;
      }
    >((row) => {
      const parsedOptions = json(row.opciones),
        config = json(row.configuracion);
      const options =
        parsedOptions === null && !['opcion_unica', 'opcion_multiple'].includes(String(row.tipo))
          ? []
          : parsedOptions;
      if (
        !isUuid(row.id) ||
        row.formulario_id !== form.id ||
        typeof row.codigo !== 'string' ||
        !row.codigo ||
        ids.has(row.id) ||
        codes.has(row.codigo) ||
        !Number.isInteger(row.orden) ||
        Number(row.orden) < 0 ||
        ![
          'texto_libre',
          'numerico',
          'opcion_unica',
          'opcion_multiple',
          'escala_likert',
          'booleano',
        ].includes(String(row.tipo)) ||
        !object(config) ||
        !Array.isArray(options) ||
        boolean(row.eliminado)
      )
        throw new Error('Pregunta incompleta o incoherente.');
      ids.add(row.id);
      codes.add(row.codigo);
      const optionCodes = options.map((option) => {
        if (
          !object(option) ||
          typeof option.codigo !== 'string' ||
          !option.codigo ||
          typeof option.etiqueta !== 'string'
        )
          throw new Error('Opciones de pregunta inválidas.');
        return option.codigo;
      });
      if (
        new Set(optionCodes).size !== optionCodes.length ||
        (['opcion_unica', 'opcion_multiple', 'escala_likert'].includes(String(row.tipo)) &&
          !optionCodes.length)
      )
        throw new Error('Opciones de pregunta incompletas o duplicadas.');
      return {
        ...row,
        requerida: boolean(row.requerida),
        eliminado: false,
        configuracion: config,
        opciones: options,
      };
    })
    .sort((a, b) => Number(a.orden) - Number(b.orden) || String(a.id).localeCompare(String(b.id)));
  const typedQuestions = questions as unknown as FormQuestion[];
  const version = deriveConditionsVersion(configuration, typedQuestions);
  validateFormDefinition({
    id: String(form.id),
    version: Number(form.version),
    version_condiciones: version,
    ...(Object.hasOwn(configuration, 'version_reglas_compuestas')
      ? { version_reglas_compuestas: configuration.version_reglas_compuestas as number }
      : {}),
    preguntas: typedQuestions,
  });
  return {
    form: {
      ...form,
      activo: boolean(form.activo),
      eliminado: false,
      configuracion: { ...configuration, version_condiciones: version },
    },
    questions,
  };
}

/** Called only after a complete SDK checkpoint, never for a partially downloaded row set. */
export async function publishCatalog(
  db: CommonPowerSyncDatabase,
  local: SqlConnection,
  completedAt: string,
  localPatientId?: string,
) {
  const input = await db.readTransaction(async (tx) => ({
    forms: await tx.getAll<Record<string, unknown>>('SELECT * FROM formulario ORDER BY id'),
    questions: await tx.getAll<Record<string, unknown>>(
      'SELECT * FROM pregunta ORDER BY formulario_id,orden,id',
    ),
    education: await tx.getAll<Record<string, unknown>>(
      'SELECT * FROM contenido_educativo ORDER BY fecha_creacion DESC,id ASC',
    ),
  }));
  const existing = await local.all<{ id: string; snapshot_json: string }>(
    'SELECT id,snapshot_json FROM qc_definition_snapshot',
  );
  const snapshots: DefinitionSnapshot[] = [];
  for (const form of input.forms) {
    const next = completeDefinition(
      form,
      input.questions.filter((q) => q.formulario_id === form.id),
    );
    const previous = existing.find((s) => s.id === form.id);
    if (previous) {
      const old = JSON.parse(previous.snapshot_json) as DefinitionSnapshot;
      const immutable = (s: DefinitionSnapshot) =>
        canonical({ form: { ...s.form, activo: null }, questions: s.questions });
      if (immutable(old) !== immutable(next))
        throw new Error('Una edición publicada cambió de contenido.');
    }
    snapshots.push(next);
  }
  if (input.education.some((row) => !['imagen', 'video'].includes(String(row.tipo))))
    throw new Error('El catálogo educativo replicó un formato no permitido.');
  const education = eligibleEducation(input.education);
  const previousEducation = await local.first<{ value_json: string }>(
    "SELECT value_json FROM qc_storage_control WHERE id='education:checkpoint'",
  );
  const previousRows: Record<string, unknown>[] = previousEducation
    ? JSON.parse(previousEducation.value_json)
    : [];
  assertEducationRevisions(previousRows, education);
  await local.transaction(async (tx) => {
    await tx.run('UPDATE qc_definition_snapshot SET retired=1');
    for (const snapshot of snapshots) {
      await tx.run(
        'INSERT INTO qc_definition_snapshot(id,snapshot_json,completed_at,retired) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET completed_at=excluded.completed_at,retired=excluded.retired',
        [String(snapshot.form.id), canonical(snapshot), completedAt, snapshot.form.activo ? 0 : 1],
      );
    }
    if (localPatientId) {
      const visible = new Set(education.map((row) => row.id));
      for (const old of previousRows) {
        if (typeof old.id === 'string' && !visible.has(old.id))
          await tx.run(
            'UPDATE descarga SET retirado_en=? WHERE paciente_id=? AND contenido_id=? AND retirado_en IS NULL',
            [completedAt, localPatientId, old.id],
          );
      }
    }
    await tx.run(
      'INSERT INTO qc_storage_control(id,value_json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json',
      ['education:checkpoint', canonical(education)],
    );
    await tx.run(
      'INSERT INTO qc_catalog_status(id,completed_at,error_code) VALUES (?,?,NULL) ON CONFLICT(id) DO UPDATE SET completed_at=excluded.completed_at,error_code=NULL',
      ['catalog', completedAt],
    );
  });
  return {
    forms: snapshots.length,
    questions: input.questions.length,
    education: education.length,
  };
}
