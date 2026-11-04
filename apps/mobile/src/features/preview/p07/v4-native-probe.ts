import { File, Directory, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { PowerSyncDatabase } from '@powersync/react-native';
import { clinicalSyncSchema } from '../../../data/sync/schema';
import { runSdkHttpProbe } from './sdk-http-probe';
import { migrateDatabase, migrations } from '../../../data/local/migrations';
import { migratePain18 } from '../../../data/local/migrations/018_dolor_ena_compatible';
import { legacyPain14Sql } from '../../../data/local/testing/legacy-pain14-fixture';
import { createSyncConnection } from '../../../data/sync/sql-connection';
import { createPatientRepository } from '../../../data/local/repository';
import { canonical, enqueueClinicalCommand } from '../../../data/sync/clinical-command';
import { assertEncryptedDatabase, privateSyncLogger } from '../../../data/sync/native-archive';
import { createNativeFileCipher } from '../../../data/sync/native-cipher';
import { activateFileCipher } from '../../../data/sync/file-protection';
import { proposal, questions } from '../../triage/triage-definition';
import { evaluateOrientation, type OrientationInput } from '../../triage/triage-engine';
import { runReportProbe } from './report-probe';

const patient = '11111111-1111-4111-8111-111111111111';
const owner = '964d32f1-6941-579f-9f08-b60342194da9';
const check = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};

export function runOrientationBenchmark() {
  const samples: { index: number; milliseconds: number; result: string | null }[] = [];
  for (let i = 0; i < 100; i++) {
    const input: OrientationInput = {
      answers: Object.fromEntries(questions.map((q) => [q.id, q.group === 'C' ? 'yes' : 'no'])),
      informant: 'PACIENTE',
      pain: i % 4 === 1 ? 8 : 0,
    };
    if (i % 4 === 2) input.answers['A1-RESP'] = 'yes';
    if (i % 4 === 3) input.answers['A2-INGESTA'] = 'yes';
    const start = performance.now();
    const result = evaluateOrientation(input, 'synthetic');
    const elapsed = performance.now() - start;
    check(
      result.outcome === (['C', 'B', 'A1', 'A2'] as const)[i % 4],
      'Resultado técnico inesperado.',
    );
    samples.push({ index: i, milliseconds: elapsed, result: result.outcome });
  }
  const sorted = samples.map((s) => s.milliseconds).sort((a, b) => a - b);
  check(
    evaluateOrientation({ answers: {}, informant: null, pain: null }).availability === 'disabled',
    'El borrador se habilitó en uso normal.',
  );
  return {
    passed: sorted.every((n) => n < 500),
    samples,
    minimum: sorted[0],
    median: (sorted[49] + sorted[50]) / 2,
    p95: sorted[94],
    maximum: sorted[99],
    rulesVersion: proposal.version,
    clinicalValidation: false,
    scope:
      '100 synthetic technical evaluations; no independent clinical corpus or sensitivity claim',
  };
}

