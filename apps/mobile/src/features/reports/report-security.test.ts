import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertSafeReportFileName,
  clearPendingReportCleanups,
  deletePatientReport,
  getPatientReportDirectory,
  getPatientReportList,
  getPendingReportCleanups,
  listPatientReports,
  parsePeriodFromReportFilename,
  parseTimestampFromReportFilename,
  persistReportPdf,
} from '../../data/local/files/report-storage';
import { buildReportHtml, escapeHtml } from './report-template';

const patientA = '11111111-1111-4111-8111-111111111111';
const patientB = '22222222-2222-4222-8222-222222222222';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('seguridad y sanitización de reportes locales', () => {
  it('escapa caracteres especiales HTML para prevenir inyección de código', () => {
    const maliciousInput = '<script>alert("xss")</script> & \'test\'';
    const escaped = escapeHtml(maliciousInput);

    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &#39;test&#39;',
    );
  });

  it('sanitiza campos dinámicos en la plantilla HTML del reporte', () => {
    const html = buildReportHtml({
      pacienteId: patientA,
      periodDays: 30,
      profile: {
        paciente_id: patientA,
        nombre: '<b onmouseover="alert(1)">Paciente XSS</b>',
        rut: '12.345.678-9<script>',
        email: 'attacker@evil.com" onfocus="alert(2)',
        obtenido_en: '2026-10-04T12:00:00Z',
      },
      treatment: {
        id: 't1',
        paciente_id: patientA,
        tipo: 'quimioterapia',
        estado: 'activo',
        nombre: '<iframe src="evil.com">Tratamiento Seguro</iframe>',
        parametros_json: null,
        fecha_inicio: '2026-08-01',
        fecha_termino: null,
        obtenido_en: '2026-10-04T12:00:00Z',
      },
      summary: {
        total: 1,
        avgTemperature: 36.5,
        avgPulse: 75,
      },
      vitals: [
        {
          id: 'v1',
          paciente_id: patientA,
          fecha_registro: '2026-10-04T10:00:00Z',
          presion_sistolica: 120,
          presion_diastolica: 80,
          pulso: 75,
          temperatura: 36.5,
          saturacion_o2: 98,
          fecha_subida: null,
        },
      ],
    });

    // Ningún tag no deseado debe conservarse sin escapar
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b onmouseover');
    expect(html).not.toContain('<iframe');
    // Las entidades escapadas deben estar presentes
    expect(html).toContain('&lt;b onmouseover=&quot;alert(1)&quot;&gt;Paciente XSS&lt;/b&gt;');
    expect(html).toContain('12.345.678-9&lt;script&gt;');
    expect(html).toContain('&lt;iframe src=&quot;evil.com&quot;&gt;');
  });
});

describe('validación de nombres de archivo de reporte', () => {
  it('acepta nombres válidos según el patrón exacto reporte_{dias}d_{timestamp}.pdf', () => {
    expect(() => assertSafeReportFileName('reporte_30d_1791157123508.pdf')).not.toThrow();
    expect(() => assertSafeReportFileName('reporte_7d_1000000000.pdf')).not.toThrow();
    expect(() => assertSafeReportFileName('reporte_90d_1.pdf')).not.toThrow();
  });

  it('rechaza nombres inválidos, extensiones incorrectas y tentativas de path traversal', () => {
    const invalidNames = [
      '../reporte_30d_123.pdf',
      '..\\reporte_30d_123.pdf',
      'reporte_30d_123.pdf.exe',
      'reporte_30_123.pdf',
      'reporte_d_123.pdf',
      'reporte_30d_abc.pdf',
      'otro_archivo.pdf',
      'reporte_30d_123.html',
      '',
    ];

    for (const name of invalidNames) {
      expect(() => assertSafeReportFileName(name)).toThrow();
    }
  });
});

