import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DatabaseSync } from 'node:sqlite';
import type { FileStorageAdapter } from '../../data/local/files/file-storage-adapter';
import { NodeFileStorageAdapter } from '../../data/local/files/node-file-storage-adapter';
import { migrateDatabase } from '../../data/local/migrations';
import { seedPatientContextIfEmpty } from '../../data/local/repository';
import type { SqlConnection, SqlValue } from '../../data/local/core/sql';
import {
  deleteFormDraft,
  isValidDraftPayload,
  listPatientDrafts,
  loadFormDraft,
  recoverOrphanDraftBackups,
  saveFormDraft,
} from './form-draft-storage';
import { importLegacyDrafts } from './form-legacy-import';
import { computeSha256 } from '../../utils/crypto';
import { medicalFormsService } from './medical-form-service';
import type { MedicalFormDraft } from './medical-form-types';
import { validateFormAnswers } from './medical-form-validation';
import { SAMPLE_MEDICAL_FORMS } from './sample-medical-forms';

const patientA = '11111111-1111-4111-8111-111111111111';
const patientB = '22222222-2222-4222-8222-222222222222';
const temporaryDirs: string[] = [];
const openedDbs: DatabaseSync[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'quimiocare-forms-test-'));
  temporaryDirs.push(dir);
  return dir;
}

