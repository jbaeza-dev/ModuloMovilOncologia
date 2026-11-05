import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PowerSyncBackendConnector } from '@powersync/common';
import type { HttpSessionAdapter } from '../../services/session/http-session-adapter';
import { createSqliteTestHarness } from '../local/testing/sqlite-test-harness';
import { retrySessionCommands, storedSessionPause } from './session-pause';
import { createClinicalConnectionController, createClinicalResume } from './clinical-resume';

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

  it('ejercita createClinicalResume real: respeta pausas activas, bloquea reconexión sin autorización y reconecta en primer plano si está autorizado', async () => {
    const db = harness.open();
    await db.exec('CREATE TABLE qc_storage_control(id TEXT PRIMARY KEY, value_json TEXT)');
    await db.exec(
      'CREATE TABLE qc_clinical_command(id TEXT PRIMARY KEY,owner TEXT,environment TEXT,status TEXT,error_json TEXT,payload_json TEXT,captured_at TEXT)',
    );

    // Insertar un comando pausado por sesión
    await db.run('INSERT INTO qc_clinical_command VALUES (?,?,?,?,?,?,?)', [
      'cmd-1',
      'user-1',
      'env-test',
      'pausado',
      JSON.stringify({ code: 'SESION_EXPIRED' }),
      '{}',
      '2026-11-05T10:00:00Z',
    ]);

    // Persistir la pausa en storage_control
    await db.run("INSERT INTO qc_storage_control(id, value_json) VALUES ('runtime:pause', ?)", [
      JSON.stringify({ code: 'SESION_EXPIRED' }),
    ]);

    const connectSpy = vi.fn().mockResolvedValue(undefined);
    const mockDatabase = { connect: connectSpy, disconnect: vi.fn().mockResolvedValue(undefined) };
    let uploadAllowed = false;
    const mockSession: Pick<HttpSessionAdapter, 'getCurrentUser' | 'getSnapshot'> = {
      getCurrentUser: () => ({ id: 'user-1' }) as ReturnType<HttpSessionAdapter['getCurrentUser']>,
      getSnapshot: () => ({ uploadAllowed }) as ReturnType<HttpSessionAdapter['getSnapshot']>,
    };

    const store = {
      closed: false,
      pauseCode: 'SESION_EXPIRED' as string | null,
    };

    const resume = createClinicalResume({
      store,
      scope: { owner: 'user-1', localPatientId: 'pac-1', environment: 'env-test' },
      endpoint: 'https://sync.example.com',
      session: mockSession,
      connection: db,
      getConnector: () => ({}) as unknown as PowerSyncBackendConnector,
      signal: new AbortController().signal,
      database: mockDatabase,
    });

    // 1. Regreso a primer plano (resume(false)) conservando pausa activa -> NO conecta a PowerSync
    await resume(false);
    expect(connectSpy).not.toHaveBeenCalled();
    expect(store.pauseCode).toBe('SESION_EXPIRED');

    // 2. Reintento de sesión (resume('session')) sin autorización -> NO conecta
    uploadAllowed = false;
    await resume('session');
    expect(connectSpy).not.toHaveBeenCalled();
    expect(store.pauseCode).toBe('SESION_EXPIRED');

    // 3. Reintento general (resume(true)) mientras sesión no está autorizada -> limpia comandos pero guarda de sesión bloquea connect
    await resume(true);
    expect(connectSpy).not.toHaveBeenCalled();
    expect(store.pauseCode).toBeNull();

    // 4. Con sesión autorizada y sin pausa (o regreso a primer plano autorizado) -> CONECTA exitosamente
    uploadAllowed = true;
    await resume(false);
    expect(connectSpy).toHaveBeenCalledTimes(1);

    // 5. Verificar que runtime:pause fue eliminado de qc_storage_control
    const pauseRow = await db.first<{ value_json: string }>(
      "SELECT value_json FROM qc_storage_control WHERE id='runtime:pause'",
    );
    expect(pauseRow).toBeNull();
  });
});