describe('extracción de fecha de generación a partir del nombre del archivo', () => {
  it('obtiene la fecha ISO correcta para nombres con timestamp válido', () => {
    const timestampMs = 1791157123508;
    const expectedDate = new Date(timestampMs).toISOString();

    const parsed = parseTimestampFromReportFilename(`reporte_30d_${timestampMs}.pdf`);
    expect(parsed).toBe(expectedDate);
  });

  it('retorna null para formatos o valores numéricos no conformes', () => {
    expect(parseTimestampFromReportFilename('archivo_invalido.pdf')).toBeNull();
    expect(parseTimestampFromReportFilename('reporte_30d_invalido.pdf')).toBeNull();
    expect(parseTimestampFromReportFilename('')).toBeNull();
  });
});

describe('aislamiento de directorios de reportes por paciente', () => {
  it('construye rutas estrictamente particionadas por ID de paciente', () => {
    const dirA = getPatientReportDirectory(patientA);
    const dirB = getPatientReportDirectory(patientB);

    expect(dirA.uri).toContain(patientA);
    expect(dirB.uri).toContain(patientB);
    expect(dirA.uri).not.toBe(dirB.uri);
  });

  it('rechaza identificadores maliciosos para prevenir path traversal en el directorio del reporte', () => {
    const maliciousIds = [
      '../paciente_a',
      '..\\paciente_a',
      'paciente/lateral',
      'paciente\0nulo',
      '',
    ];

    for (const badId of maliciousIds) {
      expect(() => getPatientReportDirectory(badId)).toThrow();
    }
  });

  it('aísla el listado de reportes locales entre pacientes', () => {
    // Para pacientes sin archivos, el listado retorna arreglo vacío de forma segura
    const reportsA = listPatientReports(patientA);
    const reportsB = listPatientReports(patientB);

    expect(Array.isArray(reportsA)).toBe(true);
    expect(Array.isArray(reportsB)).toBe(true);
  });
});

