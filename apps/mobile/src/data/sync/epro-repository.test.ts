import { afterEach, describe, expect, it } from 'vitest';
import {
  activeQuestionIds,
  validateFormAnswers,
  type AnswerValue,
} from '@quimiocare/contracts/forms';
import fixture from '../../../../../packages/contracts/fixtures/epro-seguimiento-domiciliario-v1_1_0.json';
import { createSqliteTestHarness, patientA } from '../local/testing/sqlite-test-harness';
import { migrateDatabase } from '../local/migrations';
import { createEproRepository } from './epro-repository';
import { canonical, type ClinicalScope } from './clinical-command';
import { completeDefinition, type DefinitionSnapshot } from './catalog';
import { contractForm } from './contract-form';
const harness = createSqliteTestHarness();
afterEach(() => harness.cleanup());
const scope: ClinicalScope = {
  owner: '964d32f1-6941-579f-9f08-b60342194da9',
  localPatientId: patientA,
  environment: 'test:epro',
};
const capture = '4be97c17-cef7-4f4b-9483-0f24fe405fb4';
const definition = () =>
  completeDefinition(
    { ...fixture.formulario, eliminado: false },
    fixture.formulario.preguntas.map((q) => ({
      ...q,
      formulario_id: fixture.formulario.id,
      eliminado: false,
    })),
  );
