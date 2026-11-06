import { visibleAnswers, type AnswerValue } from '@quimiocare/contracts/forms';
import type { SqlConnection } from '../local/core/sql';
import {
  createDailyFormContext,
  type DailyFormContext,
} from '../../services/forms/daily-form-context';
import { isUuid, object } from '../../services/session/response-checks';
import { canonical, type ClinicalScope } from './clinical-command';
import type { DefinitionSnapshot } from './catalog';
import { contractForm, formSections } from './contract-form';
import { saveContractEproInTransaction } from './clinical-repository';
import { createCatalogRepository } from './catalog-repository';

export interface EproDraft {
  id: string;
  owner: string;
  environment: string;
  definition: DefinitionSnapshot;
  context: DailyFormContext;
  answers: Record<string, AnswerValue>;
  section: string;
  savedAt: string;
  revision: number;
}
export interface EproCapture extends EproDraft {
  submittedAt: string;
}
const draftKey = (id: string) => 'epro:draft:' + id;
const captureKey = (id: string) => 'epro:capture:' + id;
export function createEproRepository(
  db: SqlConnection,
  scope: ClinicalScope,
  options: {
    newId: () => string;
    now?: () => string;
    assertContext: () => void;
  },
) {
  const assert = options.assertContext,
    now = options.now ?? (() => new Date().toISOString());
  const catalog = createCatalogRepository(db);
  function parse(text: string, key: string): EproDraft {
    const value: unknown = JSON.parse(text);
    if (
      !object(value) ||
      !isUuid(value.id) ||
      ![draftKey(value.id), captureKey(value.id)].includes(key) ||
      value.owner !== scope.owner ||
      value.environment !== scope.environment ||
      !object(value.definition) ||
      !object(value.definition.form) ||
      !Array.isArray(value.definition.questions) ||
      !object(value.context) ||
      typeof value.context.fechaSeguimiento !== 'string' ||
      !object(value.answers) ||
      typeof value.savedAt !== 'string' ||
      !Number.isFinite(Date.parse(value.savedAt)) ||
      !Number.isInteger(value.revision) ||
      Number(value.revision) < 0
    )
      throw new Error('El seguimiento no pertenece al dueño, entorno o edición esperados.');
    const definition = value.definition as unknown as DefinitionSnapshot;
    contractForm(definition);
    const sections = formSections(definition);
    if (
      !sections.some((section) => section.id === value.section) ||
      typeof value.context.iniciadoEn !== 'string'
    )
      throw new Error('El borrador no conserva su sección o contexto temporal original.');
    const context = value.context;
    const expected = createDailyFormContext({ now: context.iniciadoEn as string });
    if (Object.entries(expected).some(([field, expectedValue]) => context[field] !== expectedValue))
      throw new Error('El borrador no conserva su contexto temporal original.');
    if (
      key.startsWith('epro:capture:') &&
      (typeof value.submittedAt !== 'string' || !Number.isFinite(Date.parse(value.submittedAt)))
    )
      throw new Error('La captura no tiene fecha original válida.');
    return value as unknown as EproDraft;
  }
  async function get(tx: SqlConnection, key: string) {
    assert();
    const row = await tx.first<{ value_json: string }>(
      'SELECT value_json FROM qc_storage_control WHERE id=?',
      [key],
    );
    assert();
    return row ? parse(row.value_json, key) : null;
  }
  async function list(prefix: string): Promise<EproDraft[]> {
    assert();
    const rows = await db.all<{ id: string; value_json: string }>(
      'SELECT id,value_json FROM qc_storage_control WHERE id LIKE ? ORDER BY id',
      [prefix + '%'],
    );
    assert();
    return rows.map((row) => parse(row.value_json, row.id));
  }
  async function put(tx: SqlConnection, key: string, value: EproDraft) {
    assert();
    await tx.run(
      'INSERT INTO qc_storage_control(id,value_json) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json',
      [key, canonical(value)],
    );
  }
  const api = {
    async hub() {
      assert();
      const [status, definitions, drafts, captures] = await Promise.all([
        catalog.status(),
        catalog.definitions(),
        list('epro:draft:'),
        list('epro:capture:'),
      ]);
      assert();
      const candidates = definitions.filter(
        (snapshot) =>
          snapshot.form.tratamiento === 'quimioterapia' &&
          snapshot.form.activo === true &&
          object(snapshot.form.configuracion) &&
          snapshot.form.configuracion.provisional !== true,
      );
      if (candidates.length > 1)
        throw new Error(
          'El servicio publicó más de un seguimiento global activo para quimioterapia.',
        );
      return {
        status,
        current: (candidates[0] ?? null) as DefinitionSnapshot | null,
        drafts: drafts.sort((a, b) => b.savedAt.localeCompare(a.savedAt)),
        captures: (captures as EproCapture[]).sort((a, b) =>
          b.submittedAt.localeCompare(a.submittedAt),
        ),
      };
    },
    draft(id: string) {
      if (!isUuid(id)) return Promise.resolve(null);
      return get(db, draftKey(id));
    },
    async capture(id: string) {
      if (!isUuid(id)) return null;
      const value = await get(db, captureKey(id));
      if (!value) return null;
      const record = value as EproCapture;
      if (!Number.isFinite(Date.parse(record.submittedAt)))
        throw new Error('La captura no tiene fecha original válida.');
      const command = await db.first<{ status: string }>(
        'SELECT status FROM qc_clinical_command WHERE id=? AND owner=? AND environment=?',
        [id, scope.owner, scope.environment],
      );
      assert();
      return { record, status: command?.status ?? 'guardado_local' };
    },
    async start(formId: string): Promise<EproDraft> {
      assert();
      let draft: EproDraft | undefined;
      await db.transaction(async (tx) => {
        assert();
        const row = await tx.first<{ snapshot_json: string; retired: number }>(
          'SELECT snapshot_json,retired FROM qc_definition_snapshot WHERE id=?',
          [formId],
        );
        if (!row || row.retired !== 0)
          throw new Error('No se puede iniciar una edición retirada o incompleta.');
        const definition = JSON.parse(row.snapshot_json) as DefinitionSnapshot;
        contractForm(definition);
        if (
          definition.form.activo !== true ||
          definition.form.tratamiento !== 'quimioterapia' ||
          !object(definition.form.configuracion) ||
          definition.form.configuracion.provisional === true
        )
          throw new Error(
            'El seguimiento global no está activo o corresponde a una definición provisional.',
          );
        const context = createDailyFormContext({ now: now() });
        const rows = await tx.all<{ id: string; value_json: string }>(
          "SELECT id,value_json FROM qc_storage_control WHERE id LIKE 'epro:draft:%'",
        );
        for (const stored of rows) {
          const old = parse(stored.value_json, stored.id);
          if (
            old.context.fechaSeguimiento !== context.fechaSeguimiento ||
            old.definition.form.codigo !== definition.form.codigo
          )
            continue;
          // Se permite realizar más de un seguimiento al día si el paciente lo requiere
          if (old.definition.form.id === formId) {
            draft = old;
            return;
          }
        }
        const id = options.newId();
        if (!isUuid(id)) throw new Error('No se pudo crear la identidad del borrador.');
        draft = {
          id,
          owner: scope.owner,
          environment: scope.environment,
          definition: JSON.parse(canonical(definition)),
          context,
          answers: {},
          section: formSections(definition)[0].id,
          savedAt: context.iniciadoEn,
          revision: 0,
        };
        const existing = await tx.first('SELECT id FROM qc_storage_control WHERE id=? OR id=?', [
          draftKey(id),
          captureKey(id),
        ]);
        if (existing) throw new Error('La identidad del borrador ya existe.');
        await put(tx, draftKey(id), draft);
      });
      assert();
      return draft!;
    },
    async save(id: string, answers: Record<string, AnswerValue>, section: string) {
      assert();
      let result: EproDraft | undefined;
      // JSON roundtrip prevents caller mutations while the SDK transaction waits for its lock.
      const immutable = JSON.parse(canonical(answers)) as Record<string, AnswerValue>;
      await db.transaction(async (tx) => {
        const current = await get(tx, draftKey(id));
        if (!current) throw new Error('El borrador ya no está disponible.');
        const edition = contractForm(current.definition),
          ids = new Set(edition.preguntas.map((q) => q.id));
        if (
          Object.keys(immutable).some((key) => !ids.has(key)) ||
          Object.values(immutable).some(
            (value) =>
              value !== null &&
              typeof value !== 'boolean' &&
              typeof value !== 'string' &&
              typeof value !== 'number' &&
              !(Array.isArray(value) && value.every((v) => typeof v === 'string')),
          )
        )
          throw new Error(
            'El borrador contiene respuestas ajenas a su edición o de tipo incompatible.',
          );
        if (!formSections(current.definition).some((s) => s.id === section))
          throw new Error('La sección no pertenece a esta edición.');
        result = {
          ...current,
          answers: immutable,
          section,
          savedAt: now(),
          revision: current.revision + 1,
        };
        await put(tx, draftKey(id), result);
      });
      assert();
      return result!;
    },
    async submit(id: string) {
      assert();
      await db.transaction(async (tx) => {
        const existing = await get(tx, captureKey(id));
        if (existing) return;
        const draft = await get(tx, draftKey(id));
        if (!draft) throw new Error('No se encontró el borrador a confirmar.');
        const edition = contractForm(draft.definition),
          submittedAt = now();
        const answers = visibleAnswers(
          edition,
          Object.entries(draft.answers).map(([pregunta_id, valor]) => ({ pregunta_id, valor })),
        );
        await saveContractEproInTransaction(tx, scope, draft.definition, {
          id,
          fecha_respuesta: submittedAt,
          respuestas: answers,
        });
        const record: EproCapture = {
          ...draft,
          answers: Object.fromEntries(answers.map((a) => [a.pregunta_id, a.valor])) as Record<
            string,
            AnswerValue
          >,
          submittedAt,
        };
        await put(tx, captureKey(id), record);
        await tx.run(
          'UPDATE respuesta_formulario SET fecha_seguimiento=?,zona_horaria=?,iniciado_en=?,ventana_desde=?,ventana_hasta=? WHERE id=? AND paciente_id=?',
          [
            draft.context.fechaSeguimiento,
            draft.context.zonaHoraria,
            draft.context.iniciadoEn,
            draft.context.ventanaDesde,
            draft.context.ventanaHasta,
            id,
            scope.localPatientId,
          ],
        );
        await tx.run('DELETE FROM qc_storage_control WHERE id=?', [draftKey(id)]);
        assert();
      });
      assert();
      return id;
    },
  };
  return api;
}
