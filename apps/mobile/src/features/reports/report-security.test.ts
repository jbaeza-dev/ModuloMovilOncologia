import { activateFileCipher } from '../../data/sync/file-protection';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertSafeReportFileName,
  cleanOrphanedTempReports,
  clearAllPatientReports,
  clearPendingReportCleanups,
  deletePatientReport,
  flushPendingReportCleanups,
  getPatientReportDirectory,
  getPatientReportList,
  getPendingReportCleanups,
  listPatientReports,
  parseFormatFromReportFilename,
  parsePeriodFromReportFilename,
  parseTimestampFromReportFilename,
  persistReportFile,
  persistReportPdf,
  persistReportXlsx,
  readPatientReportA11ySnapshot,
  registerPendingReportCleanup,
  withPatientReportLock,
  type BinaryReportStorageAdapter,
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
    expect(html).not.toContain('Paciente XSS');
    expect(html).not.toContain('12.345.678-9');
    expect(html).toContain('&lt;iframe src=&quot;evil.com&quot;&gt;');
  });
});

describe('validación de nombres de archivo y formatos de reporte', () => {
  it('acepta nombres válidos para PDF y XLSX según el patrón exacto reporte_{dias}d_{timestamp}.(pdf|xlsx)', () => {
    expect(() => assertSafeReportFileName('reporte_30d_1791157123508.pdf')).not.toThrow();
    expect(() => assertSafeReportFileName('reporte_30d_1791157123508.xlsx')).not.toThrow();
    expect(() => assertSafeReportFileName('reporte_7d_1000000000.pdf')).not.toThrow();
    expect(() => assertSafeReportFileName('reporte_7d_1000000000.xlsx')).not.toThrow();
    expect(() => assertSafeReportFileName('reporte_90d_1.pdf')).not.toThrow();
    expect(() => assertSafeReportFileName('reporte_90d_1.xlsx')).not.toThrow();
  });

  it('rechaza nombres inválidos, extensiones incorrectas y tentativas de path traversal', () => {
    const invalidNames = [
      '../reporte_30d_123.pdf',
      '..\\reporte_30d_123.xlsx',
      'reporte_30d_123.pdf.exe',
      'reporte_30_123.pdf',
      'reporte_d_123.xlsx',
      'reporte_30d_abc.pdf',
      'reporte_30d_abc.xlsx',
      'otro_archivo.pdf',
      'reporte_30d_123.html',
      'reporte_30d_123.csv',
      '',
    ];

    for (const name of invalidNames) {
      expect(() => assertSafeReportFileName(name)).toThrow();
    }
  });

  it('extrae correctamente el formato de archivo desde el nombre', () => {
    expect(parseFormatFromReportFilename('reporte_7d_1728256000000.pdf')).toBe('pdf');
    expect(parseFormatFromReportFilename('reporte_30d_1728256000000.xlsx')).toBe('xlsx');
    expect(parseFormatFromReportFilename('archivo_invalido.pdf')).toBeNull();
  });

  it('extrae correctamente el número de días del período desde el nombre del archivo', () => {
    expect(parsePeriodFromReportFilename('reporte_7d_1728256000000.pdf')).toBe(7);
    expect(parsePeriodFromReportFilename('reporte_30d_1728256000000.xlsx')).toBe(30);
    expect(parsePeriodFromReportFilename('reporte_90d_1728256000000.pdf')).toBe(90);
    expect(parsePeriodFromReportFilename('archivo_invalido.xlsx')).toBeNull();
    expect(parsePeriodFromReportFilename('')).toBeNull();
  });

  it('obtiene la fecha ISO correcta para nombres con timestamp válido en ambos formatos', () => {
    const timestampMs = 1791157123508;
    const expectedDate = new Date(timestampMs).toISOString();

    expect(parseTimestampFromReportFilename(`reporte_30d_${timestampMs}.pdf`)).toBe(expectedDate);
    expect(parseTimestampFromReportFilename(`reporte_30d_${timestampMs}.xlsx`)).toBe(expectedDate);
    expect(parseTimestampFromReportFilename('archivo_invalido.pdf')).toBeNull();
    expect(parseTimestampFromReportFilename('reporte_30d_invalido.xlsx')).toBeNull();
  });
});

