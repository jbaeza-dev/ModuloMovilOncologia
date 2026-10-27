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
      return {
        ...row,
        requerida: boolean(row.requerida),
        eliminado: false,
        configuracion: config,
        opciones: options,
      };
    })
    .sort((a, b) => Number(a.orden) - Number(b.orden) || String(a.id).localeCompare(String(b.id)));
  const hasConditions = questions.some(
    (q) =>
      Object.hasOwn(q.configuracion, 'valor_activador') ||
      Object.hasOwn(q.configuracion, 'requerida_si_activa'),
  );
  const explicit = Object.hasOwn(configuration, 'version_condiciones');
  const version = explicit ? configuration.version_condiciones : hasConditions ? 1 : 0;
  if (version !== 0 && version !== 1) throw new Error('Marcador condicional inválido.');
  if (version === 0 && hasConditions)
    throw new Error('La edición legada no puede ocultar condiciones.');
  const parents = new Map<string, string>();
  for (const q of questions) {
    const config = q.configuracion;
    if (Object.hasOwn(config, 'opciones_exclusivas')) {
      if (
        configuration.version_condiciones !== 1 ||
        !explicit ||
        q.tipo !== 'opcion_multiple' ||
        !Array.isArray(config.opciones_exclusivas) ||
        config.opciones_exclusivas.some((v) => typeof v !== 'string') ||
        new Set(config.opciones_exclusivas).size !== config.opciones_exclusivas.length
      )
        throw new Error('Exclusividad de edición inválida.');
      const optionCodes = new Set(
        q.opciones.map((o) => (object(o) ? (o.codigo ?? o.value ?? o.valor) : undefined)),
      );
      if (config.opciones_exclusivas.some((v) => !optionCodes.has(v)))
        throw new Error('Opción exclusiva ajena a la pregunta.');
    }
    if (
      version === 1 &&
      ['depende_de', 'valor_activador', 'requerida_si_activa'].some((k) => Object.hasOwn(config, k))
    ) {
      const parent = questions.find((p) => p.codigo === config.depende_de);
      if (
        !parent ||
        parent.id === q.id ||
        typeof config.depende_de !== 'string' ||
        !Object.hasOwn(config, 'valor_activador') ||
        typeof config.requerida_si_activa !== 'boolean' ||
        !['booleano', 'numerico', 'opcion_unica', 'escala_likert'].includes(String(parent.tipo)) ||
        !['string', 'boolean', 'number'].includes(typeof config.valor_activador)
      )
        throw new Error('Dependencia condicional inválida.');
      parents.set(String(q.codigo), String(parent.codigo));
    }
  }
  for (const code of parents.keys()) {
    const seen = new Set<string>();
    let current: string | undefined = code;
    while (current) {
      if (seen.has(current)) throw new Error('Ciclo condicional inválido.');
      seen.add(current);
      current = parents.get(current);
    }
  }
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
  for (const row of input.education) {
    if (
      !isUuid(row.id) ||
      !boolean(row.activo) ||
      !['imagen', 'video'].includes(String(row.tipo)) ||
      typeof row.descripcion !== 'string' ||
      typeof row.url !== 'string' ||
      !row.url.trim() ||
      typeof row.categoria !== 'string' ||
      !row.categoria.trim()
    )
      throw new Error('Catálogo educativo incompleto.');
    if (
      row.tipo === 'imagen' &&
      (!['image/png', 'image/jpeg'].includes(String(row.archivo_mime)) ||
        !Number.isInteger(row.archivo_tamano_bytes) ||
        Number(row.archivo_tamano_bytes) <= 0 ||
        !isUuid(row.archivo_revision) ||
        !/^[0-9a-f]{64}$/.test(String(row.archivo_sha256)))
    )
      throw new Error('Imagen sin metadata de publicación.');
    if (
      row.tipo === 'video' &&
      ['archivo_mime', 'archivo_tamano_bytes', 'archivo_revision', 'archivo_sha256'].some(
        (k) => row[k] !== null,
      )
    )
      throw new Error('Video con metadata de archivo no permitida.');
  }
  await local.transaction(async (tx) => {
    await tx.run('UPDATE qc_definition_snapshot SET retired=1');
    for (const snapshot of snapshots) {
      await tx.run(
        'INSERT INTO qc_definition_snapshot(id,snapshot_json,completed_at,retired) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET completed_at=excluded.completed_at,retired=excluded.retired',
        [String(snapshot.form.id), canonical(snapshot), completedAt, snapshot.form.activo ? 0 : 1],
      );
    }
    await tx.run(
      'INSERT INTO qc_storage_control(id,value_json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json',
      ['education:checkpoint', canonical(input.education)],
    );
    await tx.run(
      'INSERT INTO qc_catalog_status(id,completed_at,error_code) VALUES (?,?,NULL) ON CONFLICT(id) DO UPDATE SET completed_at=excluded.completed_at,error_code=NULL',
      ['catalog', completedAt],
    );
  });
  return {
    forms: snapshots.length,
    questions: input.questions.length,
    education: input.education.length,
  };
}
