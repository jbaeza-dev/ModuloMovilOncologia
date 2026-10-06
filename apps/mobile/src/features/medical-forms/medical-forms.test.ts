import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { FileStorageAdapter } from '../../data/local/file-storage-adapter';
import { NodeFileStorageAdapter } from '../../data/local/node-file-storage-adapter';
import {
  deleteFormDraft,
  listPatientDrafts,
  loadFormDraft,
  saveFormDraft,
} from './form-draft-storage';
import { medicalFormsService } from './medical-form-service';
import type { MedicalFormDraft } from './medical-form-types';
import { validateFormAnswers } from './medical-form-validation';
import { SAMPLE_MEDICAL_FORMS } from './sample-medical-forms';

const patientA = '11111111-1111-4111-8111-111111111111';
const patientB = '22222222-2222-4222-8222-222222222222';
const temporaryDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'quimiocare-forms-test-'));
  temporaryDirs.push(dir);
  return dir;
}

afterEach(() => {
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
});