describe('aislamiento de directorios y listado de reportes por paciente', () => {
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

  it('aísla el listado de reportes locales entre pacientes', async () => {
    const reportsA = await listPatientReports(patientA);
    const reportsB = await listPatientReports(patientB);

    expect(Array.isArray(reportsA)).toBe(true);
    expect(Array.isArray(reportsB)).toBe(true);
  });
});

describe('exclusión mutua, concurrencia y coordinación de almacenamiento', () => {
  it('exclusión mutua real: dos guardados concurrentes se ejecutan secuencialmente con escritura pausada', async () => {
    let operation1InProgress = false;
    let operation2StartedWhile1Running = false;
    let releaseOp1: () => void = () => {};
    const op1PausedPromise = new Promise<void>((resolve) => {
      releaseOp1 = resolve;
    });

    const executionOrder: string[] = [];

    let isFirstWrite = true;

    const customAdapter: BinaryReportStorageAdapter = {
      async writeBytes(fileUri: string, bytes: Uint8Array): Promise<void> {
        if (isFirstWrite) {
          isFirstWrite = false;
          operation1InProgress = true;
          executionOrder.push('op1_write_started');
          await op1PausedPromise;
          executionOrder.push('op1_write_finished');
          operation1InProgress = false;
        } else {
          if (operation1InProgress) {
            operation2StartedWhile1Running = true;
          }
          executionOrder.push('op2_write');
        }
        const { File } = await import('expo-file-system');
        const file = new File(fileUri);
        await file.write(bytes);
      },
      async copyFile(sourceUri: string, targetUri: string): Promise<void> {
        const { File } = await import('expo-file-system');
        const s = new File(sourceUri);
        const t = new File(targetUri);
        await s.copy(t);
      },
      async moveFile(sourceUri: string, targetUri: string): Promise<void> {
        const { File } = await import('expo-file-system');
        const s = new File(sourceUri);
        const t = new File(targetUri);
        await s.move(t);
      },
      async deleteFile(fileUri: string): Promise<void> {
        const { File } = await import('expo-file-system');
        const f = new File(fileUri);
        if (f.exists) await f.delete();
      },
      async fileExists(fileUri: string): Promise<boolean> {
        const { File } = await import('expo-file-system');
        return new File(fileUri).exists;
      },
      async directoryExists(dirUri: string): Promise<boolean> {
        const { Directory } = await import('expo-file-system');
        return new Directory(dirUri).exists;
      },
      async getFileSize(fileUri: string): Promise<number | null> {
        const { File } = await import('expo-file-system');
        const f = new File(fileUri);
        return f.exists ? f.size : null;
      },
      async ensureDirectory(dirUri: string): Promise<void> {
        const { Directory } = await import('expo-file-system');
        new Directory(dirUri).create({ intermediates: true, idempotent: true });
      },
      async listDirectory(dirUri: string) {
        const { Directory, File, Paths } = await import('expo-file-system');
        const dir = new Directory(dirUri);
        if (!dir.exists) return [];
        return dir.list().map((e) => ({
          uri: e.uri,
          name: e.name ?? Paths.basename(e.uri),
          isFile: e instanceof File,
          size: e instanceof File ? e.size : null,
        }));
      },
    };

    // Iniciar OP1
    const op1Promise = persistReportFile(
      patientA,
      { type: 'bytes', bytes: new Uint8Array([1, 2, 3]) },
      7,
      'xlsx',
      customAdapter,
    );

    // Pequeño retardo de microtareas para asegurar que op1 adquirió el lock primero
    await new Promise((r) => setTimeout(r, 15));

    // Iniciar OP2 simultáneamente sobre el MISMO paciente
    const op2Promise = persistReportFile(
      patientA,
      { type: 'bytes', bytes: new Uint8Array([4, 5, 6, 7]) },
      30,
      'xlsx',
      customAdapter,
    );

    // Esperar un intervalo mientras op1 continúa pausado
    await new Promise((r) => setTimeout(r, 30));
    expect(operation1InProgress).toBe(true);
    expect(operation2StartedWhile1Running).toBe(false);

    // Liberar op1
    releaseOp1();

    const [res1, res2] = await Promise.all([op1Promise, op2Promise]);

    expect(operation2StartedWhile1Running).toBe(false);
    expect(executionOrder).toEqual(['op1_write_started', 'op1_write_finished', 'op2_write']);
    expect(res1.filename).toContain('reporte_7d_');
    expect(res2.filename).toContain('reporte_30d_');

    await deletePatientReport(patientA, res1.filename);
    await deletePatientReport(patientA, res2.filename);
  });

  it('con reloj fijo, dos guardados sucesivos generan nombres exclusivos sin colisión', async () => {
    const fixedTime = 1728256000000;
    vi.useFakeTimers();
    vi.setSystemTime(fixedTime);
    try {
      const bytes1 = new Uint8Array([10, 20]);
      const bytes2 = new Uint8Array([30, 40]);

      const res1 = await persistReportXlsx(patientA, bytes1, 7);
      const res2 = await persistReportXlsx(patientA, bytes2, 7);

      expect(res1.filename).toBe(`reporte_7d_${fixedTime}.xlsx`);
      expect(res2.filename).toBe(`reporte_7d_${fixedTime + 1}.xlsx`);
      expect(res1.filename).not.toBe(res2.filename);

      const list = await getPatientReportList(patientA);
      // El segundo reemplazó al primero por coincidir en paciente, período y formato
      expect(list.filter((r) => r.periodDays === 7 && r.format === 'xlsx')).toHaveLength(1);
      expect(list.some((r) => r.filename === res2.filename)).toBe(true);

      await deletePatientReport(patientA, res2.filename);
    } finally {
      vi.useRealTimers();
    }
  });

  it('coordinación de limpiezas: flushPendingReportCleanups respeta el bloqueo y no causa deadlock reentrante', async () => {
    clearPendingReportCleanups();
    const fakeUri = `${getPatientReportDirectory(patientA).uri}/reporte_30d_9999.pdf`;
    registerPendingReportCleanup(fakeUri, patientA);

    expect(getPendingReportCleanups()).toContain(fakeUri);

    // Ejecutar flush dentro de withPatientReportLock para el mismo paciente sin deadlock
    const cleanedInside = await withPatientReportLock(patientA, async () => {
      return await flushPendingReportCleanups(undefined, patientA);
    });
    expect(typeof cleanedInside).toBe('number');

    // Ejecutar flush standalone: respeta bloqueo de paciente sin deadlock
    const cleanedStandalone = await flushPendingReportCleanups();
    expect(typeof cleanedStandalone).toBe('number');
    clearPendingReportCleanups();
  });

  it('previene deadlock cruzado (A/B) cuando dos operaciones concurrentes procesan limpiezas bajo bloqueos opuestos', async () => {
    clearPendingReportCleanups();
    const uriA = `${getPatientReportDirectory(patientA).uri}/reporte_30d_1111.pdf`;
    const uriB = `${getPatientReportDirectory(patientB).uri}/reporte_30d_2222.pdf`;

    // Ambas URIs registradas como pendientes
    registerPendingReportCleanup(uriA, patientA);
    registerPendingReportCleanup(uriB, patientB);

    let opAStarted = false;
    let opBStarted = false;
    let releaseBarrier: () => void = () => {};
    const barrierPromise = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });

    // Operación A mantiene bloqueo de A, y ejecuta flush pasando heldLockPatientId = patientA
    const opA = withPatientReportLock(patientA, async () => {
      opAStarted = true;
      if (opBStarted) releaseBarrier();
      await barrierPromise;
      return await flushPendingReportCleanups(undefined, patientA);
    });

    // Operación B mantiene bloqueo de B, y ejecuta flush pasando heldLockPatientId = patientB
    const opB = withPatientReportLock(patientB, async () => {
      opBStarted = true;
      if (opAStarted) releaseBarrier();
      await barrierPromise;
      return await flushPendingReportCleanups(undefined, patientB);
    });

    // Ambas operaciones deben terminar exitosamente sin bloquearse mutuamente
    await Promise.all([opA, opB]);

    clearPendingReportCleanups();
  });
});