function answersFor(snapshot: DefinitionSnapshot) {
  const form = contractForm(snapshot),
    answers: Record<string, AnswerValue> = {};
  for (let i = 0; i < form.preguntas.length; i++) {
    const active = activeQuestionIds(
      form,
      Object.entries(answers).map(([pregunta_id, valor]) => ({ pregunta_id, valor })),
    );
    for (const q of form.preguntas)
      if (active.has(q.id) && !(q.id in answers) && q.requerida !== false)
        answers[q.id] =
          q.tipo === 'booleano'
            ? false
            : q.tipo === 'numerico'
              ? 0
              : q.tipo === 'opcion_multiple'
                ? [q.opciones![0].codigo]
                : (q.opciones?.[0].codigo ?? 'Synthetic');
  }
  const visible = activeQuestionIds(
    form,
    Object.entries(answers).map(([pregunta_id, valor]) => ({ pregunta_id, valor })),
  );
  for (const id of Object.keys(answers)) if (!visible.has(id)) delete answers[id];
  validateFormAnswers(
    form,
    Object.entries(answers).map(([pregunta_id, valor]) => ({ pregunta_id, valor })),
  );
  return answers;
}
async function setup() {
  const db = harness.open();
  await migrateDatabase(db);
  await db.exec(
    'CREATE TABLE qc_upload_epro(id TEXT PRIMARY KEY,owner TEXT,environment TEXT,captured_at TEXT,payload_json TEXT,legacy_queue_id TEXT);',
  );
  await db.run('INSERT INTO paciente_cache(paciente_id,nombre,obtenido_en) VALUES (?,?,?)', [
    patientA,
    'Synthetic',
    '2026-10-27T12:00:00Z',
  ]);
  const snapshot = definition();
  await db.run(
    'INSERT INTO qc_definition_snapshot(id,snapshot_json,completed_at,retired) VALUES (?,?,?,0)',
    [String(snapshot.form.id), canonical(snapshot), '2026-10-27T12:00:00Z'],
  );
  await db.run("INSERT INTO qc_catalog_status(id,completed_at) VALUES ('catalog',?)", [
    '2026-10-27T12:00:00Z',
  ]);
  let validContext = true,
    clock = '2026-10-27T12:00:00Z';
  const options = {
    newId: () => capture,
    now: () => clock,
    assertContext: () => {
      if (!validContext) throw new Error('changed');
    },
  };
  return {
    db,
    snapshot,
    repo: createEproRepository(db, scope, options),
    options,
    close: () => {
      validContext = false;
    },
    setClock: (date: string) => {
      clock = date;
    },
  };
}
describe('global ePRO draft and durable snapshot', () => {
  it('does not depend on a patient assignment and resumes the same durable draft after reopening', async () => {
    const s = await setup(),
      hub = await s.repo.hub();
    expect(hub.current?.form.id).toBe(s.snapshot.form.id);
    const draft = await s.repo.start(String(s.snapshot.form.id));
    const answers = answersFor(s.snapshot);
    await s.repo.save(draft.id, answers, draft.section);
    const reopened = createEproRepository(s.db, scope, s.options);
    expect((await reopened.draft(capture))?.answers).toEqual(answers);
    expect((await reopened.start(String(s.snapshot.form.id))).id).toBe(capture);
    expect(await s.db.first('SELECT * FROM formulario_asignacion_cache')).toBeNull();
  });
  it('freezes the original edition across a new active definition and keeps the capture, queue and event atomic', async () => {
    const s = await setup(),
      draft = await s.repo.start(String(s.snapshot.form.id));
    const answers = answersFor(s.snapshot);
    await s.repo.save(draft.id, answers, draft.section);
    await s.db.run('UPDATE qc_definition_snapshot SET retired=1');
    const newer = structuredClone(s.snapshot);
    newer.form.id = '65bb1b2b-e646-5870-9328-ea328410bf84';
    newer.form.version = 2;
    for (const q of newer.questions) q.formulario_id = newer.form.id;
    await s.db.run(
      'INSERT INTO qc_definition_snapshot(id,snapshot_json,completed_at,retired) VALUES (?,?,?,0)',
      [String(newer.form.id), canonical(newer), '2026-10-27T12:01:00Z'],
    );
    s.setClock('2026-10-27T12:02:00Z');
    await s.repo.submit(draft.id);
    await s.repo.submit(draft.id);
    const reopened = createEproRepository(s.db, scope, s.options),
      saved = await reopened.capture(capture);
    expect(saved?.record.definition.form.version).toBe(1);
    expect(saved?.record.answers).toEqual(answers);
    expect(saved?.record.submittedAt).toBe('2026-10-27T12:02:00Z');
    expect(saved?.status).toBe('pendiente');
    expect(await reopened.draft(capture)).toBeNull();
    expect(await s.db.first('SELECT count(*) AS n FROM qc_operational_event')).toEqual({ n: 1 });
    expect(await s.db.first('SELECT count(*) AS n FROM qc_upload_epro')).toEqual({ n: 1 });
    const row = await s.db.first<{ payload_json: string }>(
      'SELECT payload_json FROM qc_clinical_command',
    );
    expect(JSON.parse(row!.payload_json)).toMatchObject({
      id: capture,
      formulario_id: s.snapshot.form.id,
      formulario_version: 1,
    });
    expect(JSON.parse(row!.payload_json)).not.toHaveProperty('comentario');
    expect(
      await s.db.first("SELECT id FROM cola_envio WHERE tipo_entidad='respuesta_formulario'"),
    ).toBeNull();
  });
  it('preserves invalid exclusive selections for correction instead of silently erasing them', async () => {
    const s = await setup(),
      draft = await s.repo.start(String(s.snapshot.form.id)),
      answers = answersFor(s.snapshot);
    const question = contractForm(s.snapshot).preguntas.find(
      (q) => q.tipo === 'opcion_multiple' && q.configuracion?.opciones_exclusivas,
    )!;
    const exclusive = question.configuracion!.opciones_exclusivas as string[];
    answers[question.id] = [
      exclusive[0],
      question.opciones!.find((o) => !exclusive.includes(o.codigo))!.codigo,
    ];
    await s.repo.save(draft.id, answers, draft.section);
    await expect(s.repo.submit(draft.id)).rejects.toThrow('exclusiva');
    expect((await s.repo.draft(draft.id))?.answers[question.id]).toEqual(answers[question.id]);
    expect(await s.db.first('SELECT id FROM qc_clinical_command')).toBeNull();
  });
  it('rolls back history and preserves the draft when the SDK upload table fails', async () => {
    const s = await setup(),
      draft = await s.repo.start(String(s.snapshot.form.id));
    await s.repo.save(draft.id, answersFor(s.snapshot), draft.section);
    await s.db.exec(
      "CREATE TRIGGER synthetic_sdk_failure BEFORE INSERT ON qc_upload_epro BEGIN SELECT RAISE(ABORT,'synthetic SDK failure');END;",
    );
    await expect(s.repo.submit(draft.id)).rejects.toThrow('synthetic SDK failure');
    expect(await s.repo.draft(draft.id)).not.toBeNull();
    for (const table of ['respuesta_formulario', 'qc_clinical_command', 'qc_operational_event'])
      expect(await s.db.first(`SELECT count(*) AS n FROM ${table}`)).toEqual({ n: 0 });
  });
  it('rejects another owner/environment and a closed context', async () => {
    const s = await setup();
    await s.repo.start(String(s.snapshot.form.id));
    const foreign = createEproRepository(s.db, { ...scope, environment: 'other' }, s.options);
    await expect(foreign.draft(capture)).rejects.toThrow('entorno');
    s.close();
    await expect(s.repo.draft(capture)).rejects.toThrow('changed');
  });
  it('rejects a stored draft whose identity does not match its key', async () => {
    const s = await setup(),
      draft = await s.repo.start(String(s.snapshot.form.id));
    await s.db.run('UPDATE qc_storage_control SET value_json=? WHERE id=?', [
      canonical({ ...draft, id: '4be97c17-cef7-4f4b-9483-0f24fe405fb5' }),
      'epro:draft:' + draft.id,
    ]);
    await expect(s.repo.draft(draft.id)).rejects.toThrow('edición');
  });
  it('rejects a rewritten recall window without discarding the stored draft', async () => {
    const s = await setup(),
      draft = await s.repo.start(String(s.snapshot.form.id));
    await s.db.run('UPDATE qc_storage_control SET value_json=? WHERE id=?', [
      canonical({
        ...draft,
        context: { ...draft.context, ventanaDesde: draft.context.ventanaHasta },
      }),
      'epro:draft:' + draft.id,
    ]);
    await expect(s.repo.draft(draft.id)).rejects.toThrow('temporal');
    expect(
      await s.db.first('SELECT id FROM qc_storage_control WHERE id=?', ['epro:draft:' + draft.id]),
    ).not.toBeNull();
  });
  it('does not start a retired edition or duplicate a completed daily instrument', async () => {
    const s = await setup(),
      draft = await s.repo.start(String(s.snapshot.form.id));
    await s.repo.save(draft.id, answersFor(s.snapshot), draft.section);
    await s.repo.submit(draft.id);
    await expect(s.repo.start(String(s.snapshot.form.id))).rejects.toThrow('completaste');
    await s.db.run('UPDATE qc_definition_snapshot SET retired=1');
    await expect(s.repo.start(String(s.snapshot.form.id))).rejects.toThrow('retirada');
  });
});