export async function runMigrationProbe(run: string) {
  const directory = new Directory(Paths.cache, 'p07_v4_migration');
  directory.create({ intermediates: true, idempotent: true });
  const results: Record<string, unknown>[] = [];
  // Exact synthetic PNG fixture bytes; SHA256 3928618d567aa706302b2f1a7278e3758fee6d69637a075813c3ee5a565d747a.
  // Embedded to avoid Android drawable resource names being treated as file URIs.
  const originalImage = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 2, 0, 0, 0, 2, 8, 6, 0,
    0, 0, 114, 182, 13, 36, 0, 0, 0, 20, 73, 68, 65, 84, 120, 156, 99, 144, 201, 91, 242, 223, 121,
    85, 247, 127, 6, 24, 3, 0, 77, 126, 9, 73, 81, 196, 131, 251, 0, 0, 0, 0, 73, 69, 78, 68, 174,
    66, 96, 130,
  ]);
  const keptImage = new File(directory, run + '-kept.png');
  check(!keptImage.exists, 'Conserva el archivo de un intento previo.');
  keptImage.write(originalImage);
  const captureId = '55555555-5555-4555-8555-555555555555';
  const sdkSnapshot = async (database: PowerSyncDatabase) => {
    const transaction = await database.getNextCrudTransaction();
    check(transaction?.crud.length === 1, 'Falta la operación real del SDK.');
    return canonical(
      transaction!.crud.map((entry) => ({
        id: entry.id,
        table: entry.table,
        op: entry.op,
        opData: entry.opData,
      })),
    );
  };
  for (const source of [13, 14, 15, 16, 17, 'pain14', 'interruption'] as const) {
    const file = new File(directory, `${run}-${source}.db`);
    check(!file.exists, 'Conserva el intento previo y usa otro identificador.');
    const key = Crypto.randomUUID().replaceAll('-', '');
    const open = () =>
      new PowerSyncDatabase({
        schema: clinicalSyncSchema,
        logger: privateSyncLogger,
        database: {
          dbFilename: file.name!,
          dbLocation: directory.uri.replace(/^file:\/\//, ''),
          sqliteOptions: { encryptionKey: key },
        },
      });
    let database = open();
    try {
      await database.waitForReady();
      let db = createSyncConnection(database);
      await assertEncryptedDatabase(db);
      const version = source === 'pain14' ? 13 : source === 'interruption' ? 17 : source;
      await migrateDatabase(
        db,
        migrations.filter((m) => m.version <= version),
      );
      const capturedAt = '2026-10-28T05:03:09.346Z';
      await db.run(
        'INSERT INTO signos_vitales(id,paciente_id,fecha_registro,temperatura,pulso,creado_localmente_en) VALUES (?,?,?,?,?,?)',
        [captureId, patient, capturedAt, 36.5, 72, capturedAt],
      );
      await db.run(
        "INSERT INTO cola_envio(id,paciente_id,tipo_entidad,registro_id,payload_json,estado,creado_en,actualizado_en) VALUES (?,?,'signos_vitales',?,?,'pendiente',?,?)",
        [
          'synthetic-queue',
          patient,
          captureId,
          '{"synthetic":"original-payload"}',
          capturedAt,
          capturedAt,
        ],
      );
      if (source === 'pain14') {
        await db.exec(legacyPain14Sql);
        await db.run('UPDATE signos_vitales SET dolor_ena=0 WHERE id=?', [captureId]);
        await db.exec('PRAGMA user_version=14');
        // The legacy fixture changes DDL outside the normal migration runner.
        await db.refreshSchema?.();
      }
      const before = await db.first<Record<string, string | number | null>>(
        'SELECT * FROM signos_vitales WHERE id=?',
        [captureId],
      );
      const frozenBefore = JSON.parse(canonical(before)) as Record<string, string | number | null>;
      await db.run('INSERT INTO paciente_cache(paciente_id,nombre,obtenido_en) VALUES (?,?,?)', [
        patient,
        'Paciente sintético P07',
        capturedAt,
      ]);
      await db.run(
        'INSERT INTO formulario_cache(formulario_id,version,titulo,descripcion,obtenido_en) VALUES (?,?,?,?,?)',
        ['synthetic-form', '1', 'Borrador sintético', 'Prueba de preservación', capturedAt],
      );
      await db.run(
        'INSERT INTO borrador_formulario(paciente_id,formulario_id,version,periodo_clave,entrega_id,respuestas_json,paso_actual,guardado_en) VALUES (?,?,?,?,?,?,?,?)',
        [
          patient,
          'synthetic-form',
          '1',
          '2026-10-28',
          'synthetic-delivery',
          '{"synthetic":"unchanged-draft"}',
          'step-2',
          capturedAt,
        ],
      );
      const draftBefore = canonical(await db.all('SELECT * FROM borrador_formulario'));
      const medicationColumns =
        'id,paciente_id,medicamento_id,medicamento_nombre,dosis,fecha_hora,estado,notas,registrado_en';
      const medicationExists = await db.first(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='qc_medication_intake_log'",
      );
      if (medicationExists) {
        const columns = await db.all<{ name: string }>(
          'PRAGMA table_info(qc_medication_intake_log)',
        );
        const scheduled = columns.some((column) => column.name === 'fecha_civil');
        await db.run(
          'INSERT INTO qc_medication_intake_log(' +
            medicationColumns +
            (scheduled ? ',fecha_civil,horario_programado' : '') +
            ') VALUES (?,?,?,?,?,?,?,?,?' +
            (scheduled ? ',?,?' : '') +
            ')',
          [
            'synthetic-intake',
            patient,
            'synthetic-med',
            'Ejemplo ficticio',
            'Dato ficticio',
            capturedAt,
            'taken',
            null,
            capturedAt,
            ...(scheduled ? ['2026-10-28', '10:00'] : []),
          ],
        );
      }
      const medicationBefore = medicationExists
        ? canonical(await db.all('SELECT ' + medicationColumns + ' FROM qc_medication_intake_log'))
        : '[]';
      await db.transaction((tx) =>
        enqueueClinicalCommand(
          tx,
          { owner, localPatientId: patient, environment: 'p07-preservation' },
          {
            kind: 'signos',
            capturedAt,
            legacyQueueId: 'synthetic-queue',
            registeredAt: null,
            payload: {
              id: captureId,
              fecha_registro: capturedAt,
              temperatura: 36.5,
              pulso: 72,
              presion_arterial_sistolica: null,
              presion_arterial_diastolica: null,
              saturacion_oxigeno: null,
              ...(source === 'pain14' ? { version_dolor: 1, dolor_ena: 0 } : {}),
            },
          },
        ).then(() => undefined),
      );
      const sdkBefore = await sdkSnapshot(database);
      const queue = canonical(await db.all('SELECT * FROM cola_envio'));
      const readCapture = () =>
        db.first(
          'SELECT id,paciente_id,id_ficha_clinica,tratamiento_id,fecha_registro,presion_sistolica,presion_diastolica,pulso,temperatura,saturacion_o2,creado_localmente_en,fecha_subida,dolor_ena FROM signos_vitales WHERE id=?',
          [captureId],
        );
      if (source === 'interruption') {
        let failed = false;
        try {
          await migrateDatabase(db, [
            {
              version: 18,
              run: async (tx) => {
                await migratePain18(tx);
                throw new Error('synthetic-stop');
              },
            },
          ]);
        } catch {
          failed = true;
        }
        check(failed, 'No se produjo la interrupción controlada.');
        check(
          (await db.first<{ user_version: number }>('PRAGMA user_version'))?.user_version === 17,
          'El rollback modificó la versión.',
        );
        check(
          canonical(await db.first('SELECT * FROM signos_vitales WHERE id=?', [captureId])) ===
            canonical(before),
          'El rollback modificó datos.',
        );
      }
      await migrateDatabase(db);
      const expected = { ...frozenBefore, dolor_ena: source === 'pain14' ? 0 : null };
      const actual = await readCapture();
      const cachedProjection = await db.first('SELECT * FROM signos_vitales WHERE id=?', [
        captureId,
      ]);
      check(
        canonical(cachedProjection) === canonical(expected),
        'Diagnóstico sintético de lectura ' +
          canonical({ source, expected, cachedProjection, actual }),
      );
      const repositoryCapture = await createPatientRepository(db, patient, Crypto.randomUUID).vital(
        captureId,
      );
      check(
        repositoryCapture &&
          Object.entries(expected).every(
            ([key, value]) =>
              (repositoryCapture as unknown as Record<string, unknown>)[key] === value,
          ),
        'La lectura habitual alteró la captura después de migrar.',
      );
      check(
        canonical(actual) === canonical(expected),
        'Comparación sintética ' + source + ': ' + canonical({ expected, actual }),
      );
      check(
        canonical(await db.all('SELECT * FROM cola_envio')) === queue,
        'Cambió el snapshot de cola.',
      );
      check(
        (await db.first<{ user_version: number }>('PRAGMA user_version'))?.user_version === 19,
        'Falta una migración.',
      );
      check((await db.all('PRAGMA foreign_key_check')).length === 0, 'Se alteró una referencia.');
      check(
        canonical(await db.all('SELECT * FROM borrador_formulario')) === draftBefore,
        'Cambió el borrador.',
      );
      check(
        canonical(
          await db.all('SELECT ' + medicationColumns + ' FROM qc_medication_intake_log'),
        ) === medicationBefore,
        'Cambió la bitácora.',
      );
      check((await sdkSnapshot(database)) === sdkBefore, 'Cambió la operación pendiente del SDK.');
      const imageAfter = await keptImage.bytes();
      check(
        imageAfter.length === originalImage.length &&
          imageAfter.every((value, index) => value === originalImage[index]),
        'Cambió la imagen local.',
      );

      await database.close();
      database = open();
      await database.waitForReady();
      db = createSyncConnection(database);
      await assertEncryptedDatabase(db);
      await migrateDatabase(db);
      check(
        canonical(await readCapture()) === canonical(expected),
        'La reapertura perdió datos en ' + source + '.',
      );
      check(
        canonical(await db.all('SELECT * FROM cola_envio')) === queue,
        'La reapertura alteró la cola.',
      );
      check(
        canonical(await db.all('SELECT * FROM borrador_formulario')) === draftBefore,
        'La reapertura perdió el borrador.',
      );
      check(
        canonical(
          await db.all('SELECT ' + medicationColumns + ' FROM qc_medication_intake_log'),
        ) === medicationBefore,
        'La reapertura cambió la bitácora.',
      );
      check((await sdkSnapshot(database)) === sdkBefore, 'La reapertura alteró la cola SDK.');
      results.push({
        repositoryReadPreserved: true,
        draftPreserved: true,
        medicationHistoryPreserved: true,
        imageBytesPreserved: true,
        sdkPendingPreserved: true,
        source,
        passed: true,
        encrypted: true,
        reopened: true,
        version: 19,
        cachedStarProjectionMatches: canonical(cachedProjection) === canonical(expected),
        frozenBeforeKeys: Object.keys(frozenBefore),
        captureHash: await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          canonical(expected),
        ),
        queueHash: await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, queue),
      });
    } finally {
      await database.close();
    }
  }
  return {
    passed: results.length === 7,
    results,
    scope:
      'Independent encrypted synthetic databases; no original patient database accessed; no upload connection',
  };
}