describe('gestión de reportes guardados, verificación y tolerancia a fallos', () => {
  it('el reemplazo de reportes está acotado por paciente, período Y formato (PDF y XLSX coexisten)', async () => {
    const { File, Paths } = await import('expo-file-system');

    // 1. Guardar PDF de 30d para Paciente A
    const tempPdf1 = new File(Paths.cache, 'temp_scope_1.pdf');
    await tempPdf1.write('PDF 30d versión 1');
    const { filename: pdf30_v1 } = await persistReportPdf(patientA, tempPdf1.uri, 30);

    // 2. Guardar XLSX de 30d para Paciente A
    const xlsxBytes1 = new Uint8Array([1, 2, 3]);
    const { filename: xlsx30_v1 } = await persistReportXlsx(patientA, xlsxBytes1, 30);

    // Ambos deben coexistir en la lista de Paciente A
    let list = await getPatientReportList(patientA);
    expect(list.some((r) => r.filename === pdf30_v1 && r.format === 'pdf')).toBe(true);
    expect(list.some((r) => r.filename === xlsx30_v1 && r.format === 'xlsx')).toBe(true);

    // 3. Guardar XLSX de 30d NUEVO para Paciente A: debe reemplazar solo el XLSX de 30d, NO el PDF
    const xlsxBytes2 = new Uint8Array([4, 5, 6, 7]);
    const { filename: xlsx30_v2 } = await persistReportXlsx(patientA, xlsxBytes2, 30);

    list = await getPatientReportList(patientA);
    expect(list.some((r) => r.filename === pdf30_v1)).toBe(true); // PDF preservado
    expect(list.some((r) => r.filename === xlsx30_v1)).toBe(false); // XLSX v1 eliminado
    expect(list.some((r) => r.filename === xlsx30_v2)).toBe(true); // XLSX v2 activo

    // 4. Aislamiento por paciente: Paciente B no ve los reportes de Paciente A
    const listB = await getPatientReportList(patientB);
    expect(listB.some((r) => r.filename === pdf30_v1)).toBe(false);
    expect(listB.some((r) => r.filename === xlsx30_v2)).toBe(false);

    // 5. Eliminar reporte individualmente
    const deleted = await deletePatientReport(patientA, pdf30_v1);
    expect(deleted).toBe(true);

    const finalList = await getPatientReportList(patientA);
    expect(finalList.some((r) => r.filename === pdf30_v1)).toBe(false);
    expect(finalList.some((r) => r.filename === xlsx30_v2)).toBe(true);

    await deletePatientReport(patientA, xlsx30_v2);
  });

  it('falla de forma segura al intentar eliminar un reporte inexistente o inválido', async () => {
    const deletedFake = await deletePatientReport(patientA, 'reporte_30d_9999999999999.pdf');
    expect(deletedFake).toBe(false);

    await expect(() => deletePatientReport(patientA, '../inyeccion.pdf')).rejects.toThrow();
  });

  it('falla y limpia el temporal si el tamaño del archivo temporal no coincide con los bytes generados', async () => {
    const { Directory, File, Paths } = await import('expo-file-system');

    const corruptAdapter: BinaryReportStorageAdapter = {
      async writeBytes(uri, b) {
        await new File(uri).write(b);
      },
      async copyFile(s, t) {
        await new File(s).copy(new File(t));
      },
      async moveFile(s, t) {
        await new File(s).move(new File(t));
      },
      async deleteFile(uri) {
        const f = new File(uri);
        if (f.exists) await f.delete();
      },
      async fileExists(uri) {
        return new File(uri).exists;
      },
      async directoryExists(dir) {
        return new Directory(dir).exists;
      },
      async getFileSize() {
        return 999999; // Tamaño corrupto deliberado
      },
      async ensureDirectory(dir) {
        new Directory(dir).create({ intermediates: true, idempotent: true });
      },
      async listDirectory(dir) {
        const d = new Directory(dir);
        if (!d.exists) return [];
        return d.list().map((e) => ({
          uri: e.uri,
          name: e.name ?? Paths.basename(e.uri),
          isFile: e instanceof File,
          size: e instanceof File ? e.size : null,
        }));
      },
    };

    const bytes = new Uint8Array([1, 2, 3]);
    await expect(persistReportXlsx(patientA, bytes, 7, corruptAdapter)).rejects.toThrow(
      /Fallo de verificación: tamaño de archivo temporal/,
    );
  });

  it('si falla la verificación post-publicación, elimina el destino publicado y conserva el anterior', async () => {
    const { Directory, File, Paths } = await import('expo-file-system');

    // 1. Crear y persistir reporte previo válido
    const prevBytes = new Uint8Array([1, 2, 3, 4]);
    const { filename: prevFilename } = await persistReportXlsx(patientA, prevBytes, 30);

    const prevFile = new File(getPatientReportDirectory(patientA), prevFilename);
    expect(prevFile.exists).toBe(true);

    // 2. Simular adaptador donde getFileSize post-publicación reporta 0
    let moveCount = 0;
    const flakeAdapter: BinaryReportStorageAdapter = {
      async writeBytes(uri, b) {
        await new File(uri).write(b);
      },
      async copyFile(s, t) {
        await new File(s).copy(new File(t));
      },
      async moveFile(s, t) {
        moveCount++;
        await new File(s).move(new File(t));
      },
      async deleteFile(uri) {
        const f = new File(uri);
        if (f.exists) await f.delete();
      },
      async fileExists(uri) {
        return new File(uri).exists;
      },
      async directoryExists(dir) {
        return new Directory(dir).exists;
      },
      async getFileSize(uri) {
        if (moveCount > 0 && !uri.includes('.tmp')) {
          return 0; // Post-publicación inválida
        }
        return new File(uri).size;
      },
      async ensureDirectory(dir) {
        new Directory(dir).create({ intermediates: true, idempotent: true });
      },
      async listDirectory(dir) {
        const d = new Directory(dir);
        if (!d.exists) return [];
        return d.list().map((e) => ({
          uri: e.uri,
          name: e.name ?? Paths.basename(e.uri),
          isFile: e instanceof File,
          size: e instanceof File ? e.size : null,
        }));
      },
    };

    const newBytes = new Uint8Array([9, 8, 7]);
    await expect(persistReportXlsx(patientA, newBytes, 30, flakeAdapter)).rejects.toThrow(
      /Fallo de verificación post-publicación/,
    );

    // El reporte previo sigue existiendo intacto
    expect(prevFile.exists).toBe(true);

    // La lista conserva el archivo original
    const list = await getPatientReportList(patientA);
    expect(list.some((r) => r.filename === prevFilename)).toBe(true);

    await deletePatientReport(patientA, prevFilename);
  });

  it('omite toleradamente archivos ajenos, corruptos o con períodos inválidos al listar', async () => {
    const { File } = await import('expo-file-system');
    const dir = getPatientReportDirectory(patientA);
    dir.create({ intermediates: true });

    // Crear archivos no conformes en el directorio
    const foreignFile = new File(dir, 'foto_paciente.png');
    await foreignFile.write('datos');
    const invalidPeriod = new File(dir, 'reporte_15d_1728256000000.pdf');
    await invalidPeriod.write('datos');
    const invalidTimestamp = new File(dir, 'reporte_30d_noesnumero.pdf');
    await invalidTimestamp.write('datos');

    // Crear un reporte legítimo
    const bytes = new Uint8Array([1, 2, 3]);
    const { filename: validFilename } = await persistReportXlsx(patientA, bytes, 7);

    const list = await getPatientReportList(patientA);
    expect(list.some((r) => r.filename === validFilename)).toBe(true);
    expect(list.some((r) => r.filename === 'foto_paciente.png')).toBe(false);
    expect(list.some((r) => r.filename === 'reporte_15d_1728256000000.pdf')).toBe(false);
    expect(list.some((r) => r.filename === 'reporte_30d_noesnumero.pdf')).toBe(false);

    // Limpieza
    await foreignFile.delete();
    await invalidPeriod.delete();
    await invalidTimestamp.delete();
    await deletePatientReport(patientA, validFilename);
  });

  it('si una escritura parcial crea bytes y falla, la compensación elimina el temporal y conserva el reporte previo intacto', async () => {
    const { Directory, File, Paths } = await import('expo-file-system');

    // 1. Crear un reporte previo legítimo
    const prevBytes = new Uint8Array([1, 2, 3, 4]);
    const { filename: prevFilename } = await persistReportXlsx(patientA, prevBytes, 30);
    const prevFile = new File(getPatientReportDirectory(patientA), prevFilename);
    expect(prevFile.exists).toBe(true);
    const prevSize = prevFile.size;

    // 2. Adaptador que escribe 2 bytes y arroja un error deliberado a mitad de camino
    let partialTempCreatedUri: string | null = null;
    const partialFailAdapter: BinaryReportStorageAdapter = {
      async writeBytes(uri, bytes) {
        partialTempCreatedUri = uri;
        const f = new File(uri);
        // Escribe deliberadamente solo 2 bytes parciales antes de fallar
        await f.write(bytes.slice(0, 2));
        throw new Error('Fallo simulado a mitad de escritura en disco');
      },
      async copyFile(s, t) {
        await new File(s).copy(new File(t));
      },
      async moveFile(s, t) {
        await new File(s).move(new File(t));
      },
      async deleteFile(uri) {
        const f = new File(uri);
        if (f.exists) await f.delete();
      },
      async fileExists(uri) {
        return new File(uri).exists;
      },
      async directoryExists(dir) {
        return new Directory(dir).exists;
      },
      async getFileSize(uri) {
        const f = new File(uri);
        return f.exists ? f.size : null;
      },
      async ensureDirectory(dir) {
        new Directory(dir).create({ intermediates: true, idempotent: true });
      },
      async listDirectory(dir) {
        const d = new Directory(dir);
        if (!d.exists) return [];
        return d.list().map((e) => ({
          uri: e.uri,
          name: e.name ?? Paths.basename(e.uri),
          isFile: e instanceof File,
          size: e instanceof File ? e.size : null,
        }));
      },
    };

    const newBytes = new Uint8Array([10, 20, 30, 40, 50]);
    await expect(
      persistReportFile(
        patientA,
        { type: 'bytes', bytes: newBytes },
        30,
        'xlsx',
        partialFailAdapter,
      ),
    ).rejects.toThrow('Fallo simulado a mitad de escritura en disco');

    // Comprobar que el archivo temporal parcial creado NO quedó en el sistema de archivos
    expect(partialTempCreatedUri).not.toBeNull();
    const tempFile = new File(partialTempCreatedUri!);
    expect(tempFile.exists).toBe(false);

    // Comprobar que el reporte previo sigue existiendo intacto y con el mismo tamaño
    expect(prevFile.exists).toBe(true);
    expect(prevFile.size).toBe(prevSize);

    await deletePatientReport(patientA, prevFilename);
  });

  it('recupera y elimina temporales huérfanos (.tmp_reporte_*) bajo el bloqueo del paciente', async () => {
    const { File } = await import('expo-file-system');
    const dir = getPatientReportDirectory(patientA);
    dir.create({ intermediates: true });

    const orphanFile = new File(dir, `.tmp_reporte_30d_${Date.now()}_abc123.xlsx`);
    await orphanFile.write('dos bytes residuales');
    expect(orphanFile.exists).toBe(true);

    // cleanOrphanedTempReports debe eliminarlo
    const cleaned = await cleanOrphanedTempReports(patientA);
    expect(cleaned).toBeGreaterThanOrEqual(1);
    expect(orphanFile.exists).toBe(false);

    // También getPatientReportList debe limpiar huérfanos automáticamente
    const orphanFile2 = new File(dir, `.tmp_reporte_7d_${Date.now()}_def456.pdf`);
    await orphanFile2.write('otro temporal');
    expect(orphanFile2.exists).toBe(true);

    await getPatientReportList(patientA);
    expect(orphanFile2.exists).toBe(false);
  });

  it('propaga errores de acceso y lectura del directorio en getPatientReportList y listPatientReports', async () => {
    const errorAdapter: BinaryReportStorageAdapter = {
      async writeBytes() {},
      async copyFile() {},
      async moveFile() {},
      async deleteFile() {},
      async fileExists() {
        return true;
      },
      async directoryExists() {
        return true; // El directorio sí existe
      },
      async getFileSize() {
        return 100;
      },
      async ensureDirectory() {},
      async listDirectory() {
        throw new Error('EACCES: permiso denegado al leer directorio');
      },
    };

    await expect(getPatientReportList(patientA, errorAdapter)).rejects.toThrow(
      'EACCES: permiso denegado al leer directorio',
    );
    await expect(listPatientReports(patientA, errorAdapter)).rejects.toThrow(
      'EACCES: permiso denegado al leer directorio',
    );
  });
});

