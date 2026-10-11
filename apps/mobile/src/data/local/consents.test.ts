import { afterEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from './migrations';
import { ingestTermDefinitions } from './consents/consent-ingestion';
import { createPatientRepository, seedPatientContextIfEmpty } from './repository';
import { createSqliteTestHarness, ids, patientA, patientB } from './testing/sqlite-test-harness';

const harness = createSqliteTestHarness();
const { open } = harness;

afterEach(() => {
  harness.cleanup();
});

describe('términos y consentimientos en SQLite', () => {
  it('inmutabilidad de términos: re-incorporar mismo contenido es idempotente, contenido modificado bajo misma versión es rechazado', async () => {
    const database = open();
    await migrateDatabase(database);

    const termBundle = {
      terminos: [
        {
          terminoId: 'term-inmutable-test',
          version: '1.0',
          titulo: 'Términos de Prueba',
          contenidoMarkdown: '# Texto Original Inmutable',
          vigenteDesde: '2026-01-01T00:00:00Z',
        },
      ],
    };

    // 1. Ingesta inicial
    await ingestTermDefinitions(database, termBundle);
    const term = await database.first<{ titulo: string; contenido_markdown: string }>(
      'SELECT titulo, contenido_markdown FROM definicion_terminos_cache WHERE termino_id = ? AND version = ?',
      ['term-inmutable-test', '1.0'],
    );
    expect(term?.contenido_markdown).toBe('# Texto Original Inmutable');

    // 2. Re-ingesta con exactamente el mismo contenido (idempotente)
    await expect(ingestTermDefinitions(database, termBundle)).resolves.not.toThrow();

    // 3. Intento de re-ingesta con contenido modificado bajo la misma versión (1.0)
    const alteredBundle = {
      terminos: [
        {
          terminoId: 'term-inmutable-test',
          version: '1.0',
          titulo: 'Términos de Prueba Modificados',
          contenidoMarkdown: '# Texto Modificado Ilegítimo',
          vigenteDesde: '2026-01-01T00:00:00Z',
        },
      ],
    };
    await expect(ingestTermDefinitions(database, alteredBundle)).rejects.toThrow(
      "Conflicto de inmutabilidad: la versión '1.0' de 'term-inmutable-test' ya existe con un contenido distinto.",
    );

    // El contenido original se preserva íntegro
    const termAfter = await database.first<{ contenido_markdown: string }>(
      'SELECT contenido_markdown FROM definicion_terminos_cache WHERE termino_id = ? AND version = ?',
      ['term-inmutable-test', '1.0'],
    );
    expect(termAfter?.contenido_markdown).toBe('# Texto Original Inmutable');
  });

  it('ciclo completo de consentimiento: otorgamiento, idempotencia, revocación por consentId, re-otorgamiento y cola inmutable', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());

    // 1. Otorgamiento de consentimiento v1.0
    const { consentId, eventId } = await repoA.grantConsent('term-piloto-quimiocare', '1.0');
    expect(consentId).toBeDefined();
    expect(eventId).toBeDefined();

    // Comprobar estado
    const status1 = await repoA.getConsentStatus('term-piloto-quimiocare', '1.0');
    expect(status1.estado).toBe('otorgado');
    expect(status1.activeConsent?.id).toBe(consentId);
    expect(status1.lastEvent?.secuencia).toBe(1);

    // Comprobar inserción en cola_envio
    const queue1 = await database.first<{ payload_json: string }>(
      'SELECT payload_json FROM cola_envio WHERE registro_id = ?',
      [eventId],
    );
    expect(queue1).not.toBeNull();
    const payload1 = JSON.parse(queue1!.payload_json);
    expect(payload1.record.accion).toBe('otorgado');
    expect(payload1.record.secuencia).toBe(1);

    // 2. Idempotencia: re-otorgar cuando ya está activo devuelve el mismo consentId y no duplica cola ni eventos
    const reGrant = await repoA.grantConsent('term-piloto-quimiocare', '1.0');
    expect(reGrant.consentId).toBe(consentId);
    const eventsCount1 = await database.first<{ total: number }>(
      'SELECT count(*) as total FROM evento_consentimiento WHERE paciente_id = ?',
      [patientA],
    );
    expect(eventsCount1?.total).toBe(1);

    // 3. Revocación por consentId
    const revokeResult = await repoA.revokeConsent(consentId);
    expect(revokeResult).not.toBeNull();

    // Comprobar estado tras revocación
    const status2 = await repoA.getConsentStatus('term-piloto-quimiocare', '1.0');
    expect(status2.estado).toBe('revocado');
    expect(status2.activeConsent).toBeNull();
    expect(status2.lastConsent?.fecha_revocacion).not.toBeNull();
    expect(status2.lastEvent?.secuencia).toBe(2);
    expect(status2.lastEvent?.accion).toBe('revocado');

    // Comprobar que en cola_envio existen 2 filas: la primera inmutable ('otorgado') y la segunda ('revocado')
    const queueEntries = await database.all<{ payload_json: string }>(
      "SELECT payload_json FROM cola_envio WHERE paciente_id = ? AND tipo_entidad = 'evento_consentimiento' ORDER BY creado_en ASC",
      [patientA],
    );
    expect(queueEntries).toHaveLength(2);
    expect(JSON.parse(queueEntries[0].payload_json).record.accion).toBe('otorgado');
    expect(JSON.parse(queueEntries[1].payload_json).record.accion).toBe('revocado');

    // 4. Re-otorgamiento tras revocación: crea nuevo consentimiento, tercer evento y tercera fila en cola
    const grant3 = await repoA.grantConsent('term-piloto-quimiocare', '1.0');
    expect(grant3.consentId).not.toBe(consentId);

    const status3 = await repoA.getConsentStatus('term-piloto-quimiocare', '1.0');
    expect(status3.estado).toBe('otorgado');
    expect(status3.activeConsent?.id).toBe(grant3.consentId);
    expect(status3.lastEvent?.secuencia).toBe(3);

    const allEvents = await repoA.listConsentHistory('term-piloto-quimiocare');
    expect(allEvents).toHaveLength(3);
    // Ordenado por secuencia DESC: secuencia 3, 2, 1
    expect(allEvents.map((e) => e.secuencia)).toEqual([3, 2, 1]);
    expect(allEvents.map((e) => e.accion)).toEqual(['otorgado', 'revocado', 'otorgado']);

    // 5. Revocación con un consentId perteneciente a otro paciente es rechazada
    const repoB = createPatientRepository(database, patientB, ids());
    await expect(repoB.revokeConsent(grant3.consentId)).rejects.toThrow(
      'Consentimiento no encontrado o no pertenece al paciente activo.',
    );
  });

  it('atomicidad: fallo en cola_envio revierte completamente tanto en otorgamiento como en revocación', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    // 1. Fallo simulado durante otorgamiento: UUID de cola colisiona
    const queueIdColliding = 'collision-queue-uuid';
    await database.run(
      `INSERT INTO cola_envio (id, paciente_id, tipo_entidad, registro_id, payload_json, estado, creado_en, actualizado_en)
       VALUES (?, ?, 'signos_vitales', 'dummy-reg', '{}', 'pendiente', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`,
      [queueIdColliding, patientA],
    );

    const failingRepo = createPatientRepository(
      database,
      patientA,
      ids('consent-fail-1', 'event-fail-1', queueIdColliding),
    );

    await expect(failingRepo.grantConsent('term-piloto-quimiocare', '1.0')).rejects.toThrow();

    // Rollback verificado: no se insertó consentimiento ni evento
    const consents = await database.all(
      'SELECT * FROM consentimiento_usuario WHERE paciente_id = ?',
      [patientA],
    );
    expect(consents).toHaveLength(0);
    const events = await database.all('SELECT * FROM evento_consentimiento WHERE paciente_id = ?', [
      patientA,
    ]);
    expect(events).toHaveLength(0);

    // 2. Otorgar exitosamente primero
    const workingRepo = createPatientRepository(database, patientA, ids());
    const { consentId } = await workingRepo.grantConsent('term-piloto-quimiocare', '1.0');

    // 3. Fallo simulado durante revocación: UUID de cola colisiona en el 2do id generado (eventId, queueId)
    const failingRevokeRepo = createPatientRepository(
      database,
      patientA,
      ids('event-fail-2', queueIdColliding),
    );

    await expect(failingRevokeRepo.revokeConsent(consentId)).rejects.toThrow();

    // Rollback verificado: el consentimiento sigue en 'otorgado' y no se creó un evento parcial de revocación
    const consentAfter = await database.first<{ estado: string }>(
      'SELECT estado FROM consentimiento_usuario WHERE id = ?',
      [consentId],
    );
    expect(consentAfter?.estado).toBe('otorgado');
    const eventsAfter = await database.all<{ accion: string }>(
      'SELECT * FROM evento_consentimiento WHERE consentimiento_id = ?',
      [consentId],
    );
    expect(eventsAfter).toHaveLength(1);
    expect(eventsAfter[0].accion).toBe('otorgado');
  });

  it('secuencia causal incremental: reloj fijo y reloj retrocediendo conservan el orden real de los eventos', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    // 1. Reloj fijo: exactamente el mismo instante para las 3 operaciones
    const fixedTime = '2026-10-08T12:00:00.000Z';
    const sharedIds = ids();
    const repoFixed = createPatientRepository(database, patientA, sharedIds, () => fixedTime);

    const { consentId: c1 } = await repoFixed.grantConsent('term-piloto-quimiocare', '1.0');
    await repoFixed.revokeConsent(c1);
    const { consentId: c1Re } = await repoFixed.grantConsent('term-piloto-quimiocare', '1.0');

    // Comprobar eventos y secuencias en la base
    const eventsFixed = await database.all<{
      secuencia: number;
      accion: string;
      fecha_evento: string;
    }>(
      'SELECT secuencia, accion, fecha_evento FROM evento_consentimiento WHERE paciente_id = ? ORDER BY secuencia ASC',
      [patientA],
    );
    expect(eventsFixed).toHaveLength(3);
    expect(eventsFixed.map((e) => e.secuencia)).toEqual([1, 2, 3]);
    expect(eventsFixed.map((e) => e.accion)).toEqual(['otorgado', 'revocado', 'otorgado']);
    // Todos comparten el mismo timestamp
    expect(eventsFixed.every((e) => e.fecha_evento === fixedTime)).toBe(true);

    // listConsentHistory ordena por secuencia DESC: devuelve nuevo otorgado -> revocado -> otorgado
    const historyFixed = await repoFixed.listConsentHistory('term-piloto-quimiocare', '1.0');
    expect(historyFixed.map((e) => e.secuencia)).toEqual([3, 2, 1]);

    // getConsentStatus resuelve vía secuencia máxima: estado 'otorgado', activeConsent válido y último evento #3
    const statusFixed = await repoFixed.getConsentStatus('term-piloto-quimiocare', '1.0');
    expect(statusFixed.estado).toBe('otorgado');
    expect(statusFixed.activeConsent).not.toBeNull();
    expect(statusFixed.activeConsent?.id).toBe(c1Re);
    expect(statusFixed.lastEvent?.secuencia).toBe(3);

    // 2. Reloj retrocediendo:
    // Evento 4 (otro término): T2 (12:00)
    // Evento 5 (revocación de ese término): T1 (11:00, reloj retrocedió 1 hora)
    // Evento 6 (nuevo otorgamiento): T0 (10:00, reloj retrocedió 2 horas)
    let currentClock = '2026-10-08T12:00:00.000Z';
    const clockMock = () => currentClock;
    const repoSkew = createPatientRepository(database, patientA, sharedIds, clockMock);

    const { consentId: c2 } = await repoSkew.grantConsent('term-seguimiento-sintomatico', '1.0');
    // Retroceder reloj
    currentClock = '2026-10-08T11:00:00.000Z';
    await repoSkew.revokeConsent(c2);
    // Retroceder reloj nuevamente
    currentClock = '2026-10-08T10:00:00.000Z';
    const { consentId: c2Re } = await repoSkew.grantConsent('term-seguimiento-sintomatico', '1.0');

    const eventsSkew = await database.all<{
      secuencia: number;
      accion: string;
      fecha_evento: string;
    }>(
      "SELECT secuencia, accion, fecha_evento FROM evento_consentimiento WHERE paciente_id = ? AND termino_id = 'term-seguimiento-sintomatico' ORDER BY secuencia ASC",
      [patientA],
    );
    expect(eventsSkew).toHaveLength(3);
    expect(eventsSkew.map((e) => e.secuencia)).toEqual([4, 5, 6]);
    expect(eventsSkew.map((e) => e.accion)).toEqual(['otorgado', 'revocado', 'otorgado']);
    expect(eventsSkew[0].fecha_evento).toBe('2026-10-08T12:00:00.000Z');
    expect(eventsSkew[1].fecha_evento).toBe('2026-10-08T11:00:00.000Z');
    expect(eventsSkew[2].fecha_evento).toBe('2026-10-08T10:00:00.000Z');

    // La secuencia causal (4 luego 5 luego 6) garantiza el orden verdadero a pesar de que el timestamp retrocedió
    const historySkew = await repoSkew.listConsentHistory('term-seguimiento-sintomatico', '1.0');
    expect(historySkew.map((e) => e.secuencia)).toEqual([6, 5, 4]);
    expect(historySkew.map((e) => e.accion)).toEqual(['otorgado', 'revocado', 'otorgado']);

    // getConsentStatus no se confunde con creado_en DESC: resuelve la secuencia 6 y devuelve 'otorgado'
    const statusSkew = await repoSkew.getConsentStatus('term-seguimiento-sintomatico', '1.0');
    expect(statusSkew.estado).toBe('otorgado');
    expect(statusSkew.activeConsent).not.toBeNull();
    expect(statusSkew.activeConsent?.id).toBe(c2Re);
    expect(statusSkew.lastEvent?.secuencia).toBe(6);
  });

  it('versión 2 de términos requiere aceptación propia explícita, no hereda aceptación de v1 y conserva su historial', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());

    // Aceptar versión 1.0
    await repoA.grantConsent('term-piloto-quimiocare', '1.0');

    // Incorporar versión 2.0
    await ingestTermDefinitions(database, {
      terminos: [
        {
          terminoId: 'term-piloto-quimiocare',
          version: '2.0',
          titulo: 'Términos y Condiciones del Piloto QuimioCare (Versión 2)',
          contenidoMarkdown: '# Actualización v2 de términos',
          vigenteDesde: '2026-10-01T00:00:00Z',
        },
      ],
    });

    // Estado de versión 2.0 es 'nunca_otorgado'
    const statusV2 = await repoA.getConsentStatus('term-piloto-quimiocare', '2.0');
    expect(statusV2.estado).toBe('nunca_otorgado');
    expect(statusV2.activeConsent).toBeNull();

    // Estado de versión 1.0 se mantiene en 'otorgado'
    const statusV1 = await repoA.getConsentStatus('term-piloto-quimiocare', '1.0');
    expect(statusV1.estado).toBe('otorgado');
    expect(statusV1.activeConsent).not.toBeNull();
  });

  it('aislamiento A/B en estado e historial de consentimientos', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());
    const repoB = createPatientRepository(database, patientB, ids());

    // Paciente A acepta v1.0
    await repoA.grantConsent('term-piloto-quimiocare', '1.0');

    // Paciente B consulta v1.0
    const statusB = await repoB.getConsentStatus('term-piloto-quimiocare', '1.0');
    expect(statusB.estado).toBe('nunca_otorgado');
    expect(statusB.activeConsent).toBeNull();

    const historyB = await repoB.listConsentHistory('term-piloto-quimiocare');
    expect(historyB).toHaveLength(0);
  });

  it('dos otorgamientos concurrentes: exactamente un consentimiento, un evento y una operación pendiente, devolviendo los mismos identificadores a ambas llamadas', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repo = createPatientRepository(database, patientA, ids());
    const [res1, res2] = await Promise.all([
      repo.grantConsent('term-piloto-quimiocare', '1.0'),
      repo.grantConsent('term-piloto-quimiocare', '1.0'),
    ]);

    expect(res1.consentId).toBe(res2.consentId);
    expect(res1.eventId).toBe(res2.eventId);

    const consents = await database.all(
      'SELECT * FROM consentimiento_usuario WHERE paciente_id = ? AND termino_id = ?',
      [patientA, 'term-piloto-quimiocare'],
    );
    expect(consents).toHaveLength(1);

    const events = await database.all(
      'SELECT * FROM evento_consentimiento WHERE paciente_id = ? AND termino_id = ?',
      [patientA, 'term-piloto-quimiocare'],
    );
    expect(events).toHaveLength(1);

    const queue = await database.all(
      "SELECT * FROM cola_envio WHERE paciente_id = ? AND tipo_entidad = 'evento_consentimiento'",
      [patientA],
    );
    expect(queue).toHaveLength(1);
  });

  it('ingestTermDefinitions valida fechas, normaliza a ISO UTC y grantConsent evalúa vigencia correctamente con husos horarios y offsets', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    // 1. Fecha inválida es rechazada
    await expect(
      ingestTermDefinitions(database, {
        terminos: [
          {
            terminoId: 'term-invalido',
            version: '1.0',
            titulo: 'Término Inválido',
            contenidoMarkdown: 'Texto',
            vigenteDesde: 'fecha-no-valida-32-13',
          },
        ],
      }),
    ).rejects.toThrow('Fecha inválida');

    // 2. vigenteHasta menor que vigenteDesde es rechazado
    await expect(
      ingestTermDefinitions(database, {
        terminos: [
          {
            terminoId: 'term-rango-invalido',
            version: '1.0',
            titulo: 'Rango Inválido',
            contenidoMarkdown: 'Texto',
            vigenteDesde: '2026-10-10T12:00:00Z',
            vigenteHasta: '2026-10-09T12:00:00Z',
          },
        ],
      }),
    ).rejects.toThrow('Vigencia inválida');

    // 3. Normalización con timezone offsets:
    // vigenteHasta con offset -04:00 (2026-10-08T20:00:00-04:00 equivale exactamente a 2026-10-09T00:00:00.000Z)
    await ingestTermDefinitions(database, {
      terminos: [
        {
          terminoId: 'term-con-offset',
          version: '1.0',
          titulo: 'Términos con Offset Horario',
          contenidoMarkdown: 'Contenido legal con huso horario',
          vigenteDesde: '2026-10-01T00:00:00-03:00',
          vigenteHasta: '2026-10-08T20:00:00-04:00',
        },
      ],
    });

    const termRow = await database.first<{ vigente_desde: string; vigente_hasta: string }>(
      'SELECT vigente_desde, vigente_hasta FROM definicion_terminos_cache WHERE termino_id = ?',
      ['term-con-offset'],
    );
    expect(termRow?.vigente_desde).toBe('2026-10-01T03:00:00.000Z');
    expect(termRow?.vigente_hasta).toBe('2026-10-09T00:00:00.000Z');

    // 4. Probar aceptación con reloj:
    // En T = 2026-10-08T23:55:00.000Z (antes del vencimiento 00:00:00Z): es vigente y se acepta
    const repoValido = createPatientRepository(
      database,
      patientA,
      ids(),
      () => '2026-10-08T23:55:00.000Z',
    );
    const { consentId } = await repoValido.grantConsent('term-con-offset', '1.0');
    expect(consentId).toBeDefined();

    // En T = 2026-10-09T00:05:00.000Z (después del vencimiento): ya venció y se rechaza
    const repoExpirado = createPatientRepository(
      database,
      patientB,
      ids(),
      () => '2026-10-09T00:05:00.000Z',
    );
    await expect(repoExpirado.grantConsent('term-con-offset', '1.0')).rejects.toThrow(
      'no se encuentra vigente',
    );
  });
});
