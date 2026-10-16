import { afterEach, describe, expect, it } from 'vitest';

import { ingestTermDefinitions } from '../../data/local/consents/consent-ingestion';
import { listCachedTerms } from '../../data/local/consents/consent-repository';
import { migrateDatabase } from '../../data/local/migrations';
import { createPatientRepository, seedPatientContextIfEmpty } from '../../data/local/repository';
import {
  createSqliteTestHarness,
  ids,
  patientA,
  patientB,
} from '../../data/local/testing/sqlite-test-harness';

const harness = createSqliteTestHarness();
const { open } = harness;

afterEach(() => {
  harness.cleanup();
});

describe('flujo de acceso y términos en almacenamiento local', () => {
  it('lectura de términos cacheados mediante listCachedTerms() opera sin requerir paciente activo', async () => {
    const database = open();
    await migrateDatabase(database);

    // Sin términos iniciales
    const emptyTerms = await listCachedTerms(database);
    expect(emptyTerms).toEqual([]);

    // Sembrar contexto con definiciones de términos
    await seedPatientContextIfEmpty(database, patientA, patientB);

    // Consulta anónima / sin paciente
    const terms = await listCachedTerms(database);
    expect(terms.length).toBeGreaterThanOrEqual(1);
    expect(terms.some((t) => t.termino_id === 'term-piloto-quimiocare')).toBe(true);

    const pilotoTerm = terms.find((t) => t.termino_id === 'term-piloto-quimiocare');
    expect(pilotoTerm?.titulo).toBe('Términos y Condiciones del Piloto QuimioCare');
    expect(pilotoTerm?.version).toBe('1.0');
    expect(pilotoTerm?.vigente_desde).toBeDefined();
  });

  it('otorgamiento y revocación con paciente activo verifica eventos causales y cola_envio', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());

    // 1. Otorgar consentimiento
    const { consentId, eventId } = await repoA.grantConsent('term-piloto-quimiocare', '1.0');
    expect(consentId).toBeDefined();
    expect(eventId).toBeDefined();

    // Comprobar estado en tabla consentimiento_usuario
    const consentRow = await database.first<{ estado: string; paciente_id: string }>(
      'SELECT estado, paciente_id FROM consentimiento_usuario WHERE id = ?',
      [consentId],
    );
    expect(consentRow?.estado).toBe('otorgado');
    expect(consentRow?.paciente_id).toBe(patientA);

    // Comprobar evento causal
    const eventRow = await database.first<{
      secuencia: number;
      accion: string;
      paciente_id: string;
    }>('SELECT secuencia, accion, paciente_id FROM evento_consentimiento WHERE id = ?', [eventId]);
    expect(eventRow?.secuencia).toBe(1);
    expect(eventRow?.accion).toBe('otorgado');
    expect(eventRow?.paciente_id).toBe(patientA);

    // Comprobar cola de envío
    const queueRow1 = await database.first<{
      tipo_entidad: string;
      registro_id: string;
      estado: string;
    }>('SELECT tipo_entidad, registro_id, estado FROM cola_envio WHERE registro_id = ?', [eventId]);
    expect(queueRow1?.tipo_entidad).toBe('evento_consentimiento');
    expect(queueRow1?.estado).toBe('pendiente');

    // 2. Revocar consentimiento
    const revokeResult = await repoA.revokeConsent(consentId);
    expect(revokeResult).not.toBeNull();
    const revokeEventId = revokeResult!.eventId;

    // Comprobar actualización en tabla de consentimiento
    const revokedConsentRow = await database.first<{ estado: string; fecha_revocacion: string }>(
      'SELECT estado, fecha_revocacion FROM consentimiento_usuario WHERE id = ?',
      [consentId],
    );
    expect(revokedConsentRow?.estado).toBe('revocado');
    expect(revokedConsentRow?.fecha_revocacion).not.toBeNull();

    // Comprobar segundo evento causal con secuencia incremental
    const revokeEventRow = await database.first<{ secuencia: number; accion: string }>(
      'SELECT secuencia, accion FROM evento_consentimiento WHERE id = ?',
      [revokeEventId],
    );
    expect(revokeEventRow?.secuencia).toBe(2);
    expect(revokeEventRow?.accion).toBe('revocado');

    // Comprobar segundo elemento en cola_envio
    const queueRow2 = await database.first<{ tipo_entidad: string; estado: string }>(
      'SELECT tipo_entidad, estado FROM cola_envio WHERE registro_id = ?',
      [revokeEventId],
    );
    expect(queueRow2?.tipo_entidad).toBe('evento_consentimiento');
    expect(queueRow2?.estado).toBe('pendiente');
  });

  it('rechazo de aceptación para términos con vigencia futura o vigencia expirada', async () => {
    const database = open();
    await migrateDatabase(database);

    const futureTermId = 'term-vigencia-futura';
    const expiredTermId = 'term-vigencia-expirada';

    await ingestTermDefinitions(database, {
      terminos: [
        {
          terminoId: futureTermId,
          version: '1.0',
          titulo: 'Términos Futuros',
          contenidoMarkdown: '# Contenido no vigente aún',
          vigenteDesde: '2099-01-01T00:00:00Z',
        },
        {
          terminoId: expiredTermId,
          version: '1.0',
          titulo: 'Términos Expirados',
          contenidoMarkdown: '# Contenido vencido',
          vigenteDesde: '2020-01-01T00:00:00Z',
          vigenteHasta: '2021-01-01T00:00:00Z',
        },
      ],
    });

    const repoA = createPatientRepository(database, patientA, ids());

    // Intento de otorgar término con vigencia futura
    await expect(repoA.grantConsent(futureTermId, '1.0')).rejects.toThrow(
      "La versión '1.0' de 'term-vigencia-futura' no se encuentra vigente para su aceptación.",
    );

    // Intento de otorgar término con vigencia expirada
    await expect(repoA.grantConsent(expiredTermId, '1.0')).rejects.toThrow(
      "La versión '1.0' de 'term-vigencia-expirada' no se encuentra vigente para su aceptación.",
    );
  });

  it('independencia de versiones: nueva versión no hereda consentimiento previo de versión anterior', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const termMultiVersion = 'term-multiversion-test';

    await ingestTermDefinitions(database, {
      terminos: [
        {
          terminoId: termMultiVersion,
          version: '1.0',
          titulo: 'Términos Versión 1',
          contenidoMarkdown: '# Versión 1.0',
          vigenteDesde: '2025-01-01T00:00:00Z',
        },
        {
          terminoId: termMultiVersion,
          version: '2.0',
          titulo: 'Términos Versión 2',
          contenidoMarkdown: '# Versión 2.0 con cambios',
          vigenteDesde: '2026-01-01T00:00:00Z',
        },
      ],
    });

    const repoA = createPatientRepository(database, patientA, ids());

    // Otorgar v1.0
    await repoA.grantConsent(termMultiVersion, '1.0');

    // Estado de v1.0 es otorgado
    const statusV1 = await repoA.getConsentStatus(termMultiVersion, '1.0');
    expect(statusV1.estado).toBe('otorgado');

    // Estado de v2.0 debe ser nunca_otorgado (no heredado)
    const statusV2 = await repoA.getConsentStatus(termMultiVersion, '2.0');
    expect(statusV2.estado).toBe('nunca_otorgado');
    expect(statusV2.activeConsent).toBeNull();

    // Otorgar v2.0 posteriormente
    const grantV2 = await repoA.grantConsent(termMultiVersion, '2.0');
    expect(grantV2.consentId).toBeDefined();

    const statusV2After = await repoA.getConsentStatus(termMultiVersion, '2.0');
    expect(statusV2After.estado).toBe('otorgado');
    expect(statusV2After.activeConsent?.id).toBe(grantV2.consentId);
  });

  it('aislamiento estricto entre pacientes: Paciente B no puede revocar consentimientos de Paciente A', async () => {
    const database = open();
    await migrateDatabase(database);
    await seedPatientContextIfEmpty(database, patientA, patientB);

    const repoA = createPatientRepository(database, patientA, ids());
    const repoB = createPatientRepository(database, patientB, ids());

    const { consentId } = await repoA.grantConsent('term-piloto-quimiocare', '1.0');

    // Estado de A es otorgado
    const statusA = await repoA.getConsentStatus('term-piloto-quimiocare', '1.0');
    expect(statusA.estado).toBe('otorgado');

    // Estado de B es nunca_otorgado
    const statusB = await repoB.getConsentStatus('term-piloto-quimiocare', '1.0');
    expect(statusB.estado).toBe('nunca_otorgado');

    // Paciente B intenta revocar el consentId perteneciente a Paciente A
    await expect(repoB.revokeConsent(consentId)).rejects.toThrow(
      'Consentimiento no encontrado o no pertenece al paciente activo.',
    );
  });
});