function createTestDb(): SqlConnection {
  const native = new DatabaseSync(':memory:');
  openedDbs.push(native);
  const operations = {
    exec: async (sql: string) => {
      native.exec(sql);
    },
    run: async (sql: string, values: SqlValue[] = []) => {
      native.prepare(sql).run(...values);
    },
    first: async <T>(sql: string, values: SqlValue[] = []) =>
      (native.prepare(sql).get(...values) as T | undefined) ?? null,
    all: async <T>(sql: string, values: SqlValue[] = []) =>
      native.prepare(sql).all(...values) as T[],
  };
  return {
    ...operations,
    async transaction(work) {
      native.exec('BEGIN IMMEDIATE');
      try {
        await work({
          ...operations,
          transaction: async () => {
            throw new Error('Transacción anidada');
          },
        });
        native.exec('COMMIT');
      } catch (e) {
        native.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

afterEach(() => {
  for (const db of openedDbs.splice(0)) db.close();
  for (const dir of temporaryDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('validación de respuestas de cuestionarios médicos', () => {
  const qlqForm = SAMPLE_MEDICAL_FORMS.find((f) => f.id === 'form-qlq30-muestra')!;
  const esasForm = SAMPLE_MEDICAL_FORMS.find((f) => f.id === 'form-esas-muestra')!;

  it('rechaza respuestas incompletas cuando faltan preguntas obligatorias', () => {
    const result = validateFormAnswers(qlqForm, {});
    expect(result.isValid).toBe(false);
    expect(result.errors.q1).toBe('Esta pregunta es obligatoria.');
    expect(result.errors.q2).toBe('Esta pregunta es obligatoria.');
    expect(result.errors.q3).toBe('Esta pregunta es obligatoria.');
    expect(result.errors.q4).toBe('Esta pregunta es obligatoria.');
    // q5 es opcional, no debe tener error si no está
    expect(result.errors.q5).toBeUndefined();
  });

  it('aprueba respuestas completas y válidas para preguntas requeridas', () => {
    const validAnswers = {
      q1: 'nada',
      q2: 'un_poco',
      q3: 'bastante',
      q4: 8,
    };
    const result = validateFormAnswers(qlqForm, validAnswers);
    expect(result.isValid).toBe(true);
    expect(Object.keys(result.errors)).toHaveLength(0);
  });

  it('valida tipos y opciones en preguntas opcionales contestadas', () => {
    // Si la opcional tiene valor inválido (ej. no string o escala inválida)
    const invalidOptional = {
      q1: 'nada',
      q2: 'un_poco',
      q3: 'bastante',
      q4: 8,
      q5: 123 as unknown as string, // q5 es texto
    };
    const result = validateFormAnswers(qlqForm, invalidOptional);
    expect(result.isValid).toBe(false);
    expect(result.errors.q5).toBe('El texto ingresado no es válido.');
  });

  it('valida opciones permitidas en selección simple', () => {
    const invalidChoice = {
      q1: 'opcion_inexistente',
      q2: 'un_poco',
      q3: 'bastante',
      q4: 5,
    };
    const result = validateFormAnswers(qlqForm, invalidChoice);
    expect(result.isValid).toBe(false);
    expect(result.errors.q1).toBe('La opción seleccionada no es válida.');
  });

  it('valida rangos enteros en escalas 0 a 10', () => {
    const outOfRange = {
      esas_dolor: 11,
      esas_fatiga: -1,
      esas_nauseas: 5.5,
    };
    const result = validateFormAnswers(esasForm, outOfRange);
    expect(result.isValid).toBe(false);
    expect(result.errors.esas_dolor).toBe('El valor debe encontrarse entre 0 y 10.');
    expect(result.errors.esas_fatiga).toBe('El valor debe encontrarse entre 0 y 10.');
    expect(result.errors.esas_nauseas).toBe('Debes seleccionar un valor entero en la escala.');
  });

  it('aplica la regla de opción excluyente para «Ninguna molestia adicional»', () => {
    // Caso 1: 'ninguna' combinada con otra opción -> debe fallar
    const combinedAnswers = {
      esas_dolor: 0,
      esas_fatiga: 0,
      esas_nauseas: 0,
      esas_sintomas_secundarios: ['boca_seca', 'ninguna'],
    };
    const resultCombined = validateFormAnswers(esasForm, combinedAnswers);
    expect(resultCombined.isValid).toBe(false);
    expect(resultCombined.errors.esas_sintomas_secundarios).toContain('no puede combinarse');

    // Caso 2: 'ninguna' sola -> debe ser válida
    const exclusiveAnswers = {
      esas_dolor: 0,
      esas_fatiga: 0,
      esas_nauseas: 0,
      esas_sintomas_secundarios: ['ninguna'],
    };
    const resultExclusive = validateFormAnswers(esasForm, exclusiveAnswers);
    expect(resultExclusive.isValid).toBe(true);

    // Caso 3: varias molestias válidas sin 'ninguna' -> debe ser válida
    const multipleAnswers = {
      esas_dolor: 0,
      esas_fatiga: 0,
      esas_nauseas: 0,
      esas_sintomas_secundarios: ['boca_seca', 'mareos'],
    };
    const resultMultiple = validateFormAnswers(esasForm, multipleAnswers);
    expect(resultMultiple.isValid).toBe(true);
  });

  it('rechaza identificadores de preguntas ajenos a la definición del cuestionario', () => {
    const alienAnswers = {
      esas_dolor: 0,
      esas_fatiga: 0,
      esas_nauseas: 0,
      pregunta_ajena: 42,
    };
    const result = validateFormAnswers(esasForm, alienAnswers);
    expect(result.isValid).toBe(false);
    expect(result.errors.pregunta_ajena).toBe(
      "La clave 'pregunta_ajena' no pertenece a la definición de este cuestionario.",
    );
  });

  it('rechaza una cadena de texto o espacios para una pregunta opcional de selección múltiple', () => {
    const whitespaceMultipleChoice = {
      esas_dolor: 0,
      esas_fatiga: 0,
      esas_nauseas: 0,
      esas_sintomas_secundarios: '   ' as unknown as string[],
    };
    const result = validateFormAnswers(esasForm, whitespaceMultipleChoice);
    expect(result.isValid).toBe(false);
    expect(result.errors.esas_sintomas_secundarios).toBe(
      'El valor debe ser una lista de opciones.',
    );
  });
});

describe('servicio de asignaciones de cuestionarios por paciente', () => {
  it('provee 2 cuestionarios de muestra para el Paciente A y 1 para el Paciente B', () => {
    const formsA = medicalFormsService.getAssignedForms(patientA);
    const formsB = medicalFormsService.getAssignedForms(patientB);

    expect(formsA).toHaveLength(2);
    expect(formsA.map((f) => f.id)).toEqual(['form-qlq30-muestra', 'form-esas-muestra']);

    expect(formsB).toHaveLength(1);
    expect(formsB.map((f) => f.id)).toEqual(['form-esas-muestra']);
  });

  it('permite consultar un formulario asignado específico y rechaza no asignados', () => {
    const qlqForA = medicalFormsService.getForm(patientA, 'form-qlq30-muestra');
    expect(qlqForA).not.toBeNull();
    expect(qlqForA?.id).toBe('form-qlq30-muestra');

    // Paciente B no tiene asignado QLQ-C30
    const qlqForB = medicalFormsService.getForm(patientB, 'form-qlq30-muestra');
    expect(qlqForB).toBeNull();
  });
});

describe('almacenamiento de borradores con adaptador y reemplazo seguro', () => {
  const adapter = new NodeFileStorageAdapter();

  it('guarda, carga y aísla borradores por paciente y versión', async () => {
    const baseDir = createTempDir();
    const resolver = (pId: string) => join(baseDir, pId, 'borradores');

    const draftA: MedicalFormDraft = {
      formularioId: 'form-qlq30-muestra',
      version: '1.0',
      pacienteId: patientA,
      respuestas: { q1: 'nada', q2: 'bastante', q4: 9 },
      completado: false,
      guardadoEn: '2026-10-04T12:00:00Z',
    };

    // 1. Guardar borrador para Paciente A
    await saveFormDraft(draftA, adapter, resolver);

    // 2. Cargar borrador de Paciente A
    const loadedA = await loadFormDraft(patientA, 'form-qlq30-muestra', '1.0', adapter, resolver);
    expect(loadedA).not.toBeNull();
    expect(loadedA?.pacienteId).toBe(patientA);
    expect(loadedA?.respuestas.q1).toBe('nada');
    expect(loadedA?.completado).toBe(false);

    // 3. Aislamiento por versión: v2.0 no debe cargar el borrador de v1.0
    const loadedV2 = await loadFormDraft(patientA, 'form-qlq30-muestra', '2.0', adapter, resolver);
    expect(loadedV2).toBeNull();

    // 4. Aislamiento por paciente: Paciente B no ve el borrador de Paciente A
    const loadedB = await loadFormDraft(patientB, 'form-qlq30-muestra', '1.0', adapter, resolver);
    expect(loadedB).toBeNull();

    const listB = await listPatientDrafts(patientB, adapter, resolver);
    expect(listB).toHaveLength(0);

    const listA = await listPatientDrafts(patientA, adapter, resolver);
    expect(listA).toHaveLength(1);
    expect(listA[0].formularioId).toBe('form-qlq30-muestra');

    // 5. Eliminar borrador
    const deleted = await deleteFormDraft(patientA, 'form-qlq30-muestra', '1.0', adapter, resolver);
    expect(deleted).toBe(true);
    const afterDelete = await loadFormDraft(
      patientA,
      'form-qlq30-muestra',
      '1.0',
      adapter,
      resolver,
    );
    expect(afterDelete).toBeNull();
  });

  it('restaura el borrador previo desde .bak si falla el reemplazo en disco', async () => {
    const baseDir = createTempDir();
    const resolver = (pId: string) => join(baseDir, pId, 'borradores');

    const initialDraft: MedicalFormDraft = {
      formularioId: 'form-esas-muestra',
      version: '1.0',
      pacienteId: patientA,
      respuestas: { esas_dolor: 2 },
      completado: false,
      guardadoEn: '2026-10-04T10:00:00Z',
    };

    // Guardado inicial
    await saveFormDraft(initialDraft, adapter, resolver);

    // Creamos un adaptador con fallo simulado en moveFile al reemplazar
    let moveCount = 0;
    const faultyAdapter: FileStorageAdapter = {
      ...adapter,
      exists: (p) => adapter.exists(p),
      readText: (p) => adapter.readText(p),
      writeText: (p, c) => adapter.writeText(p, c),
      deleteFile: (p) => adapter.deleteFile(p),
      listDirectory: (p) => adapter.listDirectory(p),
      ensureDirectory: (p) => adapter.ensureDirectory(p),
      moveFile: async (src, dst, opts) => {
        moveCount++;
        // El primer move es renombrar target a .bak
        // El segundo move es mover .tmp a target (aquí simulamos error)
        if (moveCount === 2) {
          throw new Error('Fallo simulado de E/S al reemplazar archivo destino.');
        }
        return adapter.moveFile(src, dst, opts);
      },
    };

    const updatedDraft: MedicalFormDraft = {
      formularioId: 'form-esas-muestra',
      version: '1.0',
      pacienteId: patientA,
      respuestas: { esas_dolor: 9 },
      completado: true,
      guardadoEn: '2026-10-04T11:00:00Z',
    };

    await expect(saveFormDraft(updatedDraft, faultyAdapter, resolver)).rejects.toThrow(
      'Fallo simulado de E/S',
    );

    // Verificar que el borrador inicial se restauró íntegramente
    const restored = await loadFormDraft(patientA, 'form-esas-muestra', '1.0', adapter, resolver);
    expect(restored).not.toBeNull();
    expect(restored?.respuestas.esas_dolor).toBe(2);
    expect(restored?.completado).toBe(false);
  });

  it('maneja con seguridad archivos JSON corruptos o temporales abandonados', async () => {
    const baseDir = createTempDir();
    const patientDir = join(baseDir, patientA, 'borradores');
    const resolver = (pId: string) => join(baseDir, pId, 'borradores');
    await adapter.ensureDirectory(patientDir);

    // Escribir un archivo corrupto y un temporal abandonado
    writeFileSync(join(patientDir, 'corrupto_v1.0.json'), '{ invalid json ...', 'utf-8');
    writeFileSync(join(patientDir, 'form_abandonado.12345.tmp'), 'temporal no finalizado', 'utf-8');

    // Listar borradores no debe fallar
    const drafts = await listPatientDrafts(patientA, adapter, resolver);
    expect(drafts).toEqual([]);

    // El temporal abandonado debió ser limpiado automáticamente
    const files = await adapter.listDirectory(patientDir);
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('recupera automáticamente respaldo huérfano .bak si el guardado fue interrumpido entre movimientos', async () => {
    const baseDir = createTempDir();
    const patientDir = join(baseDir, patientA, 'borradores');
    const resolver = (pId: string) => join(baseDir, pId, 'borradores');
    await adapter.ensureDirectory(patientDir);

    const savedDraft: MedicalFormDraft = {
      formularioId: 'form-esas-muestra',
      version: '1.0',
      pacienteId: patientA,
      respuestas: { esas_dolor: 4, esas_fatiga: 5 },
      completado: false,
      guardadoEn: '2026-10-06T12:00:00Z',
    };

    // Simular estado posterior al movimiento de .json a .bak justo antes del cierre inesperado:
    // Solo existe el archivo .bak y un .tmp no movido, pero NO existe el .json final
    const bakFile = join(patientDir, 'form-esas-muestra_v1.0.bak');
    const tmpFile = join(patientDir, 'form-esas-muestra_v1.0.999.tmp');
    writeFileSync(bakFile, JSON.stringify(savedDraft, null, 2), 'utf-8');
    writeFileSync(tmpFile, 'contenido temporal no completado', 'utf-8');

    // 1. loadFormDraft debe detectar el .bak huérfano, restaurarlo a .json y retornar los datos intactos
    const loaded = await loadFormDraft(patientA, 'form-esas-muestra', '1.0', adapter, resolver);
    expect(loaded).not.toBeNull();
    expect(loaded?.respuestas.esas_dolor).toBe(4);
    expect(loaded?.respuestas.esas_fatiga).toBe(5);

    // 2. Verificar que el archivo .json fue restaurado
    const jsonFile = join(patientDir, 'form-esas-muestra_v1.0.json');
    expect(await adapter.exists(jsonFile)).toBe(true);
  });

  it('listPatientDrafts recupera respaldos huérfanos antes de limpiar temporales sin perder el borrador', async () => {
    const baseDir = createTempDir();
    const patientDir = join(baseDir, patientA, 'borradores');
    const resolver = (pId: string) => join(baseDir, pId, 'borradores');
    await adapter.ensureDirectory(patientDir);

    const savedDraft: MedicalFormDraft = {
      formularioId: 'form-qlq30-muestra',
      version: '1.0',
      pacienteId: patientA,
      respuestas: { q1: 'nada', q2: 'bastante' },
      completado: true,
      guardadoEn: '2026-10-06T14:00:00Z',
    };

    // Dejar un .bak huérfano y un .tmp
    writeFileSync(
      join(patientDir, 'form-qlq30-muestra_v1.0.bak'),
      JSON.stringify(savedDraft, null, 2),
      'utf-8',
    );
    writeFileSync(join(patientDir, 'incompleto.tmp'), 'residuo', 'utf-8');

    // Listar borradores debe recuperar el respaldo a .json, limpiar el .tmp y devolver el borrador
    const drafts = await listPatientDrafts(patientA, adapter, resolver);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].formularioId).toBe('form-qlq30-muestra');
    expect(drafts[0].respuestas.q1).toBe('nada');

    // Comprobar que el .bak fue restaurado a .json y el .tmp fue eliminado
    const files = await adapter.listDirectory(patientDir);
    expect(files.some((f) => f.endsWith('.json'))).toBe(true);
    expect(files.some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  it('aborta y preserva el borrador existente si falla la creación del respaldo .bak', async () => {
    const baseDir = createTempDir();
    const resolver = (pId: string) => join(baseDir, pId, 'borradores');

    const initialDraft: MedicalFormDraft = {
      formularioId: 'form-esas-muestra',
      version: '1.0',
      pacienteId: patientA,
      respuestas: { esas_dolor: 3 },
      completado: false,
      guardadoEn: '2026-10-06T10:00:00Z',
    };

    // Guardado inicial exitoso
    await saveFormDraft(initialDraft, adapter, resolver);

    // Adaptador que falla intencionalmente en el primer moveFile (al crear el respaldo .bak)
    const backupFailAdapter: FileStorageAdapter = {
      ...adapter,
      exists: (p) => adapter.exists(p),
      readText: (p) => adapter.readText(p),
      writeText: (p, c) => adapter.writeText(p, c),
      deleteFile: (p) => adapter.deleteFile(p),
      listDirectory: (p) => adapter.listDirectory(p),
      ensureDirectory: (p) => adapter.ensureDirectory(p),
      moveFile: async (_src, dst, _opts) => {
        if (dst.endsWith('.bak')) {
          throw new Error('Fallo de permisos simulado al crear respaldo .bak');
        }
        return adapter.moveFile(_src, dst, _opts);
      },
    };

    const updateAttempt: MedicalFormDraft = {
      formularioId: 'form-esas-muestra',
      version: '1.0',
      pacienteId: patientA,
      respuestas: { esas_dolor: 10 },
      completado: true,
      guardadoEn: '2026-10-06T15:00:00Z',
    };

    // Debe abortar con error
    await expect(saveFormDraft(updateAttempt, backupFailAdapter, resolver)).rejects.toThrow(
      'Fallo de permisos simulado al crear respaldo .bak',
    );

    // El borrador inicial .json debe preservarse intacto
    const preserved = await loadFormDraft(patientA, 'form-esas-muestra', '1.0', adapter, resolver);
    expect(preserved).not.toBeNull();
    expect(preserved?.respuestas.esas_dolor).toBe(3);
    expect(preserved?.completado).toBe(false);
  });

  it('recoverOrphanDraftBackups recupera directamente respaldos huérfanos sin sobreescribir', async () => {
    const baseDir = createTempDir();
    const patientDir = join(baseDir, patientA, 'borradores');
    await adapter.ensureDirectory(patientDir);

    const bakFile = join(patientDir, 'form-directo_1.0.bak');
    const draftContent: MedicalFormDraft = {
      formularioId: 'form-directo',
      version: '1.0',
      pacienteId: patientA,
      respuestas: { esas_nauseas: 4 },
      completado: false,
      guardadoEn: '2026-10-06T12:00:00Z',
    };
    await adapter.writeText(bakFile, JSON.stringify(draftContent));

    const recovered = await recoverOrphanDraftBackups(patientDir, adapter);
    expect(recovered).toBe(1);
    expect(await adapter.exists(join(patientDir, 'form-directo_1.0.json'))).toBe(true);
    expect(await adapter.exists(bakFile)).toBe(false);
  });

  it('listPatientDrafts durante una escritura pausada no elimina el .tmp activo ni recupera el .bak prematuramente', async () => {
    const baseDir = createTempDir();
    const resolver = (pId: string) => join(baseDir, pId, 'borradores');

    let resolveWritePause: () => void = () => {};
    const writePausedPromise = new Promise<void>((r) => {
      resolveWritePause = r;
    });

    let pauseStartedResolve: () => void = () => {};
    const pauseStartedPromise = new Promise<void>((r) => {
      pauseStartedResolve = r;
    });

    const slowAdapter: FileStorageAdapter = {
      ...adapter,
      exists: (p) => adapter.exists(p),
      readText: (p) => adapter.readText(p),
      deleteFile: (p) => adapter.deleteFile(p),
      moveFile: (src, dst, opts) => adapter.moveFile(src, dst, opts),
      listDirectory: (p) => adapter.listDirectory(p),
      ensureDirectory: (p) => adapter.ensureDirectory(p),
      writeText: async (p, c) => {
        await adapter.writeText(p, c);
        if (p.endsWith('.tmp')) {
          pauseStartedResolve();
          await writePausedPromise;
        }
      },
    };

    const draft: MedicalFormDraft = {
      formularioId: 'form-esas-muestra',
      version: '1.0',
      pacienteId: patientA,
      respuestas: { esas_apetito: 5 },
      completado: false,
      guardadoEn: '2026-10-06T14:00:00Z',
    };

    // Iniciar guardado pausado
    const savePromise = saveFormDraft(draft, slowAdapter, resolver);

    // Esperar a que el archivo .tmp haya sido escrito y esté pausado
    await pauseStartedPromise;

    const patientDir = resolver(patientA);
    const filesDuringPause = await adapter.listDirectory(patientDir);
    const activeTmp = filesDuringPause.find((f) => f.endsWith('.tmp'));
    expect(activeTmp).toBeDefined();

    // Ejecutar listPatientDrafts concurrentemente
    const draftsFound = await listPatientDrafts(patientA, adapter, resolver);
    expect(draftsFound).toHaveLength(0);

    // Comprobar que listPatientDrafts NO eliminó el archivo .tmp en vuelo
    expect(await adapter.exists(activeTmp!)).toBe(true);

    // Reanudar el guardado
    resolveWritePause();
    await savePromise;

    // Ahora que terminó, el borrador .json existe y se puede listar
    const draftsAfter = await listPatientDrafts(patientA, adapter, resolver);
    expect(draftsAfter).toHaveLength(1);
    expect(draftsAfter[0].respuestas.esas_apetito).toBe(5);
  });

  it('deleteFormDraft devuelve false si el borrado de .bak falla, evitando confirmar el descarte', async () => {
    const baseDir = createTempDir();
    const resolver = (pId: string) => join(baseDir, pId, 'borradores');
    const patientDir = resolver(patientA);
    await adapter.ensureDirectory(patientDir);

    const jsonPath = join(patientDir, 'form-esas-muestra_v1.0.json');
    const bakPath = join(patientDir, 'form-esas-muestra_v1.0.bak');

    await adapter.writeText(jsonPath, JSON.stringify({ formularioId: 'form-esas-muestra' }));
    await adapter.writeText(
      bakPath,
      JSON.stringify({ formularioId: 'form-esas-muestra', backup: true }),
    );

    // Adaptador que falla intencionalmente al borrar el archivo .bak
    const failBakDeleteAdapter: FileStorageAdapter = {
      ...adapter,
      exists: (p) => adapter.exists(p),
      readText: (p) => adapter.readText(p),
      writeText: (p, c) => adapter.writeText(p, c),
      moveFile: (src, dst, opts) => adapter.moveFile(src, dst, opts),
      listDirectory: (p) => adapter.listDirectory(p),
      ensureDirectory: (p) => adapter.ensureDirectory(p),
      deleteFile: async (p) => {
        if (p.endsWith('.bak')) {
          return false; // Fallo simulado al borrar respaldo
        }
        return adapter.deleteFile(p);
      },
    };

    const result = await deleteFormDraft(
      patientA,
      'form-esas-muestra',
      '1.0',
      failBakDeleteAdapter,
      resolver,
    );
    // Debe devolver false porque el descarte no fue completo
    expect(result).toBe(false);
  });

  it('recupera desde .bak si el archivo .json existente está corrupto o truncado', async () => {
    const baseDir = createTempDir();
    const resolver = (pId: string) => join(baseDir, pId, 'borradores');
    const patientDir = resolver(patientA);
    await adapter.ensureDirectory(patientDir);

    const jsonPath = join(patientDir, 'form-esas-muestra_v1.0.json');
    const bakPath = join(patientDir, 'form-esas-muestra_v1.0.bak');

    // .json corrupto o truncado (ej. corte de energía a mitad de escritura)
    await adapter.writeText(jsonPath, '{"formularioId": "form-esas-muestra", "incompleto":');

    // .bak válido y saludable
    const validDraft: MedicalFormDraft = {
      formularioId: 'form-esas-muestra',
      version: '1.0',
      pacienteId: patientA,
      respuestas: { esas_dolor: 2, esas_cansancio: 4 },
      completado: false,
      guardadoEn: '2026-10-06T16:00:00Z',
    };
    await adapter.writeText(bakPath, JSON.stringify(validDraft));

    // loadFormDraft debe detectar el .json corrupto y restaurar el .bak
    const loaded = await loadFormDraft(patientA, 'form-esas-muestra', '1.0', adapter, resolver);
    expect(loaded).not.toBeNull();
    expect(loaded?.respuestas.esas_dolor).toBe(2);
    expect(loaded?.respuestas.esas_cansancio).toBe(4);

    // El .json restaurado ahora es legible en disco
    const jsonContent = await adapter.readText(jsonPath);
    expect(jsonContent).not.toContain('incompleto');
  });

  it('recupera desde .bak si el archivo .json existente es sintácticamente válido pero con estructura incompleta (respuestas: null)', async () => {
    const baseDir = createTempDir();
    const resolver = (pId: string) => join(baseDir, pId, 'borradores');
    const patientDir = resolver(patientA);
    await adapter.ensureDirectory(patientDir);

    const jsonPath = join(patientDir, 'form-esas-muestra_v1.0.json');
    const bakPath = join(patientDir, 'form-esas-muestra_v1.0.bak');

    // .json parseable pero inválido: respuestas es null (typeof null === 'object')
    const invalidJsonPayload = {
      formularioId: 'form-esas-muestra',
      version: '1.0',
      pacienteId: patientA,
      respuestas: null,
      completado: false,
      guardadoEn: '2026-10-06T16:00:00Z',
    };
    await adapter.writeText(jsonPath, JSON.stringify(invalidJsonPayload));

    // .bak válido con respuestas íntegras
    const validDraft: MedicalFormDraft = {
      formularioId: 'form-esas-muestra',
      version: '1.0',
      pacienteId: patientA,
      respuestas: { esas_dolor: 6, esas_fatiga: 7 },
      completado: false,
      guardadoEn: '2026-10-06T15:30:00Z',
    };
    await adapter.writeText(bakPath, JSON.stringify(validDraft));

    // Comprobar directamente el validador estricto
    expect(isValidDraftPayload(JSON.stringify(invalidJsonPayload))).toBe(false);
    expect(isValidDraftPayload(JSON.stringify(validDraft))).toBe(true);

    // recoverOrphanDraftBackups debe rechazar el .json inválido y restaurar el .bak
    const recoveredCount = await recoverOrphanDraftBackups(patientDir, adapter);
    expect(recoveredCount).toBe(1);

    // Cargar el borrador debe retornar los datos íntegros restaurados desde el respaldo
    const loaded = await loadFormDraft(patientA, 'form-esas-muestra', '1.0', adapter, resolver);
    expect(loaded).not.toBeNull();
    expect(loaded?.respuestas.esas_dolor).toBe(6);
    expect(loaded?.respuestas.esas_fatiga).toBe(7);
  });

  it('la recuperación iniciada antes de un guardado no interfiere ni elimina el respaldo del guardado concurrente', async () => {
    const baseDir = createTempDir();
    const resolver = (pId: string) => join(baseDir, pId, 'borradores');
    const patientDir = resolver(patientA);
    await adapter.ensureDirectory(patientDir);

    // Crear un borrador existente en disco
    const initialDraft: MedicalFormDraft = {
      formularioId: 'form-esas-muestra',
      version: '1.0',
      pacienteId: patientA,
      respuestas: { esas_dolor: 1 },
      completado: false,
      guardadoEn: '2026-10-06T10:00:00Z',
    };
    await saveFormDraft(initialDraft, adapter, resolver);

    // Crear tanto el .json existente como un .bak para que la recuperación procese el borrador
    const bakFile = join(patientDir, 'form-esas-muestra_v1.0.bak');
    await adapter.writeText(bakFile, JSON.stringify(initialDraft));

    let unpauseRecovery: () => void = () => {};
    const recoveryPausedPromise = new Promise<void>((r) => {
      unpauseRecovery = r;
    });

    let recoveryStartedResolve: () => void = () => {};
    const recoveryStartedPromise = new Promise<void>((r) => {
      recoveryStartedResolve = r;
    });

    // Adaptador donde la lectura de .json durante la recuperación se pausa deliberadamente dentro del bloqueo
    const pausedRecoveryAdapter: FileStorageAdapter = {
      exists: (p) => adapter.exists(p),
      readText: async (p) => {
        const text = await adapter.readText(p);
        if (p.endsWith('.json') && p.includes('form-esas-muestra')) {
          recoveryStartedResolve();
          await recoveryPausedPromise;
        }
        return text;
      },
      writeText: (p, c) => adapter.writeText(p, c),
      deleteFile: (p) => adapter.deleteFile(p),
      moveFile: (src, dst, opts) => adapter.moveFile(src, dst, opts),
      listDirectory: (p) => adapter.listDirectory(p),
      ensureDirectory: (p) => adapter.ensureDirectory(p),
    };

    // Iniciar PRIMERO la recuperación
    const recoveryPromise = recoverOrphanDraftBackups(patientDir, pausedRecoveryAdapter);

    // Esperar a que la recuperación haya comenzado a leer el .json y adquirido el bloqueo
    await recoveryStartedPromise;

    // Iniciar DESPUÉS el guardado mientras la recuperación está pausada
    let saveStarted = false;
    const newDraft: MedicalFormDraft = {
      formularioId: 'form-esas-muestra',
      version: '1.0',
      pacienteId: patientA,
      respuestas: { esas_dolor: 9 },
      completado: true,
      guardadoEn: '2026-10-06T12:00:00Z',
    };

    const saveAdapter: FileStorageAdapter = {
      exists: (p) => adapter.exists(p),
      readText: (p) => adapter.readText(p),
      writeText: async (p, c) => {
        saveStarted = true;
        return adapter.writeText(p, c);
      },
      deleteFile: (p) => adapter.deleteFile(p),
      moveFile: async (src, dst, opts) => {
        // Al intentar mover .tmp a target .json, simulamos fallo de E/S
        if (src.endsWith('.tmp') && dst.endsWith('.json')) {
          throw new Error('Fallo simulado de E/S al reemplazar temporal por destino');
        }
        return adapter.moveFile(src, dst, opts);
      },
      listDirectory: (p) => adapter.listDirectory(p),
      ensureDirectory: (p) => adapter.ensureDirectory(p),
    };

    const savePromise = saveFormDraft(newDraft, saveAdapter, resolver);

    // Debido a withDraftLock, el guardado debe esperar a que termine la recuperación
    expect(saveStarted).toBe(false);

    // Reanudar y finalizar la recuperación
    unpauseRecovery();
    await recoveryPromise;

    // El guardado falla al reemplazar pero restaura su .bak (que la recuperación no borró)
    await expect(savePromise).rejects.toThrow(
      'Fallo simulado de E/S al reemplazar temporal por destino',
    );
    expect(saveStarted).toBe(true);

    // El borrador anterior se conservó íntegramente gracias al bloqueo mutuo
    const finalLoaded = await loadFormDraft(
      patientA,
      'form-esas-muestra',
      '1.0',
      adapter,
      resolver,
    );
    expect(finalLoaded?.respuestas.esas_dolor).toBe(1);
    expect(finalLoaded?.completado).toBe(false);
  });
});

describe('importación legacy de borradores y respuestas a SQLite', () => {
  it('devuelve contadores vacíos sin leer ni crear un directorio legacy inexistente', async () => {
    const missing = join(createTempDir(), 'ausente');
    const adapter = new NodeFileStorageAdapter();
    const list = vi.spyOn(adapter, 'listDirectory');
    const db = createTestDb();
    const result = await importLegacyDrafts(patientA, db, adapter, () => missing);
    expect(result).toEqual({ imported: 0, cleaned: 0, pendingCleanups: 0, errors: 0 });
    expect(list).not.toHaveBeenCalled();
    expect(existsSync(missing)).toBe(false);
  });

  it('importa borrador incompleto a borrador_formulario y limpia archivos físicos tras commit', async () => {
    const dir = createTempDir();
    const adapter = new NodeFileStorageAdapter();
    const resolver = () => dir;

    const db = createTestDb();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    // Crear archivo JSON legacy de borrador incompleto
    const draftContent: MedicalFormDraft = {
      formularioId: 'form-esas-muestra',
      version: '1.0',
      pacienteId: patientA,
      respuestas: { esas_dolor: 4 },
      completado: false,
      guardadoEn: '2026-10-06T10:00:00Z',
    };
    const jsonPath = join(dir, 'form-esas-muestra_v1.0.json');
    writeFileSync(jsonPath, JSON.stringify(draftContent, null, 2));

    const result = await importLegacyDrafts(patientA, db, adapter, resolver);
    expect(result.imported).toBe(1);
    expect(result.cleaned).toBe(1);

    // Verificar en SQLite
    const draftInSql = await db.first<{
      entrega_id: string;
      respuestas_json: string;
    }>(
      'SELECT entrega_id, respuestas_json FROM borrador_formulario WHERE paciente_id = ? AND formulario_id = ?',
      [patientA, 'form-esas-muestra'],
    );
    expect(draftInSql).toBeTruthy();
    expect(JSON.parse(draftInSql!.respuestas_json)).toEqual({ esas_dolor: 4 });

    // Verificar trazabilidad
    const tracking = await db.first<{ estado: string }>(
      'SELECT estado FROM importacion_formularios_legacy WHERE paciente_id = ? AND archivo_relativo = ?',
      [patientA, 'form-esas-muestra_v1.0.json'],
    );
    expect(tracking?.estado).toBe('importado');

    // Verificar que el archivo físico fue eliminado
    expect(await adapter.exists(jsonPath)).toBe(false);
  });

  it('importa cuestionario completado a respuesta_formulario y cola_envio y limpia archivos físicos', async () => {
    const dir = createTempDir();
    const adapter = new NodeFileStorageAdapter();
    const resolver = () => dir;

    const db = createTestDb();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    const completedContent: MedicalFormDraft = {
      formularioId: 'form-esas-muestra',
      version: '1.0',
      pacienteId: patientA,
      respuestas: { esas_dolor: 3, esas_fatiga: 2, esas_nauseas: 0 },
      completado: true,
      guardadoEn: '2026-10-06T11:00:00Z',
    };
    const jsonPath = join(dir, 'form-esas-muestra_v1.0.json');
    writeFileSync(jsonPath, JSON.stringify(completedContent, null, 2));

    const result = await importLegacyDrafts(patientA, db, adapter, resolver);
    expect(result.imported).toBe(1);
    expect(result.cleaned).toBe(1);

    // Verificar en respuesta_formulario
    const submission = await db.first<{
      id: string;
      respuestas_json: string;
    }>(
      'SELECT id, respuestas_json FROM respuesta_formulario WHERE paciente_id = ? AND formulario_id = ?',
      [patientA, 'form-esas-muestra'],
    );
    expect(submission).toBeTruthy();
    expect(JSON.parse(submission!.respuestas_json)).toEqual({
      esas_dolor: 3,
      esas_fatiga: 2,
      esas_nauseas: 0,
    });

    // Verificar en cola_envio
    const queueItem = await db.first<{
      tipo_entidad: string;
      registro_id: string;
      estado: string;
    }>('SELECT * FROM cola_envio WHERE registro_id = ?', [submission!.id]);
    expect(queueItem).toBeTruthy();
    expect(queueItem?.tipo_entidad).toBe('respuesta_formulario');
    expect(queueItem?.estado).toBe('pendiente');

    // Verificar archivo físico eliminado
    expect(await adapter.exists(jsonPath)).toBe(false);
  });

  it('lectura de recuperación pura: usa respaldo .bak válido si .json está ausente o corrupto sin modificar archivos antes de confirmar', async () => {
    const dir = createTempDir();
    const adapter = new NodeFileStorageAdapter();
    const resolver = () => dir;

    const db = createTestDb();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    const validBakContent: MedicalFormDraft = {
      formularioId: 'form-esas-muestra',
      version: '1.0',
      pacienteId: patientA,
      respuestas: { esas_dolor: 7 },
      completado: false,
      guardadoEn: '2026-10-06T11:30:00Z',
    };
    const jsonPath = join(dir, 'form-esas-muestra_v1.0.json');
    const bakPath = join(dir, 'form-esas-muestra_v1.0.bak');

    // Escribir JSON corrupto y .bak válido
    writeFileSync(jsonPath, '{ JSON corrupto con sintaxis invalida !!! ');
    writeFileSync(bakPath, JSON.stringify(validBakContent, null, 2));

    const result = await importLegacyDrafts(patientA, db, adapter, resolver);
    expect(result.imported).toBe(1);
    expect(result.cleaned).toBe(1);

    // Verificar que importó el contenido del respaldo .bak
    const draft = await db.first<{ respuestas_json: string }>(
      'SELECT respuestas_json FROM borrador_formulario WHERE paciente_id = ? AND formulario_id = ?',
      [patientA, 'form-esas-muestra'],
    );
    expect(draft).toBeTruthy();
    expect(JSON.parse(draft!.respuestas_json)).toEqual({ esas_dolor: 7 });

    // Ambos archivos eliminados limpiamente
    expect(await adapter.exists(jsonPath)).toBe(false);
    expect(await adapter.exists(bakPath)).toBe(false);
  });

  it('tolerancia a interrupciones: reintento de limpieza_pendiente limpia archivos físicos sin reinsertar entregas ni duplicar cola', async () => {
    const dir = createTempDir();
    const baseAdapter = new NodeFileStorageAdapter();
    const resolver = () => dir;

    const db = createTestDb();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    const completedContent: MedicalFormDraft = {
      formularioId: 'form-esas-muestra',
      version: '1.0',
      pacienteId: patientA,
      respuestas: { esas_dolor: 2, esas_fatiga: 1, esas_nauseas: 0 },
      completado: true,
      guardadoEn: '2026-10-06T12:00:00Z',
    };
    const jsonPath = join(dir, 'form-esas-muestra_v1.0.json');
    writeFileSync(jsonPath, JSON.stringify(completedContent, null, 2));

    // Adapter que simula fallo al eliminar el archivo físico
    class FailingDeleteAdapter extends NodeFileStorageAdapter {
      override async deleteFile(): Promise<boolean> {
        return false;
      }
    }
    const failingDeleteAdapter = new FailingDeleteAdapter();

    const firstRun = await importLegacyDrafts(patientA, db, failingDeleteAdapter, resolver);
    expect(firstRun.imported).toBe(1);
    expect(firstRun.pendingCleanups).toBe(1);

    // Estado quedó en limpieza_pendiente en SQLite
    const tracking = await db.first<{ estado: string }>(
      'SELECT estado FROM importacion_formularios_legacy WHERE paciente_id = ? AND archivo_relativo = ?',
      [patientA, 'form-esas-muestra_v1.0.json'],
    );
    expect(tracking?.estado).toBe('limpieza_pendiente');

    // Cola tiene exactamente 1 registro
    const queueBefore = await db.all(
      "SELECT * FROM cola_envio WHERE tipo_entidad = 'respuesta_formulario'",
    );
    expect(queueBefore).toHaveLength(1);

    // Segundo intento con adapter funcional
    const secondRun = await importLegacyDrafts(patientA, db, baseAdapter, resolver);
    expect(secondRun.cleaned).toBe(1);

    // Estado ahora es importado y archivo fue eliminado
    const trackingAfter = await db.first<{ estado: string }>(
      'SELECT estado FROM importacion_formularios_legacy WHERE paciente_id = ? AND archivo_relativo = ?',
      [patientA, 'form-esas-muestra_v1.0.json'],
    );
    expect(trackingAfter?.estado).toBe('importado');
    expect(await baseAdapter.exists(jsonPath)).toBe(false);

    // NO duplicó cola_envio ni respuesta_formulario
    const queueAfter = await db.all(
      "SELECT * FROM cola_envio WHERE tipo_entidad = 'respuesta_formulario'",
    );
    expect(queueAfter).toHaveLength(1);
    const submissions = await db.all('SELECT * FROM respuesta_formulario WHERE paciente_id = ?', [
      patientA,
    ]);
    expect(submissions).toHaveLength(1);
  });

  it('archivos con definición desconocida se conservan sin borrar en revision_requerida', async () => {
    const dir = createTempDir();
    const adapter = new NodeFileStorageAdapter();
    const resolver = () => dir;

    const db = createTestDb();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    const unknownContent: MedicalFormDraft = {
      formularioId: 'form-no-existente',
      version: '1.0',
      pacienteId: patientA,
      respuestas: { q1: 'test' },
      completado: false,
      guardadoEn: '2026-10-06T13:00:00Z',
    };
    const jsonPath = join(dir, 'form-no-existente_v1.0.json');
    writeFileSync(jsonPath, JSON.stringify(unknownContent, null, 2));

    const result = await importLegacyDrafts(patientA, db, adapter, resolver);
    expect(result.errors).toBe(1);

    // Registrado en revision_requerida
    const tracking = await db.first<{ estado: string }>(
      'SELECT estado FROM importacion_formularios_legacy WHERE paciente_id = ? AND archivo_relativo = ?',
      [patientA, 'form-no-existente_v1.0.json'],
    );
    expect(tracking?.estado).toBe('revision_requerida');

    // Archivo físico conservado intacto
    expect(await adapter.exists(jsonPath)).toBe(true);
  });

  it('no sobrescribe un borrador preexistente en SQLite', async () => {
    const dir = createTempDir();
    const adapter = new NodeFileStorageAdapter();
    const resolver = () => dir;

    const db = createTestDb();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    // Insertar previamente borrador en SQLite
    await db.run(
      `INSERT INTO borrador_formulario (
        paciente_id, formulario_id, version, periodo_clave, entrega_id, respuestas_json, guardado_en, version_payload
      ) VALUES (?, ?, ?, 'legacy', ?, ?, ?, 1)`,
      [
        patientA,
        'form-esas-muestra',
        '1.0',
        'existing-uuid-999',
        JSON.stringify({ esas_dolor: 9 }),
        '2026-10-06T14:00:00Z',
      ],
    );

    // Archivo legacy con respuesta diferente
    const legacyContent: MedicalFormDraft = {
      formularioId: 'form-esas-muestra',
      version: '1.0',
      pacienteId: patientA,
      respuestas: { esas_dolor: 1 },
      completado: false,
      guardadoEn: '2026-10-06T10:00:00Z',
    };
    const jsonPath = join(dir, 'form-esas-muestra_v1.0.json');
    writeFileSync(jsonPath, JSON.stringify(legacyContent, null, 2));

    const result = await importLegacyDrafts(patientA, db, adapter, resolver);

    // SQLite conserva { esas_dolor: 9 } sin ser sobrescrito por el legacy
    const draftInSql = await db.first<{ respuestas_json: string }>(
      'SELECT respuestas_json FROM borrador_formulario WHERE paciente_id = ? AND formulario_id = ?',
      [patientA, 'form-esas-muestra'],
    );
    expect(JSON.parse(draftInSql!.respuestas_json)).toEqual({ esas_dolor: 9 });

    // Corrección crítica: Como las respuestas difieren, el archivo físico se conserva y se registra en revision_requerida
    expect(await adapter.exists(jsonPath)).toBe(true);
    const tracking = await db.first<{ estado: string; ultimo_error: string }>(
      'SELECT estado, ultimo_error FROM importacion_formularios_legacy WHERE paciente_id = ? AND archivo_relativo = ?',
      [patientA, 'form-esas-muestra_v1.0.json'],
    );
    expect(tracking?.estado).toBe('revision_requerida');
    expect(tracking?.ultimo_error).toContain(
      'Conflicto: borrador existente en SQLite con respuestas diferentes',
    );
    expect(result.errors).toBe(1);
  });

  it('limpia archivo legacy si el borrador en SQLite tiene exactamente las mismas respuestas', async () => {
    const dir = createTempDir();
    const adapter = new NodeFileStorageAdapter();
    const resolver = () => dir;

    const db = createTestDb();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    // Insertar borrador en SQLite
    await db.run(
      `INSERT INTO borrador_formulario (
        paciente_id, formulario_id, version, periodo_clave, entrega_id, respuestas_json, guardado_en, version_payload
      ) VALUES (?, ?, ?, 'legacy', ?, ?, ?, 1)`,
      [
        patientA,
        'form-esas-muestra',
        '1.0',
        'uuid-mismo-contenido',
        JSON.stringify({ esas_dolor: 5, esas_fatiga: 2 }),
        '2026-10-06T14:00:00Z',
      ],
    );

    // Archivo legacy con las mismas respuestas
    const legacyContent: MedicalFormDraft = {
      formularioId: 'form-esas-muestra',
      version: '1.0',
      pacienteId: patientA,
      respuestas: { esas_fatiga: 2, esas_dolor: 5 },
      completado: false,
      guardadoEn: '2026-10-06T10:00:00Z',
    };
    const jsonPath = join(dir, 'form-esas-muestra_v1.0.json');
    writeFileSync(jsonPath, JSON.stringify(legacyContent, null, 2));

    const result = await importLegacyDrafts(patientA, db, adapter, resolver);
    expect(result.imported).toBe(1);
    expect(result.cleaned).toBe(1);

    // Archivo físico eliminado con éxito
    expect(await adapter.exists(jsonPath)).toBe(false);
    const tracking = await db.first<{ estado: string }>(
      'SELECT estado FROM importacion_formularios_legacy WHERE paciente_id = ? AND archivo_relativo = ?',
      [patientA, 'form-esas-muestra_v1.0.json'],
    );
    expect(tracking?.estado).toBe('importado');
  });

  it('computeSha256 calcula huellas criptográficas reales sin colisiones en cadenas distintas como Aa y BB', async () => {
    const hashAa = await computeSha256('Aa');
    const hashBb = await computeSha256('BB');

    expect(hashAa).toHaveLength(64);
    expect(hashBb).toHaveLength(64);
    // Un hash de 32 bits de tipo sdbm/djb2 colisionaba en Aa y BB; SHA-256 jamás colisiona
    expect(hashAa).not.toBe(hashBb);
  });

  it('en limpieza_pendiente no marca como importado si la lectura falla o el archivo sigue existiendo', async () => {
    const dir = createTempDir();
    const resolver = () => dir;
    const db = createTestDb();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    const jsonPath = join(dir, 'form-esas-muestra_v1.0.json');
    const content = JSON.stringify({
      formularioId: 'form-esas-muestra',
      version: '1.0',
      pacienteId: patientA,
      respuestas: { esas_dolor: 3 },
      completado: false,
      guardadoEn: '2026-10-06T10:00:00Z',
    });
    writeFileSync(jsonPath, content);
    const fileHash = await computeSha256(content);

    // Registrar previamente en limpieza_pendiente
    await db.run(
      `INSERT INTO importacion_formularios_legacy (
        paciente_id, archivo_relativo, huella_sha256, huella_bak_sha256,
        destino_tipo, destino_id, estado, fecha_importacion, ultimo_error
      ) VALUES (?, ?, ?, NULL, 'borrador', 'del-123', 'limpieza_pendiente', '2026-10-06T10:00:00Z', NULL)`,
      [patientA, 'form-esas-muestra_v1.0.json', fileHash],
    );

    // Adaptador cuya eliminación falla
    const baseAdapter = new NodeFileStorageAdapter();
    class FailingDeleteAdapter extends NodeFileStorageAdapter {
      override async deleteFile(): Promise<boolean> {
        return false; // Falla deliberadamente
      }
    }
    const failingAdapter = new FailingDeleteAdapter();

    const result = await importLegacyDrafts(patientA, db, failingAdapter, resolver);
    expect(result.cleaned).toBe(0);
    expect(result.pendingCleanups).toBe(1);

    // Debe permanecer en limpieza_pendiente y NO pasar a importado
    const tracking = await db.first<{ estado: string }>(
      'SELECT estado FROM importacion_formularios_legacy WHERE paciente_id = ? AND archivo_relativo = ?',
      [patientA, 'form-esas-muestra_v1.0.json'],
    );
    expect(tracking?.estado).toBe('limpieza_pendiente');
    expect(await baseAdapter.exists(jsonPath)).toBe(true);
  });

  it('rechaza entrega completada si las respuestas violan la validación médica y conserva el archivo en revision_requerida', async () => {
    const dir = createTempDir();
    const adapter = new NodeFileStorageAdapter();
    const resolver = () => dir;

    const db = createTestDb();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    // Cuestionario con completado: true pero respuestas vacías (falta pregunta requerida esas_dolor)
    const invalidCompleted: MedicalFormDraft = {
      formularioId: 'form-esas-muestra',
      version: '1.0',
      pacienteId: patientA,
      respuestas: {},
      completado: true,
      guardadoEn: '2026-10-06T10:00:00Z',
    };
    const jsonPath = join(dir, 'form-esas-muestra_v1.0.json');
    writeFileSync(jsonPath, JSON.stringify(invalidCompleted, null, 2));

    const result = await importLegacyDrafts(patientA, db, adapter, resolver);
    expect(result.errors).toBe(1);
    expect(result.imported).toBe(0);

    // NO se insertó en respuesta_formulario
    const submissions = await db.all('SELECT * FROM respuesta_formulario WHERE paciente_id = ?', [
      patientA,
    ]);
    expect(submissions).toHaveLength(0);

    // Archivo físico conservado
    expect(await adapter.exists(jsonPath)).toBe(true);

    const tracking = await db.first<{ estado: string; ultimo_error: string }>(
      'SELECT estado, ultimo_error FROM importacion_formularios_legacy WHERE paciente_id = ? AND archivo_relativo = ?',
      [patientA, 'form-esas-muestra_v1.0.json'],
    );
    expect(tracking?.estado).toBe('revision_requerida');
    expect(tracking?.ultimo_error).toContain('Entrega completada con respuestas inválidas');
  });

  it('adapter.directoryExists se invoca cuando está disponible para comprobar el directorio base', async () => {
    const dir = createTempDir();
    const resolver = () => dir;
    const db = createTestDb();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    let directoryExistsCalled = false;
    class CustomAdapter extends NodeFileStorageAdapter {
      override directoryExists(p: string): boolean {
        directoryExistsCalled = true;
        return super.directoryExists(p);
      }
    }
    const custom = new CustomAdapter();

    await importLegacyDrafts(patientA, db, custom, resolver);
    expect(directoryExistsCalled).toBe(true);
  });

  it('recoverOrphanDraftBackups y listPatientDrafts utilizan directoryExists y no fallan ante el contrato estricto del adaptador Expo', async () => {
    const dir = createTempDir();
    const patientDir = join(dir, 'formularios_locales', patientA, 'borradores');
    const resolver = () => patientDir;

    let dirExistsCalls = 0;
    class StrictContractAdapter extends NodeFileStorageAdapter {
      override directoryExists(p: string): boolean {
        dirExistsCalls++;
        return super.directoryExists(p);
      }
      override exists(p: string): boolean {
        // Simular el contrato estricto de ExpoFileStorageAdapter:
        // si la ruta es un directorio, llamar a exists() lanza una excepción
        if (existsSync(p) && statSync(p).isDirectory()) {
          throw new Error(`EISDIR: illegal operation on a directory, read '${p}'`);
        }
        return super.exists(p);
      }
    }

    const adapter = new StrictContractAdapter();
    await adapter.ensureDirectory(patientDir);

    // recoverOrphanDraftBackups no debe lanzar error de directorio
    const recovered = await recoverOrphanDraftBackups(patientDir, adapter);
    expect(recovered).toBe(0);
    expect(dirExistsCalls).toBeGreaterThanOrEqual(1);

    const prevCalls = dirExistsCalls;
    // listPatientDrafts no debe lanzar error de directorio
    const drafts = await listPatientDrafts(patientA, adapter, resolver);
    expect(drafts).toEqual([]);
    expect(dirExistsCalls).toBeGreaterThan(prevCalls);
  });

  it('garantiza aislamiento A/B en la importación legacy', async () => {
    const dirA = createTempDir();
    const dirB = createTempDir();
    const adapter = new NodeFileStorageAdapter();
    const resolver = (p: string) => (p === patientA ? dirA : dirB);

    const db = createTestDb();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    // Archivo de Paciente A en dirA
    const draftA: MedicalFormDraft = {
      formularioId: 'form-esas-muestra',
      version: '1.0',
      pacienteId: patientA,
      respuestas: { esas_dolor: 5 },
      completado: false,
      guardadoEn: '2026-10-06T10:00:00Z',
    };
    writeFileSync(join(dirA, 'form-esas-muestra_v1.0.json'), JSON.stringify(draftA, null, 2));

    // Ejecutar importación para Paciente B
    const resultB = await importLegacyDrafts(patientB, db, adapter, resolver);
    expect(resultB.imported).toBe(0);

    // Paciente B no tiene ningún borrador importado
    const draftB = await db.first('SELECT * FROM borrador_formulario WHERE paciente_id = ?', [
      patientB,
    ]);
    expect(draftB).toBeNull();
  });

  it('importLegacyDrafts pasa a revision_requerida si la huella cambia durante limpieza_pendiente y conserva el archivo', async () => {
    const dir = createTempDir();
    const adapter = new NodeFileStorageAdapter();
    const resolver = () => dir;

    const db = createTestDb();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    const jsonPath = join(dir, 'form-esas-muestra_v1.0.json');
    writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          formularioId: 'form-esas-muestra',
          version: '1.0',
          pacienteId: patientA,
          respuestas: { esas_dolor: 4 },
          completado: false,
          guardadoEn: '2026-10-06T10:00:00Z',
        },
        null,
        2,
      ),
    );

    // Simular que el commit previo registró el archivo en limpieza_pendiente con una huella previa
    await db.run(
      `INSERT INTO importacion_formularios_legacy (
        paciente_id, archivo_relativo, huella_sha256, huella_bak_sha256,
        destino_tipo, destino_id, estado, fecha_importacion, ultimo_error
      ) VALUES (?, ?, ?, NULL, 'borrador', 'form-esas-muestra', 'limpieza_pendiente', '2026-10-06T10:00:00Z', NULL)`,
      [patientA, 'form-esas-muestra_v1.0.json', 'sha256_antiguo_diferente'],
    );

    // Reintentar importación
    const result = await importLegacyDrafts(patientA, db, adapter, resolver);
    expect(result.errors).toBe(1);
    expect(result.pendingCleanups).toBe(0);

    // El estado pasó a revision_requerida con motivo registrado
    const record = await db.first<{ estado: string; ultimo_error: string }>(
      'SELECT estado, ultimo_error FROM importacion_formularios_legacy WHERE paciente_id = ? AND archivo_relativo = ?',
      [patientA, 'form-esas-muestra_v1.0.json'],
    );
    expect(record?.estado).toBe('revision_requerida');
    expect(record?.ultimo_error).toContain('huella modificada');

    // El archivo físico se conserva intacto
    expect(await adapter.exists(jsonPath)).toBe(true);
  });

  it('importLegacyDrafts retiene limpieza_pendiente si la huella coincide pero la eliminación física falla', async () => {
    const dir = createTempDir();
    const resolver = () => dir;

    const db = createTestDb();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    const jsonPath = join(dir, 'form-esas-muestra_v1.0.json');
    writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          formularioId: 'form-esas-muestra',
          version: '1.0',
          pacienteId: patientA,
          respuestas: { esas_dolor: 4 },
          completado: false,
          guardadoEn: '2026-10-06T10:00:00Z',
        },
        null,
        2,
      ),
    );

    class FailDeleteAdapter extends NodeFileStorageAdapter {
      override async deleteFile(): Promise<boolean> {
        return false; // Fallo temporal al borrar
      }
    }
    const failDeleteAdapter = new FailDeleteAdapter();

    // Primera ejecución: se inserta en SQLite y queda en limpieza_pendiente al fallar el borrado
    const result1 = await importLegacyDrafts(patientA, db, failDeleteAdapter, resolver);
    expect(result1.imported).toBe(1);
    expect(result1.pendingCleanups).toBe(1);

    const record1 = await db.first<{ estado: string }>(
      'SELECT estado FROM importacion_formularios_legacy WHERE paciente_id = ? AND archivo_relativo = ?',
      [patientA, 'form-esas-muestra_v1.0.json'],
    );
    expect(record1?.estado).toBe('limpieza_pendiente');

    // Segunda ejecución (reintento con misma huella): permanece en limpieza_pendiente
    const result2 = await importLegacyDrafts(patientA, db, failDeleteAdapter, resolver);
    expect(result2.pendingCleanups).toBe(1);
    expect(result2.errors).toBe(0);

    const record2 = await db.first<{ estado: string }>(
      'SELECT estado FROM importacion_formularios_legacy WHERE paciente_id = ? AND archivo_relativo = ?',
      [patientA, 'form-esas-muestra_v1.0.json'],
    );
    expect(record2?.estado).toBe('limpieza_pendiente');
    expect(await failDeleteAdapter.exists(jsonPath)).toBe(true);
  });

  it('mantiene revision_requerida en ejecuciones consecutivas sin duplicar respuestas ni cola tras cambio de contenido', async () => {
    const dir = createTempDir();
    const resolver = () => dir;

    const db = createTestDb();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    const jsonPath = join(dir, 'form-esas-muestra_v1.0.json');
    writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          formularioId: 'form-esas-muestra',
          version: '1.0',
          pacienteId: patientA,
          respuestas: { esas_dolor: 3, esas_fatiga: 2, esas_nauseas: 1 },
          completado: true,
          guardadoEn: '2026-10-06T10:00:00Z',
        },
        null,
        2,
      ),
    );

    class FailDeleteAdapter extends NodeFileStorageAdapter {
      override async deleteFile(): Promise<boolean> {
        return false; // Fallo al borrar el JSON
      }
    }
    const failDeleteAdapter = new FailDeleteAdapter();
    const normalAdapter = new NodeFileStorageAdapter();

    // Ejecución 1: Se importa la entrega completada. Falla la eliminación del JSON y queda en limpieza_pendiente.
    const result1 = await importLegacyDrafts(patientA, db, failDeleteAdapter, resolver);
    expect(result1.imported).toBe(1);
    expect(result1.pendingCleanups).toBe(1);

    const subs1 = await db.all<{ id: string }>(
      'SELECT * FROM respuesta_formulario WHERE paciente_id = ?',
      [patientA],
    );
    expect(subs1).toHaveLength(1);

    const queue1 = await db.all<{ id: string }>('SELECT * FROM cola_envio WHERE paciente_id = ?', [
      patientA,
    ]);
    expect(queue1).toHaveLength(1);

    // Modificar el contenido del archivo en disco tras el commit previo
    writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          formularioId: 'form-esas-muestra',
          version: '1.0',
          pacienteId: patientA,
          respuestas: { esas_dolor: 9, esas_fatiga: 8, esas_nauseas: 7 },
          completado: true,
          guardadoEn: '2026-10-06T11:00:00Z',
        },
        null,
        2,
      ),
    );

    // Ejecución 2: Detecta cambio de huella tras el commit, lo conserva y marca revision_requerida.
    const result2 = await importLegacyDrafts(patientA, db, normalAdapter, resolver);
    expect(result2.errors).toBe(1);
    expect(result2.imported).toBe(0);

    const record2 = await db.first<{ estado: string; ultimo_error: string }>(
      'SELECT estado, ultimo_error FROM importacion_formularios_legacy WHERE paciente_id = ? AND archivo_relativo = ?',
      [patientA, 'form-esas-muestra_v1.0.json'],
    );
    expect(record2?.estado).toBe('revision_requerida');
    expect(record2?.ultimo_error).toContain('huella modificada');
    expect(await normalAdapter.exists(jsonPath)).toBe(true);

    // Ejecución 3: Tercera ejecución consecutiva con adaptador normal donde deleteFile funcionaría.
    // La marca revision_requerida debe detener el procesamiento, conservando el archivo sin crear otra entrega.
    const result3 = await importLegacyDrafts(patientA, db, normalAdapter, resolver);
    expect(result3.errors).toBe(1);
    expect(result3.imported).toBe(0);

    // Comprobar que sigue existiendo exactamente una sola respuesta y una sola operación en cola
    const subsFinal = await db.all<{ id: string }>(
      'SELECT * FROM respuesta_formulario WHERE paciente_id = ?',
      [patientA],
    );
    expect(subsFinal).toHaveLength(1);
    expect(subsFinal[0].id).toBe(subs1[0].id);

    const queueFinal = await db.all<{ id: string }>(
      'SELECT * FROM cola_envio WHERE paciente_id = ?',
      [patientA],
    );
    expect(queueFinal).toHaveLength(1);
    expect(queueFinal[0].id).toBe(queue1[0].id);

    // El estado permanece en revision_requerida y el archivo físico continúa intacto
    const recordFinal = await db.first<{ estado: string }>(
      'SELECT estado FROM importacion_formularios_legacy WHERE paciente_id = ? AND archivo_relativo = ?',
      [patientA, 'form-esas-muestra_v1.0.json'],
    );
    expect(recordFinal?.estado).toBe('revision_requerida');
    expect(await normalAdapter.exists(jsonPath)).toBe(true);
  });

  it('importLegacyDrafts normaliza respuestas opcionales de entregas completadas antes de persistir y encolar', async () => {
    const dir = createTempDir();
    const adapter = new NodeFileStorageAdapter();
    const resolver = () => dir;

    const db = createTestDb();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    const jsonPath = join(dir, 'form-esas-muestra_v1.0.json');
    writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          formularioId: 'form-esas-muestra',
          version: '1.0',
          pacienteId: patientA,
          respuestas: {
            esas_dolor: 2,
            esas_fatiga: 1,
            esas_nauseas: 0,
            esas_notas: '   ',
            esas_sintomas_secundarios: [],
          },
          completado: true,
          guardadoEn: '2026-10-06T10:00:00Z',
        },
        null,
        2,
      ),
    );

    const result = await importLegacyDrafts(patientA, db, adapter, resolver);
    expect(result.imported).toBe(1);

    const sub = await db.first<{ respuestas_json: string }>(
      'SELECT respuestas_json FROM respuesta_formulario WHERE paciente_id = ?',
      [patientA],
    );
    expect(sub).not.toBeNull();
    const storedAnswers = JSON.parse(sub!.respuestas_json);
    expect(storedAnswers).toHaveProperty('esas_dolor', 2);
    expect(storedAnswers).toHaveProperty('esas_fatiga', 1);
    expect(storedAnswers).toHaveProperty('esas_nauseas', 0);
    // Respuestas opcionales vacías se normalizan como ausencia
    expect(storedAnswers).not.toHaveProperty('esas_notas');
    expect(storedAnswers).not.toHaveProperty('esas_sintomas_secundarios');

    const queue = await db.first<{ payload_json: string }>(
      'SELECT payload_json FROM cola_envio WHERE paciente_id = ?',
      [patientA],
    );
    expect(queue).not.toBeNull();
    const payload = JSON.parse(queue!.payload_json);
    expect(payload.record.respuestas).toEqual(storedAnswers);
  });

  it('importLegacyDrafts conserva borradores con claves ajenas en revision_requerida y permite borradores parciales válidos', async () => {
    const dir = createTempDir();
    const adapter = new NodeFileStorageAdapter();
    const resolver = () => dir;

    const db = createTestDb();
    await migrateDatabase(db);
    await seedPatientContextIfEmpty(db, patientA, patientB);

    // 1. Borrador con clave ajena a la definición (respuesta conocida + clave inexistente)
    const incompatibleDraft = {
      formularioId: 'form-esas-muestra',
      version: '1.0',
      pacienteId: patientA,
      respuestas: {
        esas_dolor: 4,
        clave_inexistente_en_definicion: 'valor_ajeno',
      },
      completado: false,
      guardadoEn: '2026-10-06T10:00:00Z',
    };
    const jsonPathIncompatible = join(dir, 'form-esas-muestra_v1.0.json');
    writeFileSync(jsonPathIncompatible, JSON.stringify(incompatibleDraft, null, 2));

    const resultIncompatible = await importLegacyDrafts(patientA, db, adapter, resolver);
    expect(resultIncompatible.errors).toBe(1);
    expect(resultIncompatible.imported).toBe(0);

    // El archivo físico debe conservarse en disco para evitar pérdida de datos
    expect(await adapter.exists(jsonPathIncompatible)).toBe(true);

    // No debe haberse insertado borrador incompleto con claves descartadas en borrador_formulario
    const draftInDb = await db.first(
      'SELECT * FROM borrador_formulario WHERE paciente_id = ? AND formulario_id = ?',
      [patientA, 'form-esas-muestra'],
    );
    expect(draftInDb).toBeNull();

    // Debe registrarse como revision_requerida con mensaje descriptivo
    const trackingIncompatible = await db.first<{ estado: string; ultimo_error: string }>(
      'SELECT estado, ultimo_error FROM importacion_formularios_legacy WHERE paciente_id = ? AND archivo_relativo = ?',
      [patientA, 'form-esas-muestra_v1.0.json'],
    );
    expect(trackingIncompatible?.estado).toBe('revision_requerida');
    expect(trackingIncompatible?.ultimo_error).toContain('clave_inexistente_en_definicion');

    // Comprobar persistencia ante ejecuciones posteriores: se sigue conservando el archivo
    const resultRetry = await importLegacyDrafts(patientA, db, adapter, resolver);
    expect(resultRetry.errors).toBe(1);
    expect(await adapter.exists(jsonPathIncompatible)).toBe(true);

    // Limpiar para probar el caso de borrador parcial válido
    rmSync(jsonPathIncompatible, { force: true });
    await db.run('DELETE FROM importacion_formularios_legacy WHERE paciente_id = ?', [patientA]);

    // 2. Borrador parcial válido: preguntas obligatorias (fatiga, nauseas) sin responder aún
    const validPartialDraft = {
      formularioId: 'form-esas-muestra',
      version: '1.0',
      pacienteId: patientA,
      respuestas: {
        esas_dolor: 3,
      },
      completado: false,
      guardadoEn: '2026-10-06T11:00:00Z',
    };
    const jsonPathPartial = join(dir, 'form-esas-muestra_v1.0.json');
    writeFileSync(jsonPathPartial, JSON.stringify(validPartialDraft, null, 2));

    const resultPartial = await importLegacyDrafts(patientA, db, adapter, resolver);
    expect(resultPartial.errors).toBe(0);
    expect(resultPartial.imported).toBe(1);

    // El borrador parcial se guardó correctamente en SQLite
    const savedDraft = await db.first<{ respuestas_json: string }>(
      'SELECT respuestas_json FROM borrador_formulario WHERE paciente_id = ? AND formulario_id = ?',
      [patientA, 'form-esas-muestra'],
    );
    expect(savedDraft).not.toBeNull();
    const parsedSaved = JSON.parse(savedDraft!.respuestas_json);
    expect(parsedSaved).toEqual({ esas_dolor: 3 });

    // El archivo legacy se eliminó tras la importación exitosa
    expect(await adapter.exists(jsonPathPartial)).toBe(false);

    // El seguimiento quedó en 'importado'
    const trackingPartial = await db.first<{ estado: string }>(
      'SELECT estado FROM importacion_formularios_legacy WHERE paciente_id = ? AND archivo_relativo = ?',
      [patientA, 'form-esas-muestra_v1.0.json'],
    );
    expect(trackingPartial?.estado).toBe('importado');
  });
});
