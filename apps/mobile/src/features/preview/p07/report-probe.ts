import { Directory, File, Paths } from 'expo-file-system';
import {
  activeQuestionIds,
  validateFormAnswers,
  type AnswerValue,
} from '@quimiocare/contracts/forms';
import fixture from '../../../../../../packages/contracts/fixtures/epro-seguimiento-domiciliario-v1_1_0.json';
import { completeDefinition } from '../../../data/sync/catalog';
import { contractForm } from '../../../data/sync/contract-form';
import { canonical } from '../../../data/sync/clinical-command';
import { readClinicalFile } from '../../../data/sync/file-protection';
import { encryptedFile } from '../../../data/sync/native-cipher';
import { reportEpro } from '../../../data/local/reports/report-epro';
import type { ReportData } from '../../../data/local/reports/report-types';
import {
  ExpoBinaryReportStorageAdapter,
  getPatientReportDirectory,
  type BinaryReportStorageAdapter,
} from '../../../data/local/files/report-storage';
import { generateAndPersistReportPdf } from '../../reports/report-pdf';
import { generateAndPersistReportXlsx } from '../../reports/report-xlsx';
import { PowerSyncDatabase } from '@powersync/react-native';
import { Schema } from '@powersync/common';
import * as Crypto from 'expo-crypto';
import { createSyncConnection } from '../../../data/sync/sql-connection';
import { assertEncryptedDatabase, privateSyncLogger } from '../../../data/sync/native-archive';
import { migrateDatabase } from '../../../data/local/migrations';
import { createReportRepository } from '../../../data/local/reports/report-repository';

/** Completely synthetic report fixtures. They never enter a clinical database or upload queue. */
function reportProbeDataset(patientId: string, days: 30 | 365, count: number) {
  const now = new Date().toISOString(),
    millis = Date.parse(now);
  const definition = completeDefinition(
    { ...fixture.formulario, eliminado: false },
    fixture.formulario.preguntas.map((q) => ({
      ...q,
      formulario_id: fixture.formulario.id,
      eliminado: false,
    })),
  );
  const form = contractForm(definition),
    answers: Record<string, AnswerValue> = {};
  for (let n = 0; n < form.preguntas.length; n++) {
    const active = activeQuestionIds(
      form,
      Object.entries(answers).map(([pregunta_id, valor]) => ({ pregunta_id, valor })),
    );
    for (const q of form.preguntas)
      if (active.has(q.id) && !Object.hasOwn(answers, q.id) && q.requerida !== false)
        answers[q.id] =
          q.tipo === 'booleano'
            ? false
            : q.tipo === 'numerico'
              ? 0
              : q.tipo === 'opcion_multiple'
                ? [q.opciones![0].codigo]
                : (q.opciones?.[0].codigo ??
                  'Texto sintético de exportación: áéíóú, sin datos personales. '.repeat(3));
  }
  const active = activeQuestionIds(
    form,
    Object.entries(answers).map(([pregunta_id, valor]) => ({ pregunta_id, valor })),
  );
  for (const id of Object.keys(answers)) if (!active.has(id)) delete answers[id];
  validateFormAnswers(
    form,
    Object.entries(answers).map(([pregunta_id, valor]) => ({ pregunta_id, valor })),
  );
  const vitals: ReportData['vitals'][number][] = [],
    epro: NonNullable<ReportData['epro']>[number][] = [],
    statuses: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    const id = 'synthetic-report-' + i,
      at = new Date(millis - ((count - i) * days * 86400000) / (count + 1)).toISOString();
    if (i % 2 === 0) {
      vitals.push({
        id,
        paciente_id: patientId,
        fecha_registro: at,
        presion_sistolica: 120,
        presion_diastolica: i % 4 === 0 ? null : 80,
        temperatura: 36.6,
        pulso: 72,
        saturacion_o2: 98,
        fecha_subida: null,
        dolor_ena: i % 6 === 0 ? 0 : i % 6 === 2 ? 4 : null,
      });
      statuses[id] = i % 4 === 0 ? 'pendiente' : 'aceptado';
    } else
      epro.push(
        reportEpro({
          id,
          formulario_id: fixture.formulario.id,
          version: String(fixture.formulario.version),
          respuestas_json: canonical(answers),
          fecha_confirmacion: at,
          titulo: null,
          snapshot_json: canonical({
            id,
            owner: 'synthetic',
            environment: 'benchmark',
            submittedAt: at,
            definition,
            answers,
          }),
          status: 'pendiente',
          owner: 'synthetic',
          environment: 'benchmark',
        }),
      );
  }
  const data: ReportData = {
    pacienteId: patientId,
    periodDays: days,
    generatedAt: now,
    timeZone: 'America/Santiago',
    periodStart: new Date(millis - days * 86400000).toISOString(),
    periodEnd: now,
    profile: null,
    treatment: null,
    linkingCode: {
      status: 'unavailable',
      displayText: 'No disponible',
      code: null,
      expiresAt: null,
      obtainedAt: null,
    },
    summary: {
      vitalsCount: vitals.length,
      symptomsCount: 0,
      avgTemperature: 36.6,
      avgPulse: 72,
      avgSystolic: 120,
      avgDiastolic: 80,
      avgOxygenSaturation: 98,
      minTemperature: 36.6,
      maxTemperature: 36.6,
      minPulse: 72,
      maxPulse: 72,
    },
    vitals,
    symptoms: [],
    epro,
    syncStatuses: statuses,
  };
  return { data, definition, answers };
}