describe('Ciclo completo de conexión y desconexión unificada (ClinicalConnectionController)', () => {
  it('ciclo completo: primera reanudación autorizada conecta, paso a segundo plano desconecta, y regreso a primer plano reconecta', async () => {
    const db = harness.open();
    await db.exec('CREATE TABLE qc_storage_control(id TEXT PRIMARY KEY, value_json TEXT)');
    await db.exec(
      'CREATE TABLE qc_clinical_command(id TEXT PRIMARY KEY,owner TEXT,environment TEXT,status TEXT,error_json TEXT,payload_json TEXT,captured_at TEXT)',
    );
    const connectSpy = vi.fn().mockResolvedValue(undefined);
    const disconnectSpy = vi.fn().mockResolvedValue(undefined);
    const mockDatabase = { connect: connectSpy, disconnect: disconnectSpy };

    const store = { closed: false, pauseCode: null as string | null };
    const controller = createClinicalConnectionController({
      store,
      scope: { owner: 'user-1', localPatientId: 'pac-1', environment: 'env-test' },
      endpoint: 'https://sync.example.com',
      session: {
        getCurrentUser: () =>
          ({ id: 'user-1' }) as ReturnType<HttpSessionAdapter['getCurrentUser']>,
        getSnapshot: () =>
          ({ uploadAllowed: true }) as ReturnType<HttpSessionAdapter['getSnapshot']>,
      },
      connection: db,
      getConnector: () => ({}) as unknown as PowerSyncBackendConnector,
      signal: new AbortController().signal,
      database: mockDatabase,
    });

    // 1. Primera reanudación autorizada -> Una llamada a connect()
    await controller.resume(false);
    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(disconnectSpy).toHaveBeenCalledTimes(0);
    expect(controller.isConnected()).toBe(true);

    // 2. Paso a segundo plano -> Una llamada a disconnect()
    await controller.disconnect();
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(controller.isConnected()).toBe(false);

    // 3. Regreso a primer plano -> Segunda llamada a connect()
    await controller.resume(false);
    expect(connectSpy).toHaveBeenCalledTimes(2);
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(controller.isConnected()).toBe(true);
  });

  it('coordina varias reanudaciones simultáneas sin conexiones duplicadas', async () => {
    const db = harness.open();
    await db.exec('CREATE TABLE qc_storage_control(id TEXT PRIMARY KEY, value_json TEXT)');
    await db.exec(
      'CREATE TABLE qc_clinical_command(id TEXT PRIMARY KEY,owner TEXT,environment TEXT,status TEXT,error_json TEXT,payload_json TEXT,captured_at TEXT)',
    );
    let resolveConnect: () => void = () => undefined;
    const connectPromise = new Promise<void>((resolve) => {
      resolveConnect = resolve;
    });
    const connectSpy = vi.fn().mockImplementation(() => connectPromise);
    const disconnectSpy = vi.fn().mockResolvedValue(undefined);
    const mockDatabase = { connect: connectSpy, disconnect: disconnectSpy };

    const store = { closed: false, pauseCode: null as string | null };
    const controller = createClinicalConnectionController({
      store,
      scope: { owner: 'user-1', localPatientId: 'pac-1', environment: 'env-test' },
      endpoint: 'https://sync.example.com',
      session: {
        getCurrentUser: () =>
          ({ id: 'user-1' }) as ReturnType<HttpSessionAdapter['getCurrentUser']>,
        getSnapshot: () =>
          ({ uploadAllowed: true }) as ReturnType<HttpSessionAdapter['getSnapshot']>,
      },
      connection: db,
      getConnector: () => ({}) as unknown as PowerSyncBackendConnector,
      signal: new AbortController().signal,
      database: mockDatabase,
    });

    // Disparar tres llamadas concurrentes a resume
    const p1 = controller.resume(false);
    const p2 = controller.resume(false);
    const p3 = controller.resume(false);

    await Promise.resolve();
    await Promise.resolve();
    expect(connectSpy).toHaveBeenCalledTimes(1);

    resolveConnect();
    await Promise.all([p1, p2, p3]);

    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(controller.isConnected()).toBe(true);
  });

  it('aborta la conexión si ocurre una pausa o revocación durante la transición de connect', async () => {
    const db = harness.open();
    await db.exec('CREATE TABLE qc_storage_control(id TEXT PRIMARY KEY, value_json TEXT)');
    await db.exec(
      'CREATE TABLE qc_clinical_command(id TEXT PRIMARY KEY,owner TEXT,environment TEXT,status TEXT,error_json TEXT,payload_json TEXT,captured_at TEXT)',
    );
    let resolveConnect: () => void = () => undefined;
    const connectPromise = new Promise<void>((resolve) => {
      resolveConnect = resolve;
    });
    const connectSpy = vi.fn().mockImplementation(() => connectPromise);
    const disconnectSpy = vi.fn().mockResolvedValue(undefined);
    const mockDatabase = { connect: connectSpy, disconnect: disconnectSpy };

    const store = { closed: false, pauseCode: null as string | null };
    const controller = createClinicalConnectionController({
      store,
      scope: { owner: 'user-1', localPatientId: 'pac-1', environment: 'env-test' },
      endpoint: 'https://sync.example.com',
      session: {
        getCurrentUser: () =>
          ({ id: 'user-1' }) as ReturnType<HttpSessionAdapter['getCurrentUser']>,
        getSnapshot: () =>
          ({ uploadAllowed: true }) as ReturnType<HttpSessionAdapter['getSnapshot']>,
      },
      connection: db,
      getConnector: () => ({}) as unknown as PowerSyncBackendConnector,
      signal: new AbortController().signal,
      database: mockDatabase,
    });

    const resumePromise = controller.resume(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(connectSpy).toHaveBeenCalledTimes(1);

    // Ocurre una pausa durante la transición asíncrona
    store.pauseCode = 'SESION_EXPIRED';

    resolveConnect();
    await resumePromise;

    // Debe haberse ejecutado disconnect() inmediatamente y no quedar conectado
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(controller.isConnected()).toBe(false);
  });

  it('aborta y desconecta limpiamente si se solicita disconnect() o se cierra el almacén durante la transición', async () => {
    const db = harness.open();
    await db.exec('CREATE TABLE qc_storage_control(id TEXT PRIMARY KEY, value_json TEXT)');
    await db.exec(
      'CREATE TABLE qc_clinical_command(id TEXT PRIMARY KEY,owner TEXT,environment TEXT,status TEXT,error_json TEXT,payload_json TEXT,captured_at TEXT)',
    );
    let resolveConnect: () => void = () => undefined;
    const connectPromise = new Promise<void>((resolve) => {
      resolveConnect = resolve;
    });
    const connectSpy = vi.fn().mockImplementation(() => connectPromise);
    const disconnectSpy = vi.fn().mockResolvedValue(undefined);
    const mockDatabase = { connect: connectSpy, disconnect: disconnectSpy };

    const store = { closed: false, pauseCode: null as string | null };
    const controller = createClinicalConnectionController({
      store,
      scope: { owner: 'user-1', localPatientId: 'pac-1', environment: 'env-test' },
      endpoint: 'https://sync.example.com',
      session: {
        getCurrentUser: () =>
          ({ id: 'user-1' }) as ReturnType<HttpSessionAdapter['getCurrentUser']>,
        getSnapshot: () =>
          ({ uploadAllowed: true }) as ReturnType<HttpSessionAdapter['getSnapshot']>,
      },
      connection: db,
      getConnector: () => ({}) as unknown as PowerSyncBackendConnector,
      signal: new AbortController().signal,
      database: mockDatabase,
    });

    const resumePromise = controller.resume(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(connectSpy).toHaveBeenCalledTimes(1);

    // Se solicita desconexión mientras connect está en vuelo
    const disconnectPromise = controller.disconnect();

    resolveConnect();
    await Promise.all([resumePromise, disconnectPromise]);

    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(controller.isConnected()).toBe(false);
  });
});
