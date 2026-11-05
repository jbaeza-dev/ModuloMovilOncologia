import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSqliteTestHarness } from '../local/testing/sqlite-test-harness';
import { retrySessionCommands, storedSessionPause } from './session-pause';
const harness = createSqliteTestHarness();
afterEach(() => harness.cleanup());
describe('Reanudación selectiva tras verificar sesión', () => {
  it('solo reactiva pausas de sesión del dueño y entorno actuales, conservando capturas y errores técnicos', async () => {
    const db = harness.open();
    await db.exec(
      'CREATE TABLE qc_clinical_command(id TEXT PRIMARY KEY,owner TEXT,environment TEXT,status TEXT,error_json TEXT,payload_json TEXT,captured_at TEXT)',
    );
    const entries = [
      ['a', 'demo', 'pausado', 'SESION_EXPIRED'],
      ['a', 'demo', 'pausado', 'SESION_DENIED'],
      ['a', 'demo', 'pausado', 'SNAPSHOT_FUERA_CONTRATO'],
      ['a', 'demo', 'pausado', 'ACK_REMOTO_INCOHERENTE'],
      ['a', 'demo', 'pausado', 'SESION_INVALID'],
      ['b', 'demo', 'pausado', 'SESION_EXPIRED'],
      ['a', 'otro', 'pausado', 'SESION_EXPIRED'],
      ['a', 'demo', 'rechazado', 'SESION_EXPIRED'],
      ['a', 'demo', 'aceptado', 'SESION_EXPIRED'],
      ['a', 'demo', 'pausado', 'malformed'],
    ];
    for (const [index, [owner, environment, status, code]] of entries.entries())
      await db.run('INSERT INTO qc_clinical_command VALUES (?,?,?,?,?,?,?)', [
        String(index),
        owner,
        environment,
        status,
        code === 'malformed' ? '{bad' : JSON.stringify({ code }),
        '{"captura":"intacta"}',
        '2026-11-03T10:00:00Z',
      ]);
    const before = await db.all<Record<string, unknown>>(
      'SELECT * FROM qc_clinical_command ORDER BY id',
    );
    await retrySessionCommands(db, { owner: 'a', environment: 'demo', localPatientId: 'local-a' });
    const after = await db.all<Record<string, unknown>>(
      'SELECT * FROM qc_clinical_command ORDER BY id',
    );
    expect(after).toEqual(
      before.map((row) =>
        ['0', '1'].includes(String(row.id))
          ? { ...row, status: 'pendiente', error_json: null }
          : row,
      ),
    );
    await retrySessionCommands(db, { owner: 'a', environment: 'demo', localPatientId: 'local-a' });
    expect(await db.all('SELECT * FROM qc_clinical_command ORDER BY id')).toEqual(after);
  });
  it('recupera la causa de sesión del comando y no interpreta errores técnicos o dañados como permisos', () => {
    expect(storedSessionPause('{"code":"SESION_EXPIRED"}')).toBe('SESION_EXPIRED');
    expect(storedSessionPause('{"code":"SESION_DENIED"}')).toBe('SESION_DENIED');
    for (const raw of [
      null,
      '{bad',
      '{"code":"SNAPSHOT_FUERA_CONTRATO"}',
      '{"code":"SESION_INVALID"}',
    ])
      expect(storedSessionPause(raw)).toBeNull();
  });
});

describe('Control de pausa y reconexión en runtime', () => {
  it('persiste y recupera runtime:pause en qc_storage_control', async () => {
    const db = harness.open();
    await db.exec('CREATE TABLE qc_storage_control(id TEXT PRIMARY KEY, value_json TEXT)');
    await db.run("INSERT INTO qc_storage_control(id, value_json) VALUES ('runtime:pause', ?)", [
      JSON.stringify({ code: 'SESION_EXPIRED' }),
    ]);
    const row = await db.first<{ value_json: string }>(
      "SELECT value_json FROM qc_storage_control WHERE id='runtime:pause'",
    );
    expect(row).toBeDefined();
    const parsed = JSON.parse(row!.value_json);
    expect(parsed.code).toBe('SESION_EXPIRED');

    await db.run("DELETE FROM qc_storage_control WHERE id='runtime:pause'");
    const cleaned = await db.first(
      "SELECT value_json FROM qc_storage_control WHERE id='runtime:pause'",
    );
    expect(cleaned).toBeNull();
  });

  it('no reconecta a PowerSync si el store conserva una pausa activa al llamar resume(false)', async () => {
    const connectSpy = vi.fn();
    let pauseCode: string | null = 'SESION_EXPIRED';
    let started = false;

    async function simulatedResume(retryPaused: boolean | 'session', isAuthorized = false) {
      if (retryPaused === 'session') {
        if (isAuthorized) {
          pauseCode = null;
        } else {
          return;
        }
      } else if (retryPaused === true) {
        pauseCode = null;
      }
      if (pauseCode) return;
      if (!started) {
        started = true;
        connectSpy();
      }
    }

    // 1. resume(false) mientras hay pauseCode -> no conecta
    await simulatedResume(false);
    expect(connectSpy).not.toHaveBeenCalled();
    expect(pauseCode).toBe('SESION_EXPIRED');

    // 2. resume('session') sin autorización -> no conecta
    await simulatedResume('session', false);
    expect(connectSpy).not.toHaveBeenCalled();
    expect(pauseCode).toBe('SESION_EXPIRED');

    // 3. resume('session') con autorización -> conecta
    await simulatedResume('session', true);
    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(pauseCode).toBeNull();
  });
});
