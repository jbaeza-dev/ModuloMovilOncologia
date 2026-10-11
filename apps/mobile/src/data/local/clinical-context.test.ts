import { afterEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from './migrations';
import { ingestClinicalContextBundle } from './clinical-context/clinical-context-ingestion';
import { ConflictoIdentidadError } from './clinical-context/clinical-context-types';
import { createPatientRepository, seedPatientContextIfEmpty } from './repository';
import { createSqliteTestHarness, ids, patientA, patientB } from './testing/sqlite-test-harness';

const harness = createSqliteTestHarness();
const { open } = harness;

afterEach(() => {
  harness.cleanup();
});

describe('contexto clínico en SQLite', () => {
  it('seedPatientContextIfEmpty ejecuta su contenido en una única transacción sin errores de anidamiento y siembra contexto clínico y términos', async () => {
    const database = open();
    await migrateDatabase(database);
    // seedPatientContextIfEmpty abre una transacción; no debe fallar con "Transacción anidada"
    await expect(seedPatientContextIfEmpty(database, patientA, patientB)).resolves.not.toThrow();

    const repoA = createPatientRepository(database, patientA, ids());
    const repoB = createPatientRepository(database, patientB, ids());

    // Paciente A
    const fileA = await repoA.clinicalFile();
    expect(fileA?.ficha_id).toBe('FICHA-A-101');
    const medsA = await repoA.activeMedications();
    expect(medsA.map((m) => m.nombre)).toEqual(['Ondansetrón 8 mg', 'Dexametasona 4 mg']);
    const teamA = await repoA.assignedMedicalTeam();
    expect(teamA.map((t) => t.nombre)).toEqual(['Dra. Claudia Morales', 'Enf. Rodrigo Salinas']);

    // Paciente B
    const fileB = await repoB.clinicalFile();
    expect(fileB?.ficha_id).toBe('FICHA-B-202');
    const medsB = await repoB.activeMedications();
    expect(medsB.map((m) => m.nombre)).toEqual(['Metoclopramida 10 mg']);
    const teamB = await repoB.assignedMedicalTeam();
    expect(teamB.map((t) => t.nombre)).toEqual(['Dr. Martín Vega']);

    // Términos
    const terms = await repoA.listTerms();
    expect(terms.map((t) => t.termino_id)).toContain('term-piloto-quimiocare');
    expect(terms.map((t) => t.termino_id)).toContain('term-seguimiento-sintomatico');
  });

  it('aislamiento A/B: paciente B no accede a ficha, medicamentos ni profesionales de paciente A', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());
    const repoB = createPatientRepository(database, patientB, ids());

    const medsA = await repoA.activeMedications();
    const medsB = await repoB.activeMedications();
    expect(medsB.some((m) => medsA.map((ma) => ma.id).includes(m.id))).toBe(false);

    const teamA = await repoA.assignedMedicalTeam();
    const teamB = await repoB.assignedMedicalTeam();
    expect(teamB.some((t) => teamA.map((ta) => ta.id).includes(t.id))).toBe(false);

    // Paciente C sin vínculos ni medicamentos
    const patientC = '33333333-3333-4333-8333-333333333333';
    const repoC = createPatientRepository(database, patientC, ids());
    expect(await repoC.clinicalFile()).toBeNull();
    expect(await repoC.activeMedications()).toHaveLength(0);
    expect(await repoC.assignedMedicalTeam()).toHaveLength(0);
  });

  it('integridad compuesta de esquema: rechaza medicamentos y eventos cruzados entre pacientes', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    // 1. Intentar asociar un medicamento para paciente A con la ficha_id de paciente B ('FICHA-B-202')
    // viola la FK compuesta (paciente_id, ficha_id)
    await expect(
      database.run(
        `INSERT INTO medicamento_activo_cache (
           id, paciente_id, ficha_id, nombre, dosis, frecuencia, fecha_inicio, fecha_fin, estado_activo, obtenido_en
         ) VALUES ('med-cruzado', ?, 'FICHA-B-202', 'Fármaco Inválido', '10 mg', 'Cada 12h', '2026-10-01', NULL, 1, '2026-10-01T10:00:00Z')`,
        [patientA],
      ),
    ).rejects.toThrow();

    // 2. Crear un consentimiento para Paciente A
    const repoA = createPatientRepository(
      database,
      patientA,
      ids('consent-a-uuid', 'event-a-uuid', 'queue-a-uuid'),
    );
    const { consentId } = await repoA.grantConsent('term-piloto-quimiocare', '1.0');

    // Intentar asociar un evento_consentimiento para paciente B con el consentimiento de paciente A
    // viola la FK compuesta (consentimiento_id, paciente_id, termino_id, version)
    await expect(
      database.run(
        `INSERT INTO evento_consentimiento (
           id, paciente_id, consentimiento_id, termino_id, version, secuencia, accion, fecha_evento
         ) VALUES ('ev-cruzado', ?, ?, 'term-piloto-quimiocare', '1.0', 99, 'otorgado', '2026-10-01T10:00:00Z')`,
        [patientB, consentId],
      ),
    ).rejects.toThrow();
  });

  it('persistencia e idempotencia ante reinicio: medicamento inactivo y vínculo revocado no se reactivan', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    // Simular que una ingesta autorizada suspendió un medicamento y revocó un vínculo de Paciente A
    await database.run(
      "UPDATE medicamento_activo_cache SET estado_activo = 0 WHERE id = 'med-a-1'",
    );
    await database.run(
      "UPDATE paciente_clinico_cache SET estado_conocido = 'revocado' WHERE id = 'vinc-a-1'",
    );

    // Re-ejecutar seedPatientContextIfEmpty (simulando reapertura de la app)
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());
    const medsA = await repoA.activeMedications();
    // med-a-1 ('Ondansetrón 8 mg') sigue inactivo, solo queda med-a-2 ('Dexametasona 4 mg')
    expect(medsA.map((m) => m.id)).toEqual(['med-a-2']);

    const teamA = await repoA.assignedMedicalTeam();
    // vinc-a-1 ('Dra. Claudia Morales') sigue revocado, solo queda prof-2 ('Enf. Rodrigo Salinas')
    expect(teamA.map((t) => t.id)).toEqual(['prof-2']);
  });

  it('ingestClinicalContextBundle rechaza modificar la identidad de registros existentes (paciente o profesional) y revierte el lote completo', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    // Caso 1: Intentar reasignar un medicamento existente de Paciente A (med-a-1) al Paciente B
    await expect(
      ingestClinicalContextBundle(database, {
        medicamentos: [
          {
            id: 'med-a-1',
            pacienteId: patientB,
            fichaId: 'FICHA-B-202',
            nombre: 'Ondansetrón 8 mg Reasignado',
            dosis: '8 mg',
            frecuencia: 'Cada 8 horas',
          },
          {
            id: 'med-b-nuevo',
            pacienteId: patientB,
            fichaId: 'FICHA-B-202',
            nombre: 'Nuevo Medicamento B',
            dosis: '10 mg',
            frecuencia: 'Diario',
          },
        ],
      }),
    ).rejects.toThrow(ConflictoIdentidadError);

    // Verificar atomicidad y conservación: med-a-1 sigue perteneciendo a Paciente A y med-b-nuevo no se insertó
    const medA = await database.first<{ paciente_id: string; nombre: string }>(
      'SELECT paciente_id, nombre FROM medicamento_activo_cache WHERE id = ?',
      ['med-a-1'],
    );
    expect(medA?.paciente_id).toBe(patientA);
    expect(medA?.nombre).toBe('Ondansetrón 8 mg');

    const medBNuevo = await database.first('SELECT id FROM medicamento_activo_cache WHERE id = ?', [
      'med-b-nuevo',
    ]);
    expect(medBNuevo).toBeNull();

    // Caso 2: Intentar modificar el vínculo vinc-a-1 de Paciente A asociándolo a Paciente B
    await expect(
      ingestClinicalContextBundle(database, {
        vinculos: [
          {
            id: 'vinc-a-1',
            pacienteId: patientB,
            profesionalId: 'prof-1',
            estadoConocido: 'activo',
            fechaVinculacion: '2026-10-01',
          },
        ],
      }),
    ).rejects.toThrow(ConflictoIdentidadError);

    // Verificar que vinc-a-1 sigue perteneciendo al paciente A
    const vincA = await database.first<{ paciente_id: string }>(
      'SELECT paciente_id FROM paciente_clinico_cache WHERE id = ?',
      ['vinc-a-1'],
    );
    expect(vincA?.paciente_id).toBe(patientA);
  });

  it('ingestClinicalContextBundle conserva estado inactivo al actualizar si se omite estadoActivo, y usa 1 solo para registros nuevos', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    // 1. Marcar medicamento med-a-1 como inactivo
    await database.run('UPDATE medicamento_activo_cache SET estado_activo = 0 WHERE id = ?', [
      'med-a-1',
    ]);

    // 2. Actualizar su dosis omitiendo estadoActivo
    await ingestClinicalContextBundle(database, {
      medicamentos: [
        {
          id: 'med-a-1',
          pacienteId: patientA,
          fichaId: 'FICHA-A-101',
          nombre: 'Ondansetrón 8 mg',
          dosis: '16 mg (Ajustada)',
          frecuencia: 'Cada 12 horas',
          // estadoActivo se omite
        },
        {
          id: 'med-a-nuevo-omite',
          pacienteId: patientA,
          fichaId: 'FICHA-A-101',
          nombre: 'Fármaco Nuevo',
          dosis: '5 mg',
          frecuencia: 'Cada 24 horas',
          // estadoActivo se omite en registro nuevo
        },
      ],
    });

    // Verificar que med-a-1 actualizó dosis pero conservó estado_activo = 0
    const medUpdated = await database.first<{ dosis: string; estado_activo: number }>(
      'SELECT dosis, estado_activo FROM medicamento_activo_cache WHERE id = ?',
      ['med-a-1'],
    );
    expect(medUpdated?.dosis).toBe('16 mg (Ajustada)');
    expect(medUpdated?.estado_activo).toBe(0);

    // Verificar que el nuevo medicamento recibió 1 como valor predeterminado
    const medNuevo = await database.first<{ estado_activo: number }>(
      'SELECT estado_activo FROM medicamento_activo_cache WHERE id = ?',
      ['med-a-nuevo-omite'],
    );
    expect(medNuevo?.estado_activo).toBe(1);
  });
});
