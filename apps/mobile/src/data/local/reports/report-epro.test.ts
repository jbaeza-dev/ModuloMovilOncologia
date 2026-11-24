import { shareableReportSnapshot } from '../../../features/reports/report-privacy';
import { afterEach, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import fixture from '../../../../../../packages/contracts/fixtures/epro-seguimiento-domiciliario-v1_1_0.json';
import { completeDefinition } from '../../sync/catalog';
import { canonical } from '../../sync/clinical-command';
import { contractForm } from '../../sync/contract-form';
import { createSqliteTestHarness, patientA, patientB } from '../testing/sqlite-test-harness';
import { migrateDatabase } from '../migrations';
import { createReportRepository } from './report-repository';
import { reportEpro } from './report-epro';
import { buildReportHtml } from '../../../features/reports/report-template';
import { generateReportXlsxBytes } from '../../../features/reports/report-xlsx';
const h = createSqliteTestHarness(),
  when = '2026-10-29T12:00:00.000Z';
afterEach(() => h.cleanup());
describe('reportes P07 de capturas ePRO y estado de envío', () => {
  it('comparte el diccionario de preguntas sin omitir respuestas de capturas distintas', async () => {
    const db = h.open();
    await migrateDatabase(db);
    const data = await createReportRepository(db, patientA, () => when).getReportData(30);
    const captures = ['alpha', 'beta'].map((value, i) => ({
      id: 'c' + i,
      formId: 'f',
      version: '1',
      title: 'Test form',
      capturedAt: when,
      status: 'pendiente',
      source: 'legacy' as const,
      answers: [{ code: 'Q01', question: 'Unique historical question', value }],
    }));
    const html = buildReportHtml({ ...data, epro: captures });
    expect(html).toContain('alpha');
    expect(html).toContain('beta');
  });
  it('consulta solo capturas propias en rango, conserva edición original y excluye borradores', async () => {
    const db = h.open();
    await migrateDatabase(db);
    const definition = completeDefinition(
      { ...fixture.formulario, eliminado: false },
      fixture.formulario.preguntas.map((q) => ({
        ...q,
        formulario_id: fixture.formulario.id,
        eliminado: false,
      })),
    );
    const q = contractForm(definition).preguntas[0],
      answers = { [q.id]: false };
    for (const patient of [patientA, patientB])
      await db.run('INSERT INTO paciente_cache(paciente_id,nombre,obtenido_en) VALUES (?,?,?)', [
        patient,
        'Synthetic',
        when,
      ]);
    await db.run(
      'INSERT INTO formulario_cache(formulario_id,version,titulo,descripcion,configuracion_json,obtenido_en) VALUES (?,?,?,?,?,?)',
      [
        fixture.formulario.id,
        String(fixture.formulario.version),
        'CURRENT TITLE MUST NOT REPLACE SNAPSHOT',
        '',
        canonical(fixture.formulario.configuracion),
        when,
      ],
    );
    for (const [id, patient, time] of [
      ['capture-a', patientA, when],
      ['foreign', patientB, when],
      ['future', patientA, '2026-10-30T12:00:00Z'],
    ])
      await db.run(
        'INSERT INTO respuesta_formulario(id,paciente_id,formulario_id,version,respuestas_json,fecha_confirmacion,creado_localmente_en) VALUES (?,?,?,?,?,?,?)',
        [
          id,
          patient,
          fixture.formulario.id,
          String(fixture.formulario.version),
          canonical(answers),
          time,
          time,
        ],
      );
    await db.run(
      'INSERT INTO qc_clinical_command(id,owner,environment,kind,captured_at,payload_json,status,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      ['capture-a', 'owner-a', 'test', 'epro', when, '{}', 'pendiente', when],
    );
    const snap = {
      id: 'capture-a',
      owner: 'owner-a',
      environment: 'test',
      submittedAt: when,
      answers,
      definition,
    };
    await db.run('INSERT INTO qc_storage_control(id,value_json) VALUES (?,?)', [
      'epro:capture:capture-a',
      canonical(snap),
    ]);
    await db.run('INSERT INTO qc_storage_control(id,value_json) VALUES (?,?)', [
      'epro:draft:private',
      canonical({ ...snap, id: 'private' }),
    ]);
    const repo = createReportRepository(db, patientA, () => when),
      data = await repo.getReportData(30);
    expect(data.epro).toHaveLength(1);
    expect(data.epro![0].title).toBe(fixture.formulario.titulo);
    expect(data.epro![0].answers[0]).toEqual({ code: q.codigo, question: q.titulo, value: 'No' });
    expect(data.epro![0].status).toBe('pendiente');
    expect(Object.isFrozen(data.epro)).toBe(true);
    expect(buildReportHtml(data)).toContain('Pendiente de envío');
    await db.run(
      "UPDATE qc_clinical_command SET status='aceptado',ack_json='{}' WHERE id='capture-a'",
    );
    expect((await repo.getReportData(30)).epro![0].status).toBe('aceptado');
    const row = {
      id: 'capture-a',
      formulario_id: fixture.formulario.id,
      version: String(fixture.formulario.version),
      respuestas_json: canonical(answers),
      fecha_confirmacion: when,
      titulo: null,
      snapshot_json: canonical({ ...snap, owner: 'other' }),
      status: 'pendiente',
      owner: 'owner-a',
      environment: 'test',
    };
    expect(() => reportEpro(row)).toThrow('no coincide');
  });
  it('exporta ePRO literal y seguro, identifica con nombre y RUT, omite correo y código, y conserva presión parcial', async () => {
    const db = h.open();
    await migrateDatabase(db);
    const data = await createReportRepository(db, patientA, () => when).getReportData(30);
    const malicious = '=HYPERLINK("https://example.invalid") <script>á</script>';
    const report = {
      ...data,
      profile: {
        paciente_id: patientA,
        nombre: 'PRIVATE-NAME',
        rut: 'PRIVATE-RUT',
        email: 'PRIVATE-EMAIL',
        obtenido_en: when,
      },
      linkingCode: { ...data.linkingCode, code: 'PRIVATE-CODE', displayText: 'PRIVATE-CODE' },
      vitals: [
        {
          id: 'v',
          paciente_id: patientA,
          fecha_registro: when,
          presion_sistolica: 123,
          presion_diastolica: null,
          temperatura: null,
          pulso: null,
          saturacion_o2: null,
          fecha_subida: null,
        },
      ],
      syncStatuses: { v: 'rechazado' },
      epro: [
        {
          id: 'e',
          formId: 'f',
          version: 'historic-1',
          title: 'Synthetic',
          capturedAt: when,
          status: 'pendiente',
          source: 'legacy' as const,
          answers: [{ code: 'P10', question: 'Historical prompt', value: malicious }],
        },
      ],
    };
    const shareable = shareableReportSnapshot(report);
    const html = buildReportHtml(shareable),
      wb = XLSX.read(generateReportXlsxBytes(shareable), { type: 'array' }),
      serialized = JSON.stringify(wb);
    // Decisión del 24-11-2026: nombre y RUT identifican el reporte; correo y código nunca salen.
    for (const secret of ['PRIVATE-EMAIL', 'PRIVATE-CODE']) {
      expect(html).not.toContain(secret);
      expect(serialized).not.toContain(secret);
    }
    for (const identity of ['PRIVATE-NAME', 'PRIVATE-RUT']) {
      expect(html).toContain(identity);
      expect(serialized).toContain(identity);
    }
    expect(html).toContain('123/— mmHg');
    expect(html).toContain('Rechazado');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    const sheet = wb.Sheets['Seguimientos ePRO'];
    expect(sheet.E2.v).toBe(malicious);
    expect(sheet.E2.t).toBe('s');
    expect(sheet.E2.f).toBeUndefined();
    expect(sheet.E2.l).toBeUndefined();
    expect(sheet.C2.v).toContain('Pendiente de envío');
  });
});