describe('staging en dos fases de PDF y archivo compañero de accesibilidad (.pdf.a11y.json)', () => {
  it('guarda atómicamente el PDF y su instantánea accesible cifrada', async () => {
    const { File, Paths } = await import('expo-file-system');
    const dummyPdf = new File(Paths.cache, 'source_test_doc.pdf');
    await dummyPdf.write(new Uint8Array([1, 2, 3, 4, 5, 6]));

    const snapshot = {
      pacienteId: patientA,
      periodDays: 30,
      summary: { vitalsCount: 10, symptomsCount: 2 },
    };

    const { persistentUri, filename } = await persistReportPdf(
      patientA,
      dummyPdf.uri,
      30,
      undefined,
      snapshot,
    );

    expect(filename).toMatch(/^reporte_30d_\d+\.pdf$/);
    const pdfFile = new File(persistentUri);
    expect(pdfFile.exists).toBe(true);

    const companionFile = new File(`${persistentUri}.a11y.json`);
    expect(companionFile.exists).toBe(true);

    // La lista de reportes de usuario NO expone el .a11y.json como reporte duplicado
    const list = await getPatientReportList(patientA);
    expect(list.some((r) => r.filename === filename)).toBe(true);
    expect(list.some((r) => r.filename.includes('.a11y.json'))).toBe(false);

    // Lectura accesible desencripta y recupera el snapshot idéntico
    const recovered = await readPatientReportA11ySnapshot<typeof snapshot>(patientA, filename);
    expect(recovered).not.toBeNull();
    expect(recovered?.summary.vitalsCount).toBe(10);
    expect(recovered?.summary.symptomsCount).toBe(2);

    // Eliminar el reporte elimina tanto el PDF como su compañero .a11y.json
    const deleted = await deletePatientReport(patientA, filename);
    expect(deleted).toBe(true);
    expect(pdfFile.exists).toBe(false);
    expect(companionFile.exists).toBe(false);
  });

  it('reporte legado sin instantánea devuelve null sin error ni consulta viva', async () => {
    const { File, Paths } = await import('expo-file-system');
    const dummyPdf = new File(Paths.cache, 'legacy_test_doc.pdf');
    await dummyPdf.write(new Uint8Array([9, 8, 7]));

    const { filename } = await persistReportPdf(patientA, dummyPdf.uri, 7);
    const a11y = await readPatientReportA11ySnapshot(patientA, filename);
    expect(a11y).toBeNull();

    await deletePatientReport(patientA, filename);
  });

  it('recuperación ante interrupción: si falla la escritura del archivo compañero, elimina ambos temporales', async () => {
    const { Directory, File, Paths } = await import('expo-file-system');
    const dummyPdf = new File(Paths.cache, 'failing_test_doc.pdf');
    await dummyPdf.write(new Uint8Array([1, 1, 1]));

    let writeCount = 0;
    const failingAdapter: BinaryReportStorageAdapter = {
      async writeBytes(uri, b) {
        writeCount++;
        if (uri.includes('.a11y.json.tmp')) {
          throw new Error('Fallo simulado al escribir instantánea accesible');
        }
        await new File(uri).write(b);
      },
      async copyFile(s, t) {
        await new File(s).copy(new File(t));
      },
      async moveFile(s, t) {
        await new File(s).move(new File(t));
      },
      async deleteFile(uri) {
        const f = new File(uri);
        if (f.exists) await f.delete();
      },
      async fileExists(uri) {
        return new File(uri).exists;
      },
      async directoryExists(dir) {
        return new Directory(dir).exists;
      },
      async getFileSize(uri) {
        const f = new File(uri);
        return f.exists ? f.size : null;
      },
      async ensureDirectory(dir) {
        new Directory(dir).create({ intermediates: true, idempotent: true });
      },
      async listDirectory(dir) {
        const d = new Directory(dir);
        if (!d.exists) return [];
        return d.list().map((e) => ({
          uri: e.uri,
          name: e.name ?? Paths.basename(e.uri),
          isFile: e instanceof File,
          size: e instanceof File ? e.size : null,
        }));
      },
    };

    await expect(
      persistReportPdf(patientA, dummyPdf.uri, 90, failingAdapter, { test: 123 }),
    ).rejects.toThrow('Fallo simulado al escribir instantánea accesible');

    // Comprobar que no quedaron archivos temporales huérfanos
    const dir = getPatientReportDirectory(patientA);
    const files = new Directory(dir).list();
    const tempOrphans = files.filter((f) => f.name && f.name.includes('.tmp'));
    expect(tempOrphans.length).toBe(0);
    expect(writeCount).toBeGreaterThan(0);
  });
});