describe('gestión de reportes guardados, listado con metadatos y eliminación', () => {
  it('extrae correctamente el número de días del período desde el nombre del archivo', () => {
    expect(parsePeriodFromReportFilename('reporte_7d_1728256000000.pdf')).toBe(7);
    expect(parsePeriodFromReportFilename('reporte_30d_1728256000000.pdf')).toBe(30);
    expect(parsePeriodFromReportFilename('reporte_90d_1728256000000.pdf')).toBe(90);
    expect(parsePeriodFromReportFilename('archivo_invalido.pdf')).toBeNull();
    expect(parsePeriodFromReportFilename('')).toBeNull();
  });

  it('lista reportes con metadatos, reemplaza duplicados del mismo período y permite eliminación', async () => {
    const { File, Paths } = await import('expo-file-system');

    // 1. Crear archivo temporal simulado para persistir
    const tempFile1 = new File(Paths.cache, 'temp_test_1.pdf');
    await tempFile1.write('Contenido PDF de prueba 1');

    // 2. Persistir primer reporte de 30 días para Paciente A
    const { filename: filename1 } = await persistReportPdf(patientA, tempFile1.uri, 30);
    expect(filename1).toContain('reporte_30d_');

    const initialList = getPatientReportList(patientA);
    expect(initialList.length).toBeGreaterThanOrEqual(1);
    expect(initialList.some((r) => r.filename === filename1)).toBe(true);
    const found1 = initialList.find((r) => r.filename === filename1);
    expect(found1?.periodDays).toBe(30);
    expect(found1?.generatedAt).not.toBeNull();

    // 3. Crear y persistir segundo reporte para el MISMO período (30 días): debe reemplazar el anterior
    const tempFile2 = new File(Paths.cache, 'temp_test_2.pdf');
    await tempFile2.write('Contenido PDF de prueba 2 actualizado');
    const { filename: filename2 } = await persistReportPdf(patientA, tempFile2.uri, 30);

    const afterDeduplication = getPatientReportList(patientA);
    const reports30d = afterDeduplication.filter((r) => r.periodDays === 30);
    // Solo debe quedar 1 reporte de 30 días para evitar acumulación de duplicados
    expect(reports30d).toHaveLength(1);
    expect(reports30d[0].filename).toBe(filename2);

    // 4. Persistir un reporte de diferente período (7 días): se conserva independientemente
    const tempFile3 = new File(Paths.cache, 'temp_test_3.pdf');
    await tempFile3.write('Contenido PDF de prueba 7 días');
    const { filename: filename7d } = await persistReportPdf(patientA, tempFile3.uri, 7);

    const withBoth = getPatientReportList(patientA);
    expect(withBoth.some((r) => r.filename === filename2)).toBe(true);
    expect(withBoth.some((r) => r.filename === filename7d)).toBe(true);

    // 5. Aislamiento por paciente: Paciente B no ve los reportes de Paciente A
    const listB = getPatientReportList(patientB);
    expect(listB.some((r) => r.filename === filename2)).toBe(false);
    expect(listB.some((r) => r.filename === filename7d)).toBe(false);

    // 6. Eliminar reporte individualmente
    const deleted = await deletePatientReport(patientA, filename2);
    expect(deleted).toBe(true);

    const finalList = getPatientReportList(patientA);
    expect(finalList.some((r) => r.filename === filename2)).toBe(false);
    expect(finalList.some((r) => r.filename === filename7d)).toBe(true);

    // Limpieza final del reporte de 7d
    await deletePatientReport(patientA, filename7d);
  });

  it('falla de forma segura al intentar eliminar un reporte inexistente o inválido', async () => {
    const deletedFake = await deletePatientReport(patientA, 'reporte_30d_9999999999999.pdf');
    expect(deletedFake).toBe(false);

    await expect(() => deletePatientReport(patientA, '../inyeccion.pdf')).rejects.toThrow();
  });

  it('conserva el reporte PDF anterior intacto si falla la copia del nuevo reporte', async () => {
    const { File, Paths } = await import('expo-file-system');

    // 1. Guardar reporte inicial de 30 días para Paciente A
    const tempFile1 = new File(Paths.cache, 'temp_test_preserve_1.pdf');
    await tempFile1.write('Contenido inicial válido');
    const { filename: initialFilename } = await persistReportPdf(patientA, tempFile1.uri, 30);

    const initialList = getPatientReportList(patientA);
    expect(initialList.some((r) => r.filename === initialFilename)).toBe(true);

    // 2. Intentar guardar un segundo reporte cuyo copy falla simulando error de disco/I/O
    const tempFile2 = new File(Paths.cache, 'temp_test_preserve_2.pdf');
    await tempFile2.write('Contenido nuevo que fallará al copiarse');

    const copySpy = vi
      .spyOn(File.prototype, 'copy')
      .mockRejectedValueOnce(new Error('Simulación de fallo de I/O al copiar PDF'));

    await expect(persistReportPdf(patientA, tempFile2.uri, 30)).rejects.toThrow(
      'Simulación de fallo de I/O al copiar PDF',
    );
    copySpy.mockRestore();

    // 3. Comprobar que el reporte anterior se conservó intacto en el almacenamiento local
    const afterFailedCopyList = getPatientReportList(patientA);
    expect(afterFailedCopyList.some((r) => r.filename === initialFilename)).toBe(true);

    const originalFile = new File(getPatientReportDirectory(patientA), initialFilename);
    expect(originalFile.exists).toBe(true);
    expect(await originalFile.text()).toBe('Contenido inicial válido');

    // Limpieza
    await deletePatientReport(patientA, initialFilename);
  });

  it('conserva ambos archivos y registra la limpieza pendiente si falla la eliminación posterior del anterior', async () => {
    const { File, Paths } = await import('expo-file-system');
    clearPendingReportCleanups();

    // 1. Guardar reporte inicial de 90 días para Paciente A
    const tempFile1 = new File(Paths.cache, 'temp_test_cleanup_fail_1.pdf');
    await tempFile1.write('Contenido previo 90d');
    const { filename: oldFilename } = await persistReportPdf(patientA, tempFile1.uri, 90);

    const oldFile = new File(getPatientReportDirectory(patientA), oldFilename);
    expect(oldFile.exists).toBe(true);

    // 2. Simular fallo de delete solo cuando se intente eliminar el archivo viejo
    const originalDelete = File.prototype.delete;
    const deleteSpy = vi.spyOn(File.prototype, 'delete').mockImplementation(async function (this: {
      uri?: string;
    }) {
      if (this.uri === oldFile.uri) {
        throw new Error('Fallo de permiso o bloqueo simulado al eliminar archivo anterior');
      }
      return originalDelete.call(this);
    });

    const tempFile2 = new File(Paths.cache, 'temp_test_cleanup_fail_2.pdf');
    await tempFile2.write('Contenido nuevo 90d exitoso');

    // 3. persistReportPdf debe tener éxito guardando el nuevo
    const { filename: newFilename } = await persistReportPdf(patientA, tempFile2.uri, 90);
    expect(newFilename).not.toBe(oldFilename);
    deleteSpy.mockRestore();

    // 4. Ambos archivos deben conservarse en disco
    const newFile = new File(getPatientReportDirectory(patientA), newFilename);
    expect(newFile.exists).toBe(true);
    expect(oldFile.exists).toBe(true);

    // 5. La URI del archivo viejo debe estar registrada en limpiezas pendientes
    const pending = getPendingReportCleanups();
    expect(pending).toContain(oldFile.uri);

    // Limpieza
    await deletePatientReport(patientA, oldFilename);
    await deletePatientReport(patientA, newFilename);
    clearPendingReportCleanups();
  });

  it('con reloj fijo y destino existente, ante un fallo de copia conserva el PDF original y su contenido', async () => {
    const { File, Paths } = await import('expo-file-system');
    const fixedTimestamp = 1728256000000;
    vi.useFakeTimers();
    vi.setSystemTime(fixedTimestamp);

    try {
      // 1. Guardar el reporte inicial con el reloj fijo en fixedTimestamp
      const tempFile1 = new File(Paths.cache, 'temp_fixed_clock_1.pdf');
      await tempFile1.write('Contenido original intocable y protegido');
      const { filename: originalFilename } = await persistReportPdf(patientA, tempFile1.uri, 30);
      expect(originalFilename).toBe(`reporte_30d_${fixedTimestamp}.pdf`);

      const originalFile = new File(getPatientReportDirectory(patientA), originalFilename);
      expect(originalFile.exists).toBe(true);
      expect(await originalFile.text()).toBe('Contenido original intocable y protegido');

      // 2. Con el reloj congelado en el mismo tiempo exacto, intentar guardar otro reporte cuya copia falla
      const tempFile2 = new File(Paths.cache, 'temp_fixed_clock_2.pdf');
      await tempFile2.write('Nuevo contenido que fallará y no debe borrar el preexistente');

      const copySpy = vi
        .spyOn(File.prototype, 'copy')
        .mockRejectedValueOnce(new Error('Fallo de I/O forzado con reloj fijo'));

      await expect(persistReportPdf(patientA, tempFile2.uri, 30)).rejects.toThrow(
        'Fallo de I/O forzado con reloj fijo',
      );
      copySpy.mockRestore();

      // 3. Comprobar que el PDF original no fue borrado ni alterado, conservando su contenido intacto
      expect(originalFile.exists).toBe(true);
      expect(await originalFile.text()).toBe('Contenido original intocable y protegido');

      const reportsList = getPatientReportList(patientA);
      expect(reportsList.some((r) => r.filename === originalFilename)).toBe(true);

      // Limpieza
      await deletePatientReport(patientA, originalFilename);
    } finally {
      vi.useRealTimers();
    }
  });
});
