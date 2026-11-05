import { describe, expect, it, vi } from 'vitest';
import { readConfig } from '../src/config.js';
import { getSyncedSigns, getSyncedEpro } from '../src/preparation.js';
import type { Database } from '../src/db.js';
import type { Principal } from '../src/types.js';

const config = readConfig({
  APP_ENV: 'demo',
  DATABASE_URL: 'postgres://synthetic.invalid/demo',
  DEMO_SIGNING_KEY: 'synthetic-unit-test-signing-key-not-production',
  DEMO_CONTROL_KEY: 'synthetic-unit-test-control-key-not-production',
  SIMULATOR_PUBLIC_BASE_URL: 'http://synthetic.invalid',
  PREPARATION_ENABLED: 'true',
});

const operatorPrincipal: Principal = {
  id: '00000000-0000-0000-0000-000000000001',
  issuer: config.issuer,
  tipo: 'external',
};

const validPatientId = '11111111-1111-4111-8111-111111111111';
const validFormId = '22222222-2222-4222-8222-222222222222';

describe('getSyncedSigns and getSyncedEpro inspection endpoints', () => {
  it('rechaza llamadas de usuarios que no son operadores', async () => {
    const mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as Database;

    await expect(getSyncedSigns(mockDb, config, operatorPrincipal, validPatientId)).rejects.toThrow(
      'Se requiere un operador activo.',
    );
  });

  it('obtiene lista de signos vitales sincronizados para un paciente', async () => {
    const mockDb = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('qc_demo_operador')) {
          return { rows: [{ id: 'op-1' }] };
        }
        if (sql.includes('qc_demo_signo')) {
          return {
            rows: [
              {
                id: 'sign-1',
                paciente_id: validPatientId,
                request: { presion: '120/80' },
                respuesta: {
                  presion_arterial_sistolica: 120,
                  presion_arterial_diastolica: 80,
                  sincronizado: true,
                },
                fecha_subida: '2026-11-04T20:00:00Z',
              },
            ],
          };
        }
        return { rows: [] };
      }),
    } as unknown as Database;

    const res = await getSyncedSigns(mockDb, config, operatorPrincipal, validPatientId, 10);
    expect(res.status).toBe(200);
    expect(res.body.paciente_id).toBe(validPatientId);
    expect(res.body.total).toBe(1);
    expect(res.body.registros[0]?.id).toBe('sign-1');
    expect((res.body.registros[0] as Record<string, unknown>)?.presion_arterial_sistolica).toBe(
      120,
    );
    expect(res.body.registros[0]?.fecha_subida).toBe('2026-11-04T20:00:00Z');
  });

  it('obtiene lista de respuestas EPRO sincronizadas con filtro de formulario opcional', async () => {
    const mockDb = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('qc_demo_operador')) {
          return { rows: [{ id: 'op-1' }] };
        }
        if (sql.includes('qc_demo_epro')) {
          return {
            rows: [
              {
                id: 'epro-1',
                paciente_id: validPatientId,
                formulario_id: validFormId,
                request: { respuestas: [] },
                respuesta: {
                  comentario: 'Todo bien',
                  respuestas: [{ codigo_pregunta: 'DOLOR', valor: 2 }],
                },
                fecha_subida: '2026-11-04T20:30:00Z',
              },
            ],
          };
        }
        return { rows: [] };
      }),
    } as unknown as Database;

    const res = await getSyncedEpro(
      mockDb,
      config,
      operatorPrincipal,
      validPatientId,
      validFormId,
      5,
    );
    expect(res.status).toBe(200);
    expect(res.body.paciente_id).toBe(validPatientId);
    expect(res.body.total).toBe(1);
    expect(res.body.respuestas[0]?.id).toBe('epro-1');
    expect(res.body.respuestas[0]?.formulario_id).toBe(validFormId);
    expect((res.body.respuestas[0] as Record<string, unknown>)?.comentario).toBe('Todo bien');
  });
});