async function probeRepository(patientId: string, run: string, days: 30 | 365, count: number) {
  const dir = new Directory(Paths.cache, 'p07_sql_benchmark');
  dir.create({ intermediates: true, idempotent: true });
  const file = new File(dir, run + '-' + days + '.db');
  if (file.exists) throw new Error('Conserva el intento previo y usa otro identificador.');
  const database = new PowerSyncDatabase({
    schema: new Schema({}),
    logger: privateSyncLogger,
    database: {
      dbFilename: file.name!,
      dbLocation: dir.uri.replace(/^file:\/\//, ''),
      sqliteOptions: { encryptionKey: Crypto.randomUUID().replace(/-/g, '') },
    },
  });
  try {
    await database.waitForReady();
    const db = createSyncConnection(database);
    await assertEncryptedDatabase(db);
    await migrateDatabase(db);
    const { data, definition, answers } = reportProbeDataset(patientId, days, count);
    await db.transaction(async (tx) => {
      await tx.run('INSERT INTO paciente_cache(paciente_id,nombre,obtenido_en) VALUES (?,?,?)', [
        patientId,
        'Synthetic benchmark',
        data.generatedAt,
      ]);
      await tx.run(
        'INSERT INTO formulario_cache(formulario_id,version,titulo,descripcion,configuracion_json,obtenido_en) VALUES (?,?,?,?,?,?)',
        [
          fixture.formulario.id,
          String(fixture.formulario.version),
          fixture.formulario.titulo,
          '',
          canonical(fixture.formulario.configuracion),
          data.generatedAt,
        ],
      );
      for (const v of data.vitals) {
        await tx.run(
          'INSERT INTO signos_vitales(id,paciente_id,fecha_registro,presion_sistolica,presion_diastolica,temperatura,pulso,saturacion_o2,creado_localmente_en,dolor_ena) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [
            v.id,
            patientId,
            v.fecha_registro,
            v.presion_sistolica,
            v.presion_diastolica,
            v.temperatura,
            v.pulso,
            v.saturacion_o2,
            v.fecha_registro,
            v.dolor_ena ?? null,
          ],
        );
        const status = data.syncStatuses![v.id];
        await tx.run(
          'INSERT INTO qc_clinical_command(id,owner,environment,kind,captured_at,payload_json,status,ack_json,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
          [
            v.id,
            'synthetic',
            'benchmark',
            'signos',
            v.fecha_registro,
            '{}',
            status,
            status === 'aceptado' ? '{}' : null,
            v.fecha_registro,
          ],
        );
      }
      for (const c of data.epro ?? []) {
        await tx.run(
          'INSERT INTO respuesta_formulario(id,paciente_id,formulario_id,version,respuestas_json,fecha_confirmacion,creado_localmente_en) VALUES (?,?,?,?,?,?,?)',
          [c.id, patientId, c.formId, c.version, canonical(answers), c.capturedAt, c.capturedAt],
        );
        await tx.run(
          'INSERT INTO qc_clinical_command(id,owner,environment,kind,captured_at,payload_json,status,updated_at) VALUES (?,?,?,?,?,?,?,?)',
          [c.id, 'synthetic', 'benchmark', 'epro', c.capturedAt, '{}', 'pendiente', c.capturedAt],
        );
        await tx.run('INSERT INTO qc_storage_control(id,value_json) VALUES (?,?)', [
          'epro:capture:' + c.id,
          canonical({
            id: c.id,
            owner: 'synthetic',
            environment: 'benchmark',
            submittedAt: c.capturedAt,
            definition,
            answers,
          }),
        ]);
      }
    });
    return { repository: createReportRepository(db, patientId), close: () => database.close() };
  } catch (error) {
    await database.close();
    throw error;
  }
}

