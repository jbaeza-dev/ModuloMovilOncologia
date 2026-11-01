import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { PNG } from 'pngjs';
import { fixtures, validateResponse } from '@quimiocare/contracts';
import { openDatabase, migrate, type Database } from '../src/db.js';
import { readConfig, type SimulatorConfig } from '../src/config.js';
import { seedDatabase } from '../src/seed-data.js';
import { issueSession } from '../src/auth.js';
import { createSimulator } from '../src/app.js';
import { PATIENTS } from '../src/types.js';
import { enterMutation } from '../src/mutation-gate.js';

async function powershell(script: string, args: string[]) {
  // The recovery scripts use .NET APIs from PowerShell 7; Windows PowerShell 5 is not sufficient.
  const binary = process.env.POWERSHELL_BIN ?? 'pwsh';
  const child = spawn(
    binary,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
    {
      cwd: join(import.meta.dirname, '../../..'),
      windowsHide: true,
    },
  );
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += String(chunk);
  });
  child.stderr.on('data', (chunk) => {
    output += String(chunk);
  });
  const [code] = await once(child, 'exit');
  // Never include credentials or command arguments in a failed assertion.
  return { code, output: output.replaceAll(token ?? '', '[token]') };
}

const source = process.env.TEST_DATABASE_URL;
if (!source || !new URL(source).pathname.endsWith('_test'))
  throw new Error('TEST_DATABASE_URL must name a disposable *_test database.');
const dbName = 'qc_preparation_' + randomUUID().replaceAll('-', '') + '_test';
let db: Database,
  config: SimulatorConfig,
  server: Server,
  base: string,
  media: string,
  token: string,
  patientToken: string;