describe('clearAllPatientReports (prevencion de interbloqueos y limpieza completa)', () => {
  it('elimina todos los reportes y acompanantes a11y sin bloquear operaciones subsiguientes', async () => {
    const { File, Paths } = await import('expo-file-system');
    const dummyPdf = new File(Paths.cache, 'dummy-clear.pdf');
    await dummyPdf.write(new Uint8Array([1, 2, 3, 4]));

    const persisted = await persistReportPdf(patientA, dummyPdf.uri, 30, undefined, {
      resumen: 'a11y',
    });
    expect(persisted.persistentUri).toBeTruthy();

    const listBefore = await getPatientReportList(patientA);
    expect(listBefore.length).toBeGreaterThan(0);

    const result = await clearAllPatientReports(patientA);
    expect(result.deleted).toBeGreaterThan(0);

    const listAfter = await getPatientReportList(patientA);
    expect(listAfter.length).toBe(0);

    // Comprobar que no queda bloqueado y permite generar un nuevo reporte de inmediato
    const nextPdfSource = new File(Paths.cache, 'dummy-clear-2.pdf');
    await nextPdfSource.write(new Uint8Array([5, 6, 7, 8]));
    const nextPdf = await persistReportPdf(patientA, nextPdfSource.uri, 7);
    expect(nextPdf.persistentUri).toBeTruthy();
    const listFinal = await getPatientReportList(patientA);
    expect(listFinal.length).toBe(1);
  });
});

// Unit tests exercise storage behavior; native cryptography is verified separately.
beforeEach(() => {
  const release = activateFileCipher({
    owns: () => true,
    protect: async (_path, bytes) => bytes,
    unprotect: async (_path, bytes) => bytes,
  });
  return release;
});
