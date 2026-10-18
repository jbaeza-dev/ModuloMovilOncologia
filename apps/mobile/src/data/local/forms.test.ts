import { afterEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from './migrations';
import { ingestMedicalFormBundle } from './forms/form-ingestion';
import { seedMedicalFormsDemo } from './forms/form-seed';
import { selectDailyFormAssignment } from './forms/form-repository';
import {
  ConflictoEntregaError,
  TipoPreguntaNoSoportadoError,
  VersionInmutableError,
} from './forms/form-types';
import { createPatientRepository, seedPatientContextIfEmpty } from './repository';
import { SAMPLE_MEDICAL_FORMS } from '../../features/medical-forms/sample-medical-forms';
import {
  SEGUIMIENTO_DOMICILIARIO_VERSION,
  SEGUIMIENTO_DOMICILIARIO_V1_0_0_BUNDLE_ITEM,
} from '../../features/medical-forms/fixtures/seguimiento-domiciliario';
import { createSqliteTestHarness, ids, patientA, patientB } from './testing/sqlite-test-harness';

const harness = createSqliteTestHarness();
const { open } = harness;

afterEach(() => {
  harness.cleanup();
});

describe('cuestionarios médicos de muestra y almacenamiento de borradores', () => {
  it('valida la estructura clínica de los cuestionarios de demostración', () => {
    expect(SAMPLE_MEDICAL_FORMS.length).toBeGreaterThanOrEqual(2);

    for (const form of SAMPLE_MEDICAL_FORMS) {
      expect(form.id).toBeTruthy();
      expect(form.titulo).toBeTruthy();
      expect(form.version).toBeTruthy();
      expect(form.duracionEstimadaMin).toBeGreaterThan(0);
      expect(form.preguntas.length).toBeGreaterThanOrEqual(3);

      for (const q of form.preguntas) {
        expect(['single_choice', 'multiple_choice', 'scale_0_10', 'text']).toContain(q.tipo);
        if (q.tipo === 'single_choice' || q.tipo === 'multiple_choice') {
          expect(q.opciones?.length).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });
});

describe('formularios y persistencia clínica en SQLite', () => {
  it('ingestMedicalFormBundle valida inmutabilidad y rechaza tipos de pregunta no soportados', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    // 1. Rechazo de tipo no soportado
    const invalidBundle = {
      formularios: [
        {
          formularioId: 'form-test',
          version: '1.0',
          titulo: 'Test Form',
          descripcion: 'Desc',
          duracionEstimadaMin: 2,
          preguntas: [
            {
              preguntaId: 'p1',
              texto: '¿Pregunta con tipo no soportado?',
              tipo: 'ranking_5_estrellas', // no soportado
              orden: 1,
            },
          ],
        },
      ],
      asignaciones: [],
    };

    await expect(ingestMedicalFormBundle(database, invalidBundle)).rejects.toThrow(
      TipoPreguntaNoSoportadoError,
    );

    // 2. Ingestión válida
    const validBundle = {
      formularios: [
        {
          formularioId: 'form-test',
          version: '1.0',
          titulo: 'Test Form',
          descripcion: 'Desc',
          duracionEstimadaMin: 2,
          preguntas: [
            {
              preguntaId: 'p1',
              texto: '¿Pregunta válida?',
              tipo: 'single_choice',
              orden: 1,
              requerida: true,
              configuracion: { opciones: [{ valor: 'si', etiqueta: 'Sí' }] },
            },
          ],
        },
      ],
      asignaciones: [
        {
          pacienteId: patientA,
          formularioId: 'form-test',
          version: '1.0',
          estado: 'activa' as const,
        },
      ],
    };

    await ingestMedicalFormBundle(database, validBundle);

    // 3. Idempotencia ante el mismo lote
    await expect(ingestMedicalFormBundle(database, validBundle)).resolves.not.toThrow();

    // 4. Conflicto de inmutabilidad si cambia el contenido bajo la misma versión
    const alteredBundle = {
      formularios: [
        {
          formularioId: 'form-test',
          version: '1.0',
          titulo: 'Test Form Modificado Ilegalmente',
          descripcion: 'Desc',
          duracionEstimadaMin: 2,
          preguntas: [
            {
              preguntaId: 'p1',
              texto: '¿Pregunta válida?',
              tipo: 'single_choice',
              orden: 1,
              requerida: true,
              configuracion: { opciones: [{ valor: 'si', etiqueta: 'Sí' }] },
            },
          ],
        },
      ],
      asignaciones: [],
    };

    await expect(ingestMedicalFormBundle(database, alteredBundle)).rejects.toThrow(
      VersionInmutableError,
    );
  });

  it('seedMedicalFormsDemo respeta asignaciones retiradas sin reactivarlas', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());
    const assignedBefore = await repoA.listAssignedForms();
    expect(assignedBefore.length).toBe(3);
    expect(assignedBefore.map((f) => f.formulario_id)).toContain('seguimiento-domiciliario');

    // Marcar manualmente la asignación de QLQ-C30 como retirada
    await database.run(
      `UPDATE formulario_asignacion_cache
       SET estado_conocido = 'retirada'
       WHERE paciente_id = ? AND formulario_id = 'form-qlq30-muestra'`,
      [patientA],
    );

    // Volver a ejecutar el seed de contexto
    await seedPatientContextIfEmpty(database, patientA, patientB);

    // Verificar que la asignación sigue estando en 'retirada'
    const statusRow = await database.first<{ estado_conocido: string }>(
      `SELECT estado_conocido FROM formulario_asignacion_cache
       WHERE paciente_id = ? AND formulario_id = 'form-qlq30-muestra'`,
      [patientA],
    );
    expect(statusRow?.estado_conocido).toBe('retirada');

    // listAssignedForms solo devuelve activas, por lo que QLQ-C30 no debe listarse
    const assignedAfter = await repoA.listAssignedForms();
    expect(assignedAfter.length).toBe(2);
    expect(assignedAfter.map((f) => f.formulario_id)).toContain('form-esas-muestra');
    expect(assignedAfter.map((f) => f.formulario_id)).toContain('seguimiento-domiciliario');
    expect(assignedAfter.map((f) => f.formulario_id)).not.toContain('form-qlq30-muestra');
  });

  it('evolución de plantillas: versión 2.0 coexiste con versión 1.0 histórica y sus entregas', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());

    // Entrega de versión 1.0
    await repoA.confirmSubmission(
      'form-esas-muestra',
      '1.0',
      { esas_dolor: 4, esas_fatiga: 5, esas_nauseas: 1 },
      'sub-v1-001',
    );

    // Ingestar versión 2.0 con nueva pregunta
    const v2Bundle = {
      formularios: [
        {
          formularioId: 'form-esas-muestra',
          version: '2.0',
          titulo: 'ESAS Actualizado (Versión 2.0)',
          descripcion: 'Nueva versión con escala de ansiedad.',
          duracionEstimadaMin: 3,
          preguntas: [
            {
              preguntaId: 'esas_dolor',
              texto: 'Nivel de dolor percibido:',
              tipo: 'scale_0_10' as const,
              orden: 1,
              requerida: true,
            },
            {
              preguntaId: 'esas_ansiedad',
              texto: 'Nivel de ansiedad:',
              tipo: 'scale_0_10' as const,
              orden: 2,
              requerida: true,
            },
          ],
        },
      ],
      asignaciones: [
        {
          pacienteId: patientA,
          formularioId: 'form-esas-muestra',
          version: '2.0',
          estado: 'activa' as const,
        },
      ],
    };

    await ingestMedicalFormBundle(database, v2Bundle);

    // Entrega de versión 2.0
    await repoA.confirmSubmission(
      'form-esas-muestra',
      '2.0',
      { esas_dolor: 3, esas_ansiedad: 7 },
      'sub-v2-001',
    );

    // Ambas entregas existen en el historial
    const history = await repoA.listSubmissions('form-esas-muestra');
    expect(history).toHaveLength(2);

    const subV1 = await repoA.getSubmission('sub-v1-001');
    expect(subV1?.version).toBe('1.0');
    expect(subV1?.respuestas.esas_fatiga).toBe(5);

    const subV2 = await repoA.getSubmission('sub-v2-001');
    expect(subV2?.version).toBe('2.0');
    expect(subV2?.respuestas.esas_ansiedad).toBe(7);
  });

  it('gestiona ciclo de vida de borradores y confirmación atómica en SQLite', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());

    // 1. Guardar borrador con deliveryId estable
    const stableDeliveryId = 'delivery-uuid-123';
    await repoA.saveDraft('form-esas-muestra', '1.0', { esas_dolor: 5 }, stableDeliveryId);

    const draft = await repoA.getDraft('form-esas-muestra', '1.0');
    expect(draft).toBeTruthy();
    expect(draft?.entregaId).toBe(stableDeliveryId);
    expect(draft?.respuestas).toEqual({ esas_dolor: 5 });

    // 2. Confirmación atómica
    const confirmedId = await repoA.confirmSubmission(
      'form-esas-muestra',
      '1.0',
      { esas_dolor: 5, esas_fatiga: 3, esas_nauseas: 0 },
      stableDeliveryId,
    );
    expect(confirmedId).toBe(stableDeliveryId);

    // Borrador consumido en SQLite
    const draftAfter = await repoA.getDraft('form-esas-muestra', '1.0');
    expect(draftAfter).toBeNull();

    // Entrega registrada en respuesta_formulario
    const sub = await repoA.getSubmission(stableDeliveryId);
    expect(sub).toBeTruthy();
    expect(sub?.id).toBe(stableDeliveryId);
    expect(sub?.respuestas.esas_dolor).toBe(5);

    // Operación en cola_envio
    const queueRow = await database.first<{
      id: string;
      tipo_entidad: string;
      registro_id: string;
      estado: string;
    }>('SELECT * FROM cola_envio WHERE registro_id = ?', [stableDeliveryId]);
    expect(queueRow).toBeTruthy();
    expect(queueRow?.tipo_entidad).toBe('respuesta_formulario');
    expect(queueRow?.estado).toBe('pendiente');

    // 3. Idempotencia ante confirmación repetida con mismos datos
    const reconfirmedId = await repoA.confirmSubmission(
      'form-esas-muestra',
      '1.0',
      { esas_dolor: 5, esas_fatiga: 3, esas_nauseas: 0 },
      stableDeliveryId,
    );
    expect(reconfirmedId).toBe(stableDeliveryId);

    const queueCount = await database.first<{ total: number }>(
      'SELECT count(*) AS total FROM cola_envio WHERE registro_id = ?',
      [stableDeliveryId],
    );
    expect(queueCount?.total).toBe(1);

    // 4. Conflicto explícito si se reusa deliveryId con respuestas diferentes
    await expect(
      repoA.confirmSubmission(
        'form-esas-muestra',
        '1.0',
        { esas_dolor: 9, esas_fatiga: 9, esas_nauseas: 9 },
        stableDeliveryId,
      ),
    ).rejects.toThrow(ConflictoEntregaError);
  });

  it('consumo condicional: confirmar entrega no elimina un borrador posterior con otro entrega_id', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());

    // Guardar borrador nuevo con otro entrega_id
    await repoA.saveDraft('form-esas-muestra', '1.0', { esas_dolor: 2 }, 'delivery-uuid-nuevo');

    // Confirmar entrega con deliveryId viejo
    await repoA.confirmSubmission(
      'form-esas-muestra',
      '1.0',
      { esas_dolor: 7, esas_fatiga: 7, esas_nauseas: 7 },
      'delivery-uuid-viejo',
    );

    // El borrador nuevo NO fue eliminado porque su entrega_id no coincide
    const draftStillExists = await repoA.getDraft('form-esas-muestra', '1.0');
    expect(draftStillExists).toBeTruthy();
    expect(draftStillExists?.entregaId).toBe('delivery-uuid-nuevo');
  });

  it('garantiza aislamiento A/B estricto de cuestionarios, borradores y entregas', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());
    const repoB = createPatientRepository(database, patientB, ids());

    // Paciente A tiene 3 cuestionarios; Paciente B tiene 2 (no tiene QLQ-C30)
    const formsA = await repoA.listAssignedForms();
    const formsB = await repoB.listAssignedForms();
    expect(formsA.map((f) => f.formulario_id).sort()).toEqual(
      ['form-esas-muestra', 'form-qlq30-muestra', 'seguimiento-domiciliario'].sort(),
    );
    expect(formsB.map((f) => f.formulario_id).sort()).toEqual(
      ['form-esas-muestra', 'seguimiento-domiciliario'].sort(),
    );

    // Paciente A guarda borrador y confirma entrega
    await repoA.saveDraft('form-qlq30-muestra', '1.0', { q1: 'nada' }, 'del-a-1');
    await repoA.confirmSubmission(
      'form-esas-muestra',
      '1.0',
      { esas_dolor: 1, esas_fatiga: 1, esas_nauseas: 1 },
      'sub-a-1',
    );

    // Paciente B no ve el borrador de A
    const draftB = await repoB.getDraft('form-qlq30-muestra', '1.0');
    expect(draftB).toBeNull();

    // Paciente B no lista la entrega de A en su historial
    const submissionsB = await repoB.listSubmissions();
    expect(submissionsB).toHaveLength(0);

    // Paciente B no puede acceder a la entrega de A ni pasando su UUID conocido
    const leakAttempt = await repoB.getSubmission('sub-a-1');
    expect(leakAttempt).toBeNull();
  });

  it('seed demo respeta asignaciones retiradas sin reactivarlas tras reinicio, pero lote explícito sí puede actualizar estado', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());

    // 1. Verificar estado inicial: paciente A tiene form-qlq30-muestra activo
    const initialForms = await repoA.listAssignedForms();
    expect(initialForms.map((f) => f.formulario_id)).toContain('form-qlq30-muestra');

    // 2. Retirar la asignación explícitamente
    await ingestMedicalFormBundle(database, {
      asignaciones: [
        {
          pacienteId: patientA,
          formularioId: 'form-qlq30-muestra',
          version: '1.0',
          estado: 'retirada',
        },
      ],
    });

    const formsAfterRetire = await repoA.listAssignedForms();
    expect(formsAfterRetire.map((f) => f.formulario_id)).not.toContain('form-qlq30-muestra');

    // 3. Simular reinicio / re-ejecución del seed demo
    await seedMedicalFormsDemo(database, patientA, patientB);

    // Debe permanecer retirada y no reactivarse por el seed
    const assignmentRow = await database.first<{ estado_conocido: string }>(
      `SELECT estado_conocido FROM formulario_asignacion_cache
       WHERE paciente_id = ? AND formulario_id = ? AND version = ?`,
      [patientA, 'form-qlq30-muestra', '1.0'],
    );
    expect(assignmentRow?.estado_conocido).toBe('retirada');

    const formsAfterSeed = await repoA.listAssignedForms();
    expect(formsAfterSeed.map((f) => f.formulario_id)).not.toContain('form-qlq30-muestra');

    // 4. Incorporación explícita mediante lote sí puede reactivarla
    await ingestMedicalFormBundle(database, {
      asignaciones: [
        {
          pacienteId: patientA,
          formularioId: 'form-qlq30-muestra',
          version: '1.0',
          estado: 'activa',
        },
      ],
    });

    const formsReactivated = await repoA.listAssignedForms();
    expect(formsReactivated.map((f) => f.formulario_id)).toContain('form-qlq30-muestra');
  });

  it('saveDraft rechaza guardar borrador de un cuestionario no asignado activamente al paciente', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoB = createPatientRepository(database, patientB, ids());
    // Paciente B solo tiene asignado form-esas-muestra, no form-qlq30-muestra
    await expect(
      repoB.saveDraft('form-qlq30-muestra', '1.0', { q1: 'nada' }, 'delivery-uuid-x'),
    ).rejects.toThrow('No existe una asignación activa para este cuestionario.');
  });

  it('saveDraft rechaza guardar borrador con respuestas ajenas a la definición del cuestionario', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());
    await expect(
      repoA.saveDraft(
        'form-esas-muestra',
        '1.0',
        { esas_dolor: 4, clave_fantasma: 'invalido' },
        'delivery-uuid-x',
      ),
    ).rejects.toThrow(
      "La clave 'clave_fantasma' no pertenece a la definición de este cuestionario.",
    );
  });

  it('confirmSubmission aplica validación médica: rechaza valores fuera de rango y opciones excluyentes combinadas', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());

    // 1. Rechaza escala fuera de rango (ej. 99 en escala 0 a 10)
    await expect(
      repoA.confirmSubmission(
        'form-esas-muestra',
        '1.0',
        { esas_dolor: 99, esas_fatiga: 2, esas_nauseas: 0 },
        'del-invalid-scale',
      ),
    ).rejects.toThrow('El valor debe encontrarse entre 0 y 10.');

    // 2. Rechaza combinación de opciones excluyentes ('ninguna' con otra)
    await expect(
      repoA.confirmSubmission(
        'form-esas-muestra',
        '1.0',
        {
          esas_dolor: 2,
          esas_fatiga: 2,
          esas_nauseas: 0,
          esas_sintomas_secundarios: ['ninguna', 'mareos'],
        },
        'del-invalid-excl',
      ),
    ).rejects.toThrow('no puede combinarse con otras opciones');
  });

  it('listAssignedForms desempata determinísticamente sin duplicar tarjetas cuando dos entregas comparten la misma fecha', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const sameTimestamp = '2026-10-08T12:00:00.000Z';
    // Insertar dos entregas con el mismo timestamp para el mismo cuestionario
    await database.run(
      `INSERT INTO respuesta_formulario (
        id, paciente_id, formulario_id, version, respuestas_json, fecha_confirmacion, creado_localmente_en
      ) VALUES
        ('sub-tie-1', ?, 'form-esas-muestra', '1.0', '{}', ?, ?),
        ('sub-tie-2', ?, 'form-esas-muestra', '1.0', '{}', ?, ?)`,
      [patientA, sameTimestamp, sameTimestamp, patientA, sameTimestamp, sameTimestamp],
    );

    const repoA = createPatientRepository(database, patientA, ids());
    const assigned = await repoA.listAssignedForms();

    // No debe haber duplicación de la tarjeta del formulario
    const esasCards = assigned.filter((f) => f.formulario_id === 'form-esas-muestra');
    expect(esasCards).toHaveLength(1);
    // El desempate por id DESC seleccionó deterministicamente sub-tie-2
    expect(esasCards[0].ultima_entrega_id).toBe('sub-tie-2');
  });

  it('listSubmissions soporta paginación con limit y offset', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    // Insertar 35 entregas para el paciente A
    for (let i = 1; i <= 35; i++) {
      const pad = String(i).padStart(3, '0');
      const timestamp = `2026-10-01T10:00:${String(i % 60).padStart(2, '0')}.000Z`;
      await database.run(
        `INSERT INTO respuesta_formulario (
          id, paciente_id, formulario_id, version, respuestas_json, fecha_confirmacion, creado_localmente_en
        ) VALUES (?, ?, 'form-esas-muestra', '1.0', '{}', ?, ?)`,
        [`sub-page-${pad}`, patientA, timestamp, timestamp],
      );
    }

    const repoA = createPatientRepository(database, patientA, ids());
    const firstPage = await repoA.listSubmissions(undefined, 30, 0);
    expect(firstPage).toHaveLength(30);

    const secondPage = await repoA.listSubmissions(undefined, 30, 30);
    expect(secondPage).toHaveLength(5);
  });

  it('confirmSubmission rechaza claves ajenas a la definición y tipos inválidos en opcionales sin encolar ni guardar', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());

    // 1. Clave ajena a la definición (ej: pregunta_ajena: 42)
    await expect(
      repoA.confirmSubmission(
        'form-esas-muestra',
        '1.0',
        {
          esas_dolor: 2,
          esas_fatiga: 1,
          esas_nauseas: 0,
          pregunta_ajena: 42,
        },
        'del-alien-key',
      ),
    ).rejects.toThrow(
      "La clave 'pregunta_ajena' no pertenece a la definición de este cuestionario.",
    );

    // Verificar que nada se haya guardado ni encolado
    const alienSubmissions = await database.all('SELECT * FROM respuesta_formulario WHERE id = ?', [
      'del-alien-key',
    ]);
    expect(alienSubmissions).toHaveLength(0);

    const alienQueue = await database.all('SELECT * FROM cola_envio WHERE registro_id = ?', [
      'del-alien-key',
    ]);
    expect(alienQueue).toHaveLength(0);

    // 2. Cadena de espacios en pregunta opcional de selección múltiple (tipo incorrecto)
    await expect(
      repoA.confirmSubmission(
        'form-esas-muestra',
        '1.0',
        {
          esas_dolor: 2,
          esas_fatiga: 1,
          esas_nauseas: 0,
          esas_sintomas_secundarios: '   ' as unknown as string[],
        },
        'del-invalid-opt-type',
      ),
    ).rejects.toThrow('El valor debe ser una lista de opciones.');
  });

  it('confirmSubmission normaliza respuestas opcionales vacías como ausencia antes de persistir y encolar', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());

    const deliveryId = 'del-norm-answers';
    await repoA.confirmSubmission(
      'form-esas-muestra',
      '1.0',
      {
        esas_dolor: 3,
        esas_fatiga: 2,
        esas_nauseas: 1,
        esas_notas: '   ',
        esas_sintomas_secundarios: [],
      },
      deliveryId,
    );

    const sub = await database.first<{ respuestas_json: string }>(
      'SELECT respuestas_json FROM respuesta_formulario WHERE id = ?',
      [deliveryId],
    );
    expect(sub).not.toBeNull();
    const storedAnswers = JSON.parse(sub!.respuestas_json);
    expect(storedAnswers).toHaveProperty('esas_dolor', 3);
    expect(storedAnswers).toHaveProperty('esas_fatiga', 2);
    expect(storedAnswers).toHaveProperty('esas_nauseas', 1);
    // Respuestas opcionales vacías se normalizan como ausencia
    expect(storedAnswers).not.toHaveProperty('esas_notas');
    expect(storedAnswers).not.toHaveProperty('esas_sintomas_secundarios');

    // Cola de envío también tiene las respuestas normalizadas
    const queue = await database.first<{ payload_json: string }>(
      'SELECT payload_json FROM cola_envio WHERE registro_id = ?',
      [deliveryId],
    );
    expect(queue).not.toBeNull();
    const payload = JSON.parse(queue!.payload_json);
    expect(payload.record.respuestas).toEqual(storedAnswers);
  });

  it('gestiona ciclo de vida diario: persiste sin recalcular metadatos temporales al continuar y limpia borrador', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());

    // 1. Estado inicial del día: sin entrega ni borrador
    const statusBefore = await repoA.getDailyFormStatus('form-esas-muestra', '2026-10-18');
    expect(statusBefore.hasSubmittedToday).toBe(false);
    expect(statusBefore.hasActiveDraft).toBe(false);
    expect(statusBefore.hasOlderDraft).toBe(false);

    // 2. Crear borrador diario para 2026-10-18 con fecha fija
    const draft1 = await repoA.getOrCreateDailyDraft('form-esas-muestra', '1.0', {
      fechaSeguimiento: '2026-10-18',
      periodoClave: 'dia:2026-10-18',
      zonaHoraria: 'America/Santiago',
      iniciadoEn: '2026-10-18T10:00:00.000Z',
      ventanaDesde: '2026-10-17T10:00:00.000Z',
      ventanaHasta: '2026-10-18T10:00:00.000Z',
    });

    expect(draft1.periodoClave).toBe('dia:2026-10-18');
    expect(draft1.iniciadoEn).toBe('2026-10-18T10:00:00.000Z');
    expect(draft1.ventanaDesde).toBe('2026-10-17T10:00:00.000Z');

    // 3. Guardar avance parcial y sección
    await repoA.saveDailyDraft(
      { formId: 'form-esas-muestra', version: '1.0', periodoClave: 'dia:2026-10-18' },
      { esas_dolor: 4 },
      'sec-dolor',
    );

    // 4. Reabrir el borrador (incluso simulando que transcurrieron horas o días):
    // CRÍTICO: los metadatos temporales (iniciadoEn, ventanaDesde, ventanaHasta, pasoActual)
    // NO DEBEN recalcularse.
    const draft2 = await repoA.getOrCreateDailyDraft('form-esas-muestra', '1.0', {
      fechaSeguimiento: '2026-10-18',
      periodoClave: 'dia:2026-10-18',
      zonaHoraria: 'America/Santiago',
      iniciadoEn: '2026-10-19T99:99:99.999Z', // Contexto nuevo con fecha distinta que NO debe sobreescribir
      ventanaDesde: '2026-10-19T00:00:00.000Z',
      ventanaHasta: '2026-10-19T23:59:59.000Z',
    });

    expect(draft2.entregaId).toBe(draft1.entregaId);
    expect(draft2.iniciadoEn).toBe('2026-10-18T10:00:00.000Z'); // conserva original
    expect(draft2.ventanaDesde).toBe('2026-10-17T10:00:00.000Z'); // conserva original
    expect(draft2.pasoActual).toBe('sec-dolor'); // conserva sección
    expect(draft2.respuestas).toEqual({ esas_dolor: 4 });

    // 5. Confirmar entrega diaria
    const deliveryId = await repoA.confirmDailySubmission(
      {
        formId: 'form-esas-muestra',
        version: '1.0',
        periodoClave: 'dia:2026-10-18',
        deliveryId: draft1.entregaId,
      },
      { esas_dolor: 4, esas_fatiga: 2, esas_nauseas: 0 },
    );

    expect(deliveryId).toBe(draft1.entregaId);

    // 6. Verificar que el borrador fue eliminado de SQLite
    const draftAfterConfirm = await database.first(
      'SELECT * FROM borrador_formulario WHERE paciente_id = ? AND periodo_clave = ?',
      [patientA, 'dia:2026-10-18'],
    );
    expect(draftAfterConfirm).toBeNull();

    // 7. Verificar que respuesta_formulario contiene los metadatos temporales heredados del borrador
    const storedSubmission = await database.first<{
      id: string;
      fecha_seguimiento: string;
      zona_horaria: string;
      iniciado_en: string;
      ventana_desde: string;
      ventana_hasta: string;
    }>('SELECT * FROM respuesta_formulario WHERE id = ?', [deliveryId]);

    expect(storedSubmission).not.toBeNull();
    expect(storedSubmission?.fecha_seguimiento).toBe('2026-10-18');
    expect(storedSubmission?.zona_horaria).toBe('America/Santiago');
    expect(storedSubmission?.iniciado_en).toBe('2026-10-18T10:00:00.000Z');
    expect(storedSubmission?.ventana_desde).toBe('2026-10-17T10:00:00.000Z');

    // 8. Estado del día después de confirmar
    const statusAfter = await repoA.getDailyFormStatus('form-esas-muestra', '2026-10-18');
    expect(statusAfter.hasSubmittedToday).toBe(true);
    expect(statusAfter.hasActiveDraft).toBe(false);
  });

  it('listAssignedForms no duplica filas cuando coexisten borrador diario y borrador legacy', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());

    // Crear borrador legacy
    await repoA.saveDraft('form-esas-muestra', '1.0', { esas_dolor: 1 }, 'del-legacy-1', 'legacy');

    // Crear borrador diario
    await repoA.getOrCreateDailyDraft('form-esas-muestra', '1.0', {
      fechaSeguimiento: '2026-10-18',
      periodoClave: 'dia:2026-10-18',
      zonaHoraria: 'America/Santiago',
      iniciadoEn: '2026-10-18T12:00:00.000Z',
      ventanaDesde: '2026-10-17T12:00:00.000Z',
      ventanaHasta: '2026-10-18T12:00:00.000Z',
    });

    // listAssignedForms sin duplicación
    const assigned = await repoA.listAssignedForms('dia:2026-10-18');
    const esasList = assigned.filter((f) => f.formulario_id === 'form-esas-muestra');
    expect(esasList).toHaveLength(1);
    expect(esasList[0].borrador_periodo_clave).toBe('dia:2026-10-18');
  });

  it('getOrCreateDailyDraft es atómico y seguro ante concurrencia sin violaciones de clave', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());

    // Ejecución paralela masiva
    const [d1, d2, d3] = await Promise.all([
      repoA.getOrCreateDailyDraft('form-esas-muestra', '1.0', {
        fechaSeguimiento: '2026-10-18',
        periodoClave: 'dia:2026-10-18',
        zonaHoraria: 'America/Santiago',
        iniciadoEn: '2026-10-18T12:00:00.000Z',
        ventanaDesde: '2026-10-17T12:00:00.000Z',
        ventanaHasta: '2026-10-18T12:00:00.000Z',
      }),
      repoA.getOrCreateDailyDraft('form-esas-muestra', '1.0', {
        fechaSeguimiento: '2026-10-18',
        periodoClave: 'dia:2026-10-18',
        zonaHoraria: 'America/Santiago',
        iniciadoEn: '2026-10-18T12:00:00.000Z',
        ventanaDesde: '2026-10-17T12:00:00.000Z',
        ventanaHasta: '2026-10-18T12:00:00.000Z',
      }),
      repoA.getOrCreateDailyDraft('form-esas-muestra', '1.0', {
        fechaSeguimiento: '2026-10-18',
        periodoClave: 'dia:2026-10-18',
        zonaHoraria: 'America/Santiago',
        iniciadoEn: '2026-10-18T12:00:00.000Z',
        ventanaDesde: '2026-10-17T12:00:00.000Z',
        ventanaHasta: '2026-10-18T12:00:00.000Z',
      }),
    ]);

    expect(d1.entregaId).toBe(d2.entregaId);
    expect(d2.entregaId).toBe(d3.entregaId);
    expect(d1.periodoClave).toBe('dia:2026-10-18');
  });

  it('confirmDailySubmission exige borrador correspondiente y rechaza deliveryId no coincidente', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());

    const draft = await repoA.getOrCreateDailyDraft('form-esas-muestra', '1.0', {
      fechaSeguimiento: '2026-10-18',
      periodoClave: 'dia:2026-10-18',
      zonaHoraria: 'America/Santiago',
      iniciadoEn: '2026-10-18T12:00:00.000Z',
      ventanaDesde: '2026-10-17T12:00:00.000Z',
      ventanaHasta: '2026-10-18T12:00:00.000Z',
    });

    // Rechaza si deliveryId difiere del borrador
    await expect(
      repoA.confirmDailySubmission(
        {
          formId: 'form-esas-muestra',
          version: '1.0',
          periodoClave: 'dia:2026-10-18',
          deliveryId: 'del-otro-id',
        },
        { esas_dolor: 1, esas_fatiga: 1, esas_nauseas: 1 },
      ),
    ).rejects.toThrow(ConflictoEntregaError);

    // Rechaza si no existe borrador para ese periodo
    await expect(
      repoA.confirmDailySubmission(
        {
          formId: 'form-esas-muestra',
          version: '1.0',
          periodoClave: 'dia:2026-10-19',
          deliveryId: draft.entregaId,
        },
        { esas_dolor: 1, esas_fatiga: 1, esas_nauseas: 1 },
      ),
    ).rejects.toThrow('No existe un borrador activo');
  });

  it('confirmDailySubmission y confirmSubmission filtran respuestas a preguntas ocultas por condiciones dinámicas', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());

    const draft = await repoA.getOrCreateDailyDraft(
      'seguimiento-domiciliario',
      SEGUIMIENTO_DOMICILIARIO_VERSION,
      {
        fechaSeguimiento: '2026-10-18',
        periodoClave: 'dia:2026-10-18',
        zonaHoraria: 'America/Santiago',
        iniciadoEn: '2026-10-18T12:00:00.000Z',
        ventanaDesde: '2026-10-17T12:00:00.000Z',
        ventanaHasta: '2026-10-18T12:00:00.000Z',
      },
    );

    // P1 está en 'no', por lo que P1.1 (síntomas de fiebre) está OCULTA.
    // Si answers contiene P1.1 con un valor, este debe filtrarse antes de persistir.
    const answersWithHidden: Record<string, string> = {
      'P0.1': 'no',
      P1: 'no',
      'P1.1': 'calor_decaimiento', // Oculta
      P2: 'no',
      'P3.A': 'no',
      'P3.B': 'no',
      P4: 'no',
      P5: 'no',
      P6: 'no',
      P7: 'no',
      P8: 'no',
      'P9.A': 'no',
      'P9.B': 'no',
    };

    const confirmedId = await repoA.confirmDailySubmission(
      {
        formId: 'seguimiento-domiciliario',
        version: SEGUIMIENTO_DOMICILIARIO_VERSION,
        periodoClave: 'dia:2026-10-18',
        deliveryId: draft.entregaId,
      },
      answersWithHidden,
    );

    const sub = await repoA.getSubmission(confirmedId);
    expect(sub?.respuestas).toHaveProperty('P1', 'no');
    // P1.1 no debe existir en las respuestas persistidas
    expect('P1.1' in (sub?.respuestas ?? {})).toBe(false);
    expect(sub?.respuestas).not.toHaveProperty(['P1.1']);
  });

  it('getDailyFormStatus resuelve fecha civil en zona horaria local sin fallos por prefijo UTC', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());

    // Insertar fila histórica sin fecha_seguimiento, confirmada a las 22:00 CLT (01:00 UTC del día siguiente)
    // 2026-10-18T22:00:00-03:00 = 2026-10-19T01:00:00.000Z
    const historicalUtcTimestamp = '2026-10-19T01:00:00.000Z';
    await database.run(
      `INSERT INTO respuesta_formulario (
        id, paciente_id, formulario_id, version, respuestas_json, fecha_confirmacion, creado_localmente_en,
        fecha_seguimiento, zona_horaria
      ) VALUES (?, ?, 'form-esas-muestra', '1.0', '{}', ?, ?, NULL, NULL)`,
      ['del-hist-utc', patientA, historicalUtcTimestamp, historicalUtcTimestamp],
    );

    // En hora civil de America/Santiago, 2026-10-19T01:00:00.000Z es el día 2026-10-18
    const status = await repoA.getDailyFormStatus('form-esas-muestra', '2026-10-18');
    expect(status.hasSubmittedToday).toBe(true);
    expect(status.lastSubmission?.id).toBe('del-hist-utc');

    // Y para el día 2026-10-19 civil, no debe reportar como entregado
    const statusNext = await repoA.getDailyFormStatus('form-esas-muestra', '2026-10-19');
    expect(statusNext.hasSubmittedToday).toBe(false);
  });

  it('listAssignedForms prioriza cuestionarios con periodicidad daily y selectDailyFormAssignment elige seguimiento-domiciliario sobre QLQ-C30', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);
    await seedMedicalFormsDemo(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());
    const assigned = await repoA.listAssignedForms();

    expect(assigned.length).toBeGreaterThanOrEqual(3);
    // El primero debe ser 'seguimiento-domiciliario' por periodicidad daily
    expect(assigned[0].formulario_id).toBe('seguimiento-domiciliario');
    expect(assigned[0].periodicidad).toBe('daily');

    // selectDailyFormAssignment debe resolver directamente a seguimiento-domiciliario
    const selected = selectDailyFormAssignment(assigned);
    expect(selected?.formulario_id).toBe('seguimiento-domiciliario');
  });

  it('getOrCreateDailyDraft con periodoClave = legacy recupera el borrador legacy preexistente con sus respuestas y entregaId', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);
    await seedMedicalFormsDemo(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());

    // Insertar un borrador con periodo_clave = 'legacy'
    await database.run(
      `INSERT INTO borrador_formulario (
        paciente_id, formulario_id, version, periodo_clave,
        entrega_id, respuestas_json, guardado_en, version_payload, paso_actual
      ) VALUES (?, 'seguimiento-domiciliario', '1.0.0', 'legacy', 'del-legacy-123', '{"P0.1":"si"}', '2026-10-18T10:00:00Z', 1, 'sec-modulo-0')`,
      [patientA],
    );

    const legacyDraft = await repoA.getOrCreateDailyDraft(
      'seguimiento-domiciliario',
      '1.0.0',
      'legacy',
    );

    expect(legacyDraft.entregaId).toBe('del-legacy-123');
    expect(legacyDraft.periodoClave).toBe('legacy');
    expect(legacyDraft.respuestas).toEqual({ 'P0.1': 'si' });
    expect(legacyDraft.pasoActual).toBe('sec-modulo-0');
  });

  it('getDailyFormStatus detecta la entrega de hoy aunque existan 10 o más entregas de otros días en el historial', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);
    await seedMedicalFormsDemo(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());
    const today = '2026-10-18';

    // Insertar 1 entrega para hoy
    await database.run(
      `INSERT INTO respuesta_formulario (
        id, paciente_id, formulario_id, version, respuestas_json, fecha_confirmacion, creado_localmente_en,
        fecha_seguimiento, zona_horaria
      ) VALUES (?, ?, 'seguimiento-domiciliario', '1.0.0', '{}', '2026-10-18T12:00:00Z', '2026-10-18T12:00:00Z', ?, 'America/Santiago')`,
      ['del-today-1', patientA, today],
    );

    // Insertar 12 entregas para otros días posteriores que quedarían antes en un ORDER BY DESC
    for (let i = 19; i <= 30; i++) {
      const otherDay = `2026-10-${i}`;
      await database.run(
        `INSERT INTO respuesta_formulario (
          id, paciente_id, formulario_id, version, respuestas_json, fecha_confirmacion, creado_localmente_en,
          fecha_seguimiento, zona_horaria
        ) VALUES (?, ?, 'seguimiento-domiciliario', '1.0.0', '{}', ?, ?, ?, 'America/Santiago')`,
        [`del-future-${i}`, patientA, `${otherDay}T12:00:00Z`, `${otherDay}T12:00:00Z`, otherDay],
      );
    }

    // getDailyFormStatus para today debe encontrar 'del-today-1' sin ser desplazado por el límite
    const status = await repoA.getDailyFormStatus('seguimiento-domiciliario', today);
    expect(status.hasSubmittedToday).toBe(true);
    expect(status.lastSubmission?.id).toBe('del-today-1');
  });

  it('confirmDailySubmission es idempotente ante reintentos con respuestas normalizadas (espacios en blanco, preguntas ocultas)', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);
    await seedMedicalFormsDemo(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());

    const draft = await repoA.getOrCreateDailyDraft(
      'seguimiento-domiciliario',
      SEGUIMIENTO_DOMICILIARIO_VERSION,
      {
        fechaSeguimiento: '2026-10-18',
        periodoClave: 'dia:2026-10-18',
        zonaHoraria: 'America/Santiago',
        iniciadoEn: '2026-10-18T10:00:00.000Z',
        ventanaDesde: '2026-10-17T10:00:00.000Z',
        ventanaHasta: '2026-10-18T10:00:00.000Z',
      },
    );

    const answersFirst = {
      'P0.1': 'no',
      P1: 'no',
      P2: 'no',
      'P3.A': 'no',
      'P3.B': 'no',
      P4: 'no',
      P5: 'no',
      P6: 'no',
      P7: 'no',
      P8: 'no',
      'P9.A': 'no',
      'P9.B': 'no',
      P10: '  Todo tranquilo hoy  ',
    };

    const firstResult = await repoA.confirmDailySubmission(
      {
        formId: 'seguimiento-domiciliario',
        version: SEGUIMIENTO_DOMICILIARIO_VERSION,
        periodoClave: 'dia:2026-10-18',
        deliveryId: draft.entregaId,
      },
      answersFirst,
    );

    expect(firstResult).toBe(draft.entregaId);

    // Reintento: texto sin espacios adicionales o con P1.1 (oculta) añadida accidentalmente
    const answersRetry = {
      'P0.1': 'no',
      P1: 'no',
      'P1.1': 'calor_decaimiento', // oculta por P1=no
      P2: 'no',
      'P3.A': 'no',
      'P3.B': 'no',
      P4: 'no',
      P5: 'no',
      P6: 'no',
      P7: 'no',
      P8: 'no',
      'P9.A': 'no',
      'P9.B': 'no',
      P10: 'Todo tranquilo hoy',
    };

    // No debe lanzar ConflictoEntregaError, debe retornar id idempotentemente
    const retryResult = await repoA.confirmDailySubmission(
      {
        formId: 'seguimiento-domiciliario',
        version: SEGUIMIENTO_DOMICILIARIO_VERSION,
        periodoClave: 'dia:2026-10-18',
        deliveryId: draft.entregaId,
      },
      answersRetry,
    );

    expect(retryResult).toBe(draft.entregaId);
  });

  it('migración y upgrade: una base con 1.0.0 se actualiza a 1.1.0 sin VersionInmutableError, retira asignación 1.0.0 y preserva entregas históricas', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    // Simular estado previo: paciente tiene asignación activa de 1.0.0
    await ingestMedicalFormBundle(database, {
      formularios: [SEGUIMIENTO_DOMICILIARIO_V1_0_0_BUNDLE_ITEM],
      asignaciones: [
        {
          pacienteId: patientA,
          formularioId: 'seguimiento-domiciliario',
          version: '1.0.0',
          estado: 'activa',
        },
      ],
    });

    const repoA = createPatientRepository(database, patientA, ids());

    // Entrega histórica en 1.0.0
    const historicalAnswers = {
      'P0.1': 'no',
      P1: 'no',
      P2: 'no',
      'P3.A': 'no',
      'P3.B': 'no',
      P4: 'no',
      P5: 'no',
      P6: 'no',
      P7: 'no',
      P8: 'no',
      'P9.A': 'no',
      'P9.B': 'no',
      P10: 'Reporte en v1.0.0',
    };
    await repoA.confirmSubmission(
      'seguimiento-domiciliario',
      '1.0.0',
      historicalAnswers,
      'sub-v1-hist',
    );

    // Ejecutar seedMedicalFormsDemo (debe promover a 1.1.0 de forma idempotente y sin error)
    await expect(seedMedicalFormsDemo(database, patientA, patientB)).resolves.not.toThrow();

    // Comprobar estado de asignaciones
    const assignV1 = await database.first<{ estado_conocido: string }>(
      'SELECT estado_conocido FROM formulario_asignacion_cache WHERE paciente_id = ? AND formulario_id = ? AND version = ?',
      [patientA, 'seguimiento-domiciliario', '1.0.0'],
    );
    expect(assignV1?.estado_conocido).toBe('retirada');

    const assignV11 = await database.first<{ estado_conocido: string }>(
      'SELECT estado_conocido FROM formulario_asignacion_cache WHERE paciente_id = ? AND formulario_id = ? AND version = ?',
      [patientA, 'seguimiento-domiciliario', '1.1.0'],
    );
    expect(assignV11?.estado_conocido).toBe('activa');

    // La entrega histórica 1.0.0 se recupera intacta
    const pastSub = await repoA.getSubmission('sub-v1-hist');
    expect(pastSub).toBeTruthy();
    expect(pastSub?.version).toBe('1.0.0');
    expect(pastSub?.respuestas.P10).toBe('Reporte en v1.0.0');

    // La definición 1.0.0 sigue existiendo en el caché
    const defV1 = await repoA.getFormDefinition('seguimiento-domiciliario', '1.0.0');
    expect(defV1).toBeTruthy();
    expect(defV1?.version).toBe('1.0.0');

    // La definición 1.1.0 existe y tiene las 41 preguntas actualizadas
    const defV11 = await repoA.getFormDefinition('seguimiento-domiciliario', '1.1.0');
    expect(defV11).toBeTruthy();
    expect(defV11?.version).toBe('1.1.0');
    expect(defV11?.preguntas).toHaveLength(41);
  });
});