export async function runP07V4Probe(
  run: string,
  action: 'migration' | 'orientation' | 'reports' | 'sdk',
) {
  check(
    process.env.EXPO_PUBLIC_APP_ENV === 'demo' &&
      process.env.EXPO_PUBLIC_P07_SYNTHETIC_REVIEW === 'true',
    'Laboratorio deshabilitado.',
  );
  check(/^[a-z0-9-]{1,48}$/.test(run), 'Identificador de prueba inválido.');
  const startedAt = new Date().toISOString();
  let result: Record<string, unknown>;
  try {
    if (action === 'migration') result = await runMigrationProbe(run);
    else if (action === 'orientation') result = runOrientationBenchmark();
    else if (action === 'sdk') result = await runSdkHttpProbe(run);
    else {
      // This run owns a new test-only namespace; never replace a missing existing patient's key.
      const cipher = await createNativeFileCipher('p07-v4-synthetic-review:' + run, owner, patient);
      const release = activateFileCipher(cipher);
      try {
        result = await runReportProbe(patient, run);
      } finally {
        release();
      }
    }
  } catch (error) {
    result = { passed: false, error: error instanceof Error ? error.message : 'Fallo técnico' };
  }
  const output = { run, action, startedAt, finishedAt: new Date().toISOString(), ...result };
  const directory = new Directory(Paths.document, 'p07_v4_results');
  directory.create({ intermediates: true, idempotent: true });
  new File(directory, `${run}-${action}.json`).write(JSON.stringify(output));
  return output;
}
