import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openDatabase, migrate, type Database } from '../src/db.js';
import { seedDatabase, APPROVED_TERMS_ID } from '../src/seed-data.js';
import { guardScenario } from '../src/scenarios.js';
import { createLinkCode, consumeLinkCode } from '../src/clinical.js';
import { migrateSimulator } from '../src/persistence/migrations.js';
import { requireOperator } from '../src/preparation.js';
import type { SimulatorConfig } from '../src/config.js';
import type { Principal } from '../src/types.js';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw new Error('Dedicated _test database required');
let db: Database;
const isolatedUrl = new URL(url!);
const isolatedName = 'qc_linking_' + randomUUID().replaceAll('-', '') + '_test';
isolatedUrl.pathname = '/' + isolatedName;
const issuer = 'https://auth.example/auth/v1';
const operator = randomUUID();
async function patient() {
  const id = randomUUID(),
    email = `${id}@example.test`;
  await db.query('INSERT INTO qc_demo_invitacion_paciente(email,nombre) VALUES($1,$2)', [
    email,
    'Synthetic validation',
  ]);
  await guardScenario(db, { id, email, tipo: 'external', issuer }, true);
  return id;
}
beforeAll(async () => {
  const admin = openDatabase(url!);
  try {
    await admin.query('CREATE DATABASE ' + isolatedName);
  } finally {
    await admin.end();
  }
  db = openDatabase(isolatedUrl.href);
  // Exercise upgrade from the initial schema, preserving an existing A/B profile.
  await migrateSimulator(db, 1);
  await db.query(
    `INSERT INTO qc_demo_paciente(id,paciente_demo,perfil,perfil_clinico,tratamiento)
    VALUES($1,'A','{}','{}','{}')`,
    ['964d32f1-6941-579f-9f08-b60342194da9'],
  );
  await migrate(db);
  expect(
    (await db.query("SELECT paciente_demo FROM qc_demo_paciente WHERE paciente_demo='A'")).rowCount,
  ).toBe(1);
  await db.query("DELETE FROM qc_demo_paciente WHERE paciente_demo='A'");
  await seedDatabase(db, 'http://127.0.0.1:3102');
  await db.query(
    `INSERT INTO qc_demo_operador(id,auth_issuer,auth_subject,email,nombre)
    VALUES($1::uuid,$2,$1::text,$3,'Synthetic operator')`,
    [operator, issuer, `${operator}@example.test`],
  );
});
afterAll(async () => {
  await db?.end();
  const admin = openDatabase(url!);
  try {
    await admin.query('DROP DATABASE ' + isolatedName);
  } finally {
    await admin.end();
  }
});
describe('PostgreSQL individual linking', () => {
  it('creates an invited identity once under concurrent first access and preserves issuer', async () => {
    const id = randomUUID(),
      email = `${id}@example.test`;
    await db.query('INSERT INTO qc_demo_invitacion_paciente(email,nombre) VALUES($1,$2)', [
      email,
      'Synthetic',
    ]);
    await Promise.all(
      Array.from({ length: 4 }, () =>
        guardScenario(db, { id, email, issuer, tipo: 'external' }, true),
      ),
    );
    const result = await db.query(
      'SELECT auth_issuer,auth_subject FROM qc_demo_paciente WHERE id=$1',
      [id],
    );
    expect(result.rows).toEqual([{ auth_issuer: issuer, auth_subject: id }]);
  });
  it('denies uninvited accounts', async () => {
    await expect(
      guardScenario(
        db,
        { id: randomUUID(), email: 'uninvited@example.test', tipo: 'external', issuer },
        true,
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('creates only one pending code and preserves the existing HTTP 409 contract', async () => {
    const id = await patient();
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => createLinkCode(db, id)),
    );
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((x) => x.status === 'rejected');
    expect(rejected).toHaveLength(3);
    for (const result of rejected) expect(result.reason).toMatchObject({ status: 409 });
    const row = (
      await db.query('SELECT codigo FROM qc_demo_vinculacion WHERE paciente_id=$1', [id])
    ).rows[0];
    expect(row.codigo).toMatch(/^[A-Z0-9]{8}$/);
  });
  it('links atomically with one relation and audit on concurrent replay, without accepting terms', async () => {
    const id = await patient(),
      code = await createLinkCode(db, id),
      operation = randomUUID();
    await db.query(
      "UPDATE qc_demo_paciente SET perfil=jsonb_set(perfil,'{estado_incorporacion}','\"COMPLETO\"') WHERE id=$1",
      [id],
    );
    await db.query(
      'INSERT INTO qc_demo_consentimiento(id,paciente_id,definicion_id,request,otorgado_el) VALUES($1,$2,$3,$4,now())',
      [randomUUID(), id, APPROVED_TERMS_ID, { codigo: 'TERMINOS_PLATAFORMA' }],
    );
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        consumeLinkCode(db, operator, code.codigo, 'DEMO-FOLFOX-v1', operation),
      ),
    );
    expect(results.every((x) => x.status === 200)).toBe(true);
    expect(new Set(results.map((x) => x.body.relacion_id)).size).toBe(1);
    expect(
      (await db.query('SELECT origen FROM qc_demo_profesional WHERE operador_id=$1', [operator]))
        .rows[0]?.origen,
    ).toBe('simulacion');
    const medications = (
      await db.query('SELECT perfil_clinico FROM qc_demo_paciente WHERE id=$1', [id])
    ).rows[0].perfil_clinico.medicamentos;
    expect(medications).toHaveLength(3);
    expect(medications.every((m: { activo: boolean }) => m.activo)).toBe(true);
    expect(
      (await db.query('SELECT * FROM qc_demo_auditoria_vinculacion WHERE paciente_id=$1', [id]))
        .rowCount,
    ).toBe(1);
    expect(
      (await db.query('SELECT * FROM qc_demo_consentimiento WHERE paciente_id=$1', [id])).rowCount,
    ).toBe(1);
    expect(
      (await db.query('SELECT perfil FROM qc_demo_paciente WHERE id=$1', [id])).rows[0].perfil
        .estado_incorporacion,
    ).toBe('COMPLETO');
    await expect(
      consumeLinkCode(db, operator, code.codigo, 'DEMO-AC-T-v1', operation),
    ).rejects.toMatchObject({ status: 409 });
  });
  async function linkablePatient() {
    const id = await patient(),
      code = await createLinkCode(db, id);
    await db.query(
      "UPDATE qc_demo_paciente SET perfil=jsonb_set(perfil,'{estado_incorporacion}','\"COMPLETO\"') WHERE id=$1",
      [id],
    );
    await db.query(
      'INSERT INTO qc_demo_consentimiento(id,paciente_id,definicion_id,request,otorgado_el) VALUES($1,$2,$3,$4,now())',
      [randomUUID(), id, APPROVED_TERMS_ID, { codigo: 'TERMINOS_PLATAFORMA' }],
    );
    return { id, code };
  }
  /** Operador dado de alta automáticamente por estar en OPERATOR_ALLOWED_EMAILS. */
  async function emailOperator() {
    const subject = randomUUID(),
      email = `operador-${subject}@example.test`;
    const config = { issuer, operatorAllowedEmails: [email] } as SimulatorConfig;
    const principal: Principal = { id: subject, tipo: 'external', issuer, email };
    return { subject, config, principal, id: await requireOperator(db, config, principal) };
  }
  it('vincula con un operador dado de alta por correo, cuyo id no es su usuario de Supabase', async () => {
    const op = await emailOperator();
    expect(op.id).not.toBe(op.subject);
    const { id, code } = await linkablePatient();
    const result = await consumeLinkCode(
      db,
      op.id,
      code.codigo,
      'DEMO-FOLFOX-v1',
      randomUUID(),
      issuer,
    );
    expect(result.status).toBe(200);
    expect(
      (
        await db.query('SELECT operador_id FROM qc_demo_relacion_clinica WHERE paciente_id=$1', [
          id,
        ])
      ).rows[0]?.operador_id,
    ).toBe(op.id);
    expect(
      (
        await db.query(
          'SELECT operador_id FROM qc_demo_auditoria_vinculacion WHERE paciente_id=$1',
          [id],
        )
      ).rows[0]?.operador_id,
    ).toBe(op.id);
    expect(
      (await db.query('SELECT consumido_por FROM qc_demo_vinculacion WHERE paciente_id=$1', [id]))
        .rows[0]?.consumido_por,
    ).toBe(op.id);
  });
  it('rechaza a un operador desactivado o de otro emisor sin asignar contexto', async () => {
    const op = await emailOperator();
    const { id, code } = await linkablePatient();
    await expect(
      consumeLinkCode(
        db,
        op.id,
        code.codigo,
        'DEMO-FOLFOX-v1',
        undefined,
        'https://otro.example/auth/v1',
      ),
    ).rejects.toMatchObject({ status: 403 });
    await db.query('UPDATE qc_demo_operador SET activo=false WHERE id=$1', [op.id]);
    await expect(
      consumeLinkCode(db, op.id, code.codigo, 'DEMO-FOLFOX-v1', undefined, issuer),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      (await db.query('SELECT tratamiento FROM qc_demo_paciente WHERE id=$1', [id])).rows[0]
        .tratamiento,
    ).toBeNull();
  });
  it('rejects an unauthorized operator and an expired code without assigning context', async () => {
    const id = await patient(),
      code = await createLinkCode(db, id);
    await expect(
      consumeLinkCode(db, randomUUID(), code.codigo, 'DEMO-FOLFOX-v1'),
    ).rejects.toMatchObject({ status: 403 });
    await db.query(
      "UPDATE qc_demo_vinculacion SET vence_en=now()-interval '1 second' WHERE paciente_id=$1",
      [id],
    );
    await expect(
      consumeLinkCode(db, operator, code.codigo, 'DEMO-FOLFOX-v1'),
    ).rejects.toMatchObject({ status: 410 });
    expect(
      (await db.query('SELECT tratamiento FROM qc_demo_paciente WHERE id=$1', [id])).rows[0]
        .tratamiento,
    ).toBeNull();
  });
});
