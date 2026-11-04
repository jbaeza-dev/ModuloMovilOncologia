import { afterEach, describe, expect, it } from 'vitest';
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