function isolatedAdapter(patientId: string, run: string) {
  const logical = getPatientReportDirectory(patientId).uri.replace(/\/$/, '');
  const physical = logical + '/p07_benchmark/' + run;
  const base = new ExpoBinaryReportStorageAdapter();
  const map = (uri: string) =>
    uri === logical || uri.startsWith(logical + '/') ? physical + uri.slice(logical.length) : uri;
  const adapter: BinaryReportStorageAdapter = {
    writeBytes: (u, b) => base.writeBytes(map(u), b),
    copyFile: (s, t) => base.copyFile(map(s), map(t)),
    moveFile: (s, t) => base.moveFile(map(s), map(t)),
    deleteFile: (u) => base.deleteFile(map(u)),
    fileExists: (u) => base.fileExists(map(u)),
    directoryExists: (u) => base.directoryExists(map(u)),
    getFileSize: (u) => base.getFileSize(map(u)),
    ensureDirectory: (u) => base.ensureDirectory(map(u)),
    listDirectory: async (u) =>
      (await base.listDirectory(map(u))).map((e) => ({
        ...e,
        uri: e.uri.replace(physical, logical),
      })),
  };
  return { adapter, map };
}

export async function runReportProbe(patientId: string, run: string) {
  if (!/^[a-z0-9-]{1,64}$/.test(run)) throw new Error('Identificador de prueba inválido.');
  const { adapter, map } = isolatedAdapter(patientId, run),
    samples: {
      days: number;
      captures: number;
      format: string;
      iteration: number;
      milliseconds: number;
      succeeded: boolean;
      encrypted?: boolean;
      bytes?: number;
      inspectionFile?: string;
      error?: string;
    }[] = [];
  const output = new Directory(Paths.document, 'p07_acceptance', run);
  output.create({ intermediates: true, idempotent: true });
  for (const [days, count, repetitions] of [
    [30, 100, 5],
    [365, 1000, 1],
  ] as const) {
    const isolated = await probeRepository(patientId, run, days, count);
    try {
      for (const format of ['pdf', 'xlsx'] as const)
        for (let i = 0; i < repetitions; i++) {
          const start = performance.now();
          try {
            const data = await isolated.repository.getReportData(days);
            if (data.vitals.length + (data.epro?.length ?? 0) !== count)
              throw new Error('Dataset incompleto en la consulta del benchmark.');
            const result =
              format === 'pdf'
                ? await generateAndPersistReportPdf(data, adapter)
                : await generateAndPersistReportXlsx(data, adapter);
            const elapsed = performance.now() - start,
              realUri = map(result.persistentUri),
              bytes = await new File(realUri).bytes();
            if (!encryptedFile(bytes)) throw new Error('El reporte de prueba no quedó cifrado.');
            const plain = await readClinicalFile(realUri, bytes);
            if (format === 'pdf' && new TextDecoder().decode(plain.slice(0, 5)) !== '%PDF-')
              throw new Error('PDF inválido.');
            if (format === 'xlsx' && (plain[0] !== 80 || plain[1] !== 75))
              throw new Error('XLSX inválido.');
            const name = 'synthetic-' + days + 'd.' + format;
            new File(output, name).write(plain);
            samples.push({
              days,
              captures: count,
              format,
              iteration: i + 1,
              milliseconds: elapsed,
              succeeded: true,
              encrypted: true,
              bytes: plain.length,
              inspectionFile: name,
            });
          } catch (error) {
            samples.push({
              days,
              captures: count,
              format,
              iteration: i + 1,
              milliseconds: performance.now() - start,
              succeeded: false,
              error: error instanceof Error ? error.message : 'Fallo de generación',
            });
            break;
          }
          await new Promise((r) => setTimeout(r, 50));
        }
    } finally {
      await isolated.close();
    }
  }
  return {
    passed: samples.length === 12 && samples.every((s) => s.succeeded),
    dataset:
      'synthetic isolated encrypted DB, never connected; 50% vitals, 50% ePRO with contract-valid answers; original patient DB unchanged',
    timingScope:
      'local query + generation + encrypted persistence; excludes synthetic DB seeding, validation copies and share dialog',
    samples,
    regularGenerationBelow3s:
      samples.filter((s) => s.days === 30).length === 10 &&
      samples.filter((s) => s.days === 30).every((s) => s.succeeded && s.milliseconds < 3000),
    directory: output.uri,
  };
}