const definitions = fixtures.mobile as unknown as {
  operaciones: Record<string, { response: Record<string, unknown> }>;
};
async function listen(database = db) {
  const instance = createSimulator(config, database);
  instance.listen(0, '127.0.0.1');
  await once(instance, 'listening');
  return { instance, url: 'http://127.0.0.1:' + (instance.address() as { port: number }).port };
}
async function call(path: string, body?: unknown, auth = token, url = base) {
  const response = await fetch(url + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      authorization: 'Bearer ' + auth,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}
const prep = (action: string, body: Record<string, unknown> = {}, auth = token) =>
  call('/admin/api/v1/preparacion/' + action, { operacion_id: randomUUID(), ...body }, auth);
function imageForm(
  operation = randomUUID(),
  bytes: Uint8Array = PNG.sync.write(new PNG({ width: 2, height: 2 })),
) {
  const form = new FormData();
  form.set('archivo', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'test.png');
  form.set('titulo', 'Imagen sintética');
  form.set('descripcion', 'Prueba automática sin contenido médico.');
  form.set('categoria', 'Categoría de evaluación');
  form.set('operacion_id', operation);
  return form;
}
async function upload(form: FormData, url = base) {
  const response = await fetch(url + '/admin/api/v1/preparacion/contenido-educativo/imagenes', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token },
    body: form,
  });
  return { status: response.status, body: await response.json() };
}
beforeAll(async () => {
  const admin = openDatabase(source!);
  await admin.query('CREATE DATABASE ' + dbName);
  await admin.end();
  const url = new URL(source!);
  url.pathname = '/' + dbName;
  db = openDatabase(url.href);
  media = await mkdtemp(join(tmpdir(), 'qc-preparation-'));
  config = readConfig({
    APP_ENV: 'demo',
    DATABASE_URL: url.href,
    DEMO_CONTROL_KEY: 'integration-local-control-key-not-production',
    DEMO_SIGNING_KEY: 'integration-local-signing-key-not-production',
    SIMULATOR_PUBLIC_BASE_URL: 'http://127.0.0.1:1',
    PREPARATION_ENABLED: 'true',
    API_DOCS_ENABLED: 'true',
    EDUCATION_MEDIA_ROOT: join(media, 'images'),
    EDUCATION_TEMP_DIR: join(media, 'temp'),
  });
  await migrate(db);
  await seedDatabase(db, config.publicBaseUrl);
  await db.query(
    'INSERT INTO qc_demo_operador(id,auth_issuer,auth_subject,email,nombre) VALUES($1::uuid,$2,$1::text,$3,$4)',
    [PATIENTS.A, config.issuer, 'operator@example.test', 'Operador sintético'],
  );
  token = (await issueSession(db, config, 'A')).access_token;
  patientToken = (await issueSession(db, config, 'B')).access_token;
  const runtime = await listen();
  server = runtime.instance;
  base = runtime.url;
  config.publicBaseUrl = base;
});
afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await db?.end();
  const admin = openDatabase(source!);
  await admin.query('DROP DATABASE ' + dbName);
  await admin.end();
  if (media) await rm(media, { recursive: true, force: true });
});
describe('Preparation HTTP with real PostgreSQL', () => {
  it('checks operator access without creating a patient and redirects the retired panel', async () => {
    expect((await call('/quimiocare/admin/api/v1/preparacion/acceso')).body.autorizado).toBe(true);
    expect((await call('/admin/api/v1/preparacion/acceso', undefined, patientToken)).status).toBe(
      403,
    );
    const absent = await fetch(base + '/admin/api/v1/preparacion/acceso');
    expect(absent.status).toBe(401);
    const redirect = await fetch(base + '/quimiocare/admin/', { redirect: 'manual' });
    expect(redirect.status).toBe(308);
    expect(redirect.headers.get('location')).toBe('/quimiocare/docs/preparacion/');
  });
  it('serves the main preparation docs, editable examples and assets', async () => {
    const page = await fetch(base + '/quimiocare/docs/preparacion/');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Preparar datos');
    expect((await fetch(base + '/quimiocare/docs/preparacion/static/swagger-ui.css')).status).toBe(
      200,
    );
    const spec = await call('/quimiocare/docs/preparacion/openapi.json');
    expect(Object.keys(spec.body.paths)).toHaveLength(12);
    expect(
      spec.body.paths['/admin/api/v1/preparacion/terminos'].post.requestBody.content[
        'application/json'
      ].example.definicion.texto_completo,
    ).toBeTruthy();
  });
  it('protects every contract alias with the persisted active operator permission', async () => {
    const paths = [
      '/docs/preparacion/openapi.json',
      '/docs/openapi.json',
      '/docs/evaluacion/openapi.json',
      '/quimiocare/docs/preparacion/openapi.json',
      '/quimiocare/docs/openapi.json',
      '/quimiocare/docs/evaluacion/openapi.json',
    ];
    for (const path of paths) {
      expect((await fetch(base + path)).status).toBe(401);
      expect((await call(path, undefined, patientToken)).status).toBe(403);
      expect((await call(path)).status).toBe(200);
    }
    await db.query('UPDATE qc_demo_operador SET activo=false WHERE id=$1', [PATIENTS.A]);
    try {
      expect((await call(paths[0]!)).status).toBe(403);
    } finally {
      await db.query('UPDATE qc_demo_operador SET activo=true WHERE id=$1', [PATIENTS.A]);
    }
  });
  it('does not authorize a patient as operator; is disabled by default', async () => {
    expect((await prep('categorias', { nombre: 'No autorizada' }, patientToken)).status).toBe(403);
    const enabled = config.preparationEnabled ?? false;
    config.preparationEnabled = false;
    try {
      expect((await prep('categorias', { nombre: 'Disabled' })).status).toBe(404);
    } finally {
      config.preparationEnabled = enabled;
    }
  });
  it('normalizes categories and serializes concurrent operation replay', async () => {
    const operation = randomUUID();
    const results = await Promise.all([
      prep('categorias', { nombre: 'Categoría de evaluación', operacion_id: operation }),
      prep('categorias', { nombre: 'Categoría de evaluación', operacion_id: operation }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(results[0]!.body).toEqual(results[1]!.body);
    expect(
      (await prep('categorias', { nombre: 'Otro nombre', operacion_id: operation })).status,
    ).toBe(409);
    expect((await prep('categorias', { nombre: '  CATEGORÍA   DE EVALUACIÓN  ' })).status).toBe(
      200,
    );
  });
  it('rejects operation ownership changes across JSON and image preparation', async () => {
    const operation = randomUUID();
    const data = { operacion_id: operation, nombre: 'Propiedad de operación' };
    expect((await prep('categorias', data)).status).toBe(201);
    await db.query(
      'INSERT INTO qc_demo_operador(id,auth_issuer,auth_subject,email,nombre) VALUES($1::uuid,$2,$1::text,$3,$4)',
      [PATIENTS.B, config.issuer, 'second-operator@example.test', 'Segundo operador sintético'],
    );
    try {
      expect((await prep('categorias', data, patientToken)).status).toBe(403);
      const form = imageForm(operation);
      form.set('categoria', data.nombre);
      const cross = await fetch(base + '/admin/api/v1/preparacion/contenido-educativo/imagenes', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + patientToken },
        body: form,
      });
      expect(cross.status).toBe(403);
      expect(
        Number(
          (
            await db.query(
              'SELECT count(*) AS n FROM qc_preparacion_operacion WHERE operador_id=$1',
              [PATIENTS.B],
            )
          ).rows[0].n,
        ),
      ).toBe(0);
    } finally {
      await db.query('DELETE FROM qc_demo_operador WHERE id=$1', [PATIENTS.B]);
    }
  });
  it('publishes terms and reflects pending, accepted and revoked synthetic consent in C-15', async () => {
    const id = randomUUID();
    const definition = {
      ...fixtures.approvedTerms,
      id,
      version: 'test-unique',
      titulo: 'Términos sintéticos',
      texto_completo: 'Documento de prueba, no institucional.',
    };
    expect((await prep('terminos', { definicion: definition })).status).toBe(201);
    expect((await prep(`terminos/${id}/publicar`)).status).toBe(200);
    const terms = await call('/api/v1/terminos/vigente');
    expect(terms.body.id).toBe(id);
    expect(validateResponse('C-14', 200, terms.body).valid).toBe(true);
    expect((await call('/api/v1/pacientes/me/consentimientos')).body.requiere_aceptacion).toBe(
      true,
    );
    const accepted = await prep(`pacientes/${PATIENTS.A}/consentimiento-demo`, {
      estado: 'aceptado',
    });
    expect(accepted.status).toBe(201);
    expect((await call('/api/v1/pacientes/me/consentimientos')).body.requiere_aceptacion).toBe(
      false,
    );
    expect(
      (
        await prep(`pacientes/${PATIENTS.A}/consentimiento-demo`, {
          estado: 'revocado',
          consentimiento_id: accepted.body.consentimiento_id,
        })
      ).status,
    ).toBe(200);
    expect((await call('/api/v1/pacientes/me/consentimientos')).body.requiere_aceptacion).toBe(
      true,
    );
    await prep(`pacientes/${PATIENTS.A}/consentimiento-demo`, { estado: 'pendiente' });
    const audit = await db.query(
      "SELECT origen FROM qc_preparacion_auditoria WHERE paciente_id=$1 AND accion LIKE '%consentimiento-demo'",
      [PATIENTS.A],
    );
    expect(audit.rows.every((r) => r.origen === 'simulacion')).toBe(true);
    // Normal acceptance remains the actual contractual operation, not the preparation API.
    const real = await call('/api/v1/pacientes/me/consentimientos', {
      definicion_terminos_id: id,
      operacion_id: randomUUID(),
      codigo: 'TERMINOS_PLATAFORMA',
    });
    expect(real.status).toBe(201);
    expect(validateResponse('C-16', 201, real.body).valid).toBe(true);
  });
  it('assigns and clears individual context without completing profile or accepting terms', async () => {
    const before = (await db.query('SELECT perfil FROM qc_demo_paciente WHERE id=$1', [PATIENTS.B]))
      .rows[0].perfil;
    const clinical = { ...definitions.operaciones['API-03']!.response };
    delete clinical.id;
    clinical.medicamentos = [];
    const treatment = { ...definitions.operaciones['API-04']!.response };
    delete treatment.id;
    const result = await prep(`pacientes/${PATIENTS.B}/contexto-clinico`, {
      perfil_clinico: clinical,
      tratamiento: treatment,
    });
    expect(result.status).toBe(200);
    expect(
      (await call('/api/v1/pacientes/me/perfil-clinico', undefined, patientToken)).body.id,
    ).toBe(result.body.perfil_clinico.id);
    expect(
      (await db.query('SELECT perfil FROM qc_demo_paciente WHERE id=$1', [PATIENTS.B])).rows[0]
        .perfil,
    ).toEqual(before);
    expect(
      (
        await prep(`pacientes/${PATIENTS.A}/contexto-clinico`, {
          perfil_clinico: result.body.perfil_clinico,
        })
      ).status,
    ).toBe(409);
    expect(
      (await prep(`pacientes/${PATIENTS.B}/contexto-clinico`, { tratamiento: null })).status,
    ).toBe(200);
    expect(
      (await call('/api/v1/pacientes/me/tratamiento-activo', undefined, patientToken)).status,
    ).toBe(404);
  });
  it('publishes a new form and retains the old contractual definition', async () => {
    const form = structuredClone(fixtures.followupForm.formulario);
    form.id = randomUUID();
    form.codigo = 'FORM_TEST';
    form.version = 9;
    for (const q of form.preguntas) q.id = randomUUID();
    const created = await prep('formularios', { formulario: form });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect((await prep(`formularios/${form.id}/publicar`)).status).toBe(200);
    const current = await call('/api/v1/formularios/activo?tipo_tratamiento=quimioterapia');
    expect(current.body.id).toBe(form.id);
    expect(validateResponse('C-08', 200, current.body).valid).toBe(true);
    expect((await call('/api/v1/formularios/' + fixtures.followupForm.formulario.id)).status).toBe(
      200,
    );
  });
  it('persists an HTTP upload and publishes eligible metadata and verified bytes', async () => {
    const result = await upload(imageForm());
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    const row = (await db.query('SELECT * FROM contenido_educativo WHERE id=$1', [result.body.id]))
      .rows[0];
    expect(row.qc_mobile_eligible).toBe(true);
    const response = await fetch(result.body.url);
    expect(response.status).toBe(200);
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(row.archivo_sha256);
    expect((await call('/api/v1/contenido-educativo/' + row.id)).body.id).toBe(row.id);
    expect((await call('/api/v1/contenido-educativo/categorias')).body.categorias).toContain(
      'Categoría de evaluación',
    );
    await prep(`contenido-educativo/${row.id}/estado`, { activo: false });
    expect((await fetch(result.body.url)).status).toBe(404);
    expect(
      (await readFile(join(config.educationMediaRoot, row.id, row.archivo_revision + '.png')))
        .length,
    ).toBe(bytes.length);
  });
  it('replays concurrent uploads without duplicating file records', async () => {
    const operation = randomUUID();
    const results = await Promise.all([upload(imageForm(operation)), upload(imageForm(operation))]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(results[0]!.body.id).toBe(results[1]!.body.id);
    const changed = imageForm(operation);
    changed.set('titulo', 'Otro título');
    expect((await upload(changed)).status).toBe(409);
  });
  it('rejects corrupted, oversized, missing-name and excessive-resolution uploads', async () => {
    expect((await upload(imageForm(randomUUID(), new Uint8Array([1, 2, 3])))).status).toBe(422);
    expect(
      (await upload(imageForm(randomUUID(), new Uint8Array(5 * 1024 * 1024 + 1)))).status,
    ).toBe(413);
    const bad = imageForm();
    bad.delete('archivo');
    bad.set('otro', new Blob(['x']), 'fake.png');
    expect((await upload(bad)).status).toBe(422);
    const png = PNG.sync.write(new PNG({ width: 1, height: 1 }));
    png.writeUInt32BE(10000, 16);
    png.writeUInt32BE(10000, 20);
    expect((await upload(imageForm(randomUUID(), png))).status).toBe(422);
    expect(await readdir(config.educationTempDir)).toEqual([]);
  });
  it('registers videos and applies per-patient scenarios', async () => {
    const video = await prep('contenido-educativo/videos', {
      titulo: 'Video sintético',
      descripcion: 'Prueba de contrato',
      categoria: 'Categoría de evaluación',
      url: 'https://www.youtube.com/watch?v=psfP_n8eP40',
    });
    expect(video.status).toBe(201);
    expect((await call('/api/v1/contenido-educativo/' + video.body.id)).body.tipo).toBe('video');
    expect(
      (await prep(`pacientes/${PATIENTS.B}/escenario`, { escenario: 'SERVICIO_NO_DISPONIBLE' }))
        .status,
    ).toBe(200);
    expect((await call('/api/v1/auth/me', undefined, patientToken)).status).toBe(503);
    await prep(`pacientes/${PATIENTS.B}/escenario`, { escenario: 'NORMAL' });
  });
  it.each(['committed', 'rolled-back', 'unavailable'])(
    'preserves consistency after COMMIT uncertainty: %s',
    async (mode) => {
      let connects = 0;
      const wrapped = {
        query: db.query.bind(db),
        connect: async () => {
          connects++;
          if (mode === 'unavailable' && connects === 2)
            throw new Error('Injected verification outage');
          const client = await db.connect();
          const first = connects === 1;
          return {
            query: async (sql: string, values?: unknown[]) => {
              if (first && sql === 'COMMIT') {
                await client.query(mode === 'rolled-back' ? 'ROLLBACK' : 'COMMIT');
                throw new Error('Injected lost commit response');
              }
              return client.query(sql, values);
            },
            release: (destroy?: boolean) => client.release(destroy),
          };
        },
      } as unknown as Database;
      const runtime = await listen(wrapped);
      const operation = randomUUID();
      try {
        const result = await upload(imageForm(operation), runtime.url);
        const row = (
          await db.query(
            'SELECT resultado FROM qc_demo_operacion_educativa WHERE operacion_id=$1',
            [operation],
          )
        ).rows[0];
        if (mode === 'rolled-back') {
          expect(result.status).toBe(503);
          expect(row).toBeUndefined();
        } else {
          expect(result.status).toBe(mode === 'committed' ? 201 : 503);
          expect(row).toBeDefined();
          const content = row.resultado;
          expect(
            (
              await readFile(
                join(config.educationMediaRoot, content.id, content.archivo_revision + '.png'),
              )
            ).length,
          ).toBe(content.archivo_tamano_bytes);
          const replay = await upload(imageForm(operation));
          expect(replay.status).toBe(200);
          expect(replay.body.id).toBe(content.id);
        }
      } finally {
        await new Promise<void>((resolve) => runtime.instance.close(() => resolve()));
      }
    },
  );
  it('fails closed on maintenance and resumes only after an explicit request', async () => {
    expect((await call('/admin/api/v1/mantenimiento/pausar-publicacion', {})).status).toBe(200);
    try {
      expect((await prep('categorias', { nombre: 'No publicar en respaldo' })).status).toBe(503);
    } finally {
      expect((await call('/admin/api/v1/mantenimiento/reanudar-publicacion', {})).status).toBe(200);
    }
  });
  it.skipIf(!process.env.TEST_DATABASE_CONTAINER)(
    'backs up and restores to NEW disposable targets, and aborts if pause fails',
    async () => {
      const backupRoot = join(media, 'backups');
      const container = process.env.TEST_DATABASE_CONTAINER!;
      const user = decodeURIComponent(new URL(source!).username);
      const common = [
        '-DatabaseContainer',
        container,
        '-DatabaseUser',
        user,
        '-Database',
        dbName,
        '-MediaRoot',
        config.educationMediaRoot,
        '-SimulatorUrl',
        base,
        '-BackupRoot',
        backupRoot,
      ];
      const failed = await powershell('scripts/backup-local.ps1', [
        ...common,
        '-OperatorToken',
        patientToken,
      ]);
      expect(failed.code).not.toBe(0);
      const release = enterMutation();
      try {
        const timedOut = await powershell('scripts/backup-local.ps1', [
          ...common,
          '-OperatorToken',
          token,
        ]);
        expect(timedOut.code).not.toBe(0);
        for (const dir of await readdir(backupRoot))
          expect(await readdir(join(backupRoot, dir))).not.toContain('manifest.json');
      } finally {
        release();
      }
      const backed = await powershell('scripts/backup-local.ps1', [
        ...common,
        '-OperatorToken',
        token,
      ]);
      expect(backed.code, backed.output).toBe(0);
      const dirs = await readdir(backupRoot);
      let snapshot = '';
      for (const dir of dirs) {
        try {
          await readFile(join(backupRoot, dir, 'manifest.json'));
          snapshot = join(backupRoot, dir);
        } catch {
          /* Failed snapshots deliberately have no manifest. */
        }
      }
      expect(snapshot).not.toBe('');
      const restoredName = 'qc_restored_' + randomUUID().replaceAll('-', '') + '_test';
      const storageName = 'qc_storage_' + randomUUID().replaceAll('-', '') + '_test';
      const url = new URL(source!);
      url.pathname = '/' + restoredName;
      const args = [
        '-BackupDir',
        snapshot,
        '-DatabaseContainer',
        container,
        '-DatabaseUser',
        user,
        '-NewDatabase',
        restoredName,
        '-NewPowerSyncStorageDatabase',
        storageName,
        '-VerificationDatabaseUrl',
        url.href,
        '-NewMediaRoot',
        join(media, 'restored'),
      ];
      try {
        const restored = await powershell('scripts/restore-local.ps1', args);
        expect(restored.code, restored.output).toBe(0);
        const copy = openDatabase(url.href);
        try {
          expect(
            Number(
              (await copy.query('SELECT count(*) AS n FROM qc_preparacion_operacion')).rows[0].n,
            ),
          ).toBeGreaterThan(0);
        } finally {
          await copy.end();
        }
        // A working destination is never overwritten, even with valid backup files.
        expect((await powershell('scripts/restore-local.ps1', args)).code).not.toBe(0);
        await appendFile(join(snapshot, 'source.dump'), 'corrupted-test-only');
        const corruptArgs = [...args];
        corruptArgs[corruptArgs.length - 1] = join(media, 'rejected-corrupt-restore');
        const corrupt = await powershell('scripts/restore-local.ps1', corruptArgs);
        expect(corrupt.code).not.toBe(0);
        expect(corrupt.output).toContain('checksum mismatch');
      } finally {
        const admin = openDatabase(source!);
        try {
          for (const name of [restoredName, storageName])
            await admin.query('DROP DATABASE IF EXISTS ' + name);
        } finally {
          await admin.end();
        }
      }
    },
    60000,
  );
});
