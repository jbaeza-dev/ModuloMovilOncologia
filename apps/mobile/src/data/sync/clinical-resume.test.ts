import { describe, expect, it, vi } from 'vitest';
import type { PowerSyncBackendConnector } from '@powersync/common';
import {
  createClinicalConnectionController,
  createClinicalResume,
  type ClinicalConnectionControllerOptions,
} from './clinical-resume';

const owner = '11111111-1111-4111-8111-111111111111';

function preparar(over: Partial<ClinicalConnectionControllerOptions> = {}) {
  const sql: string[] = [];
  const estado = { user: owner as string | null, uploadAllowed: true };
  const store = { closed: false, pauseCode: null as string | null };
  const controlador = new AbortController();
  const uploadData = vi.fn(async () => undefined);
  const database = {
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
  };
  const options: ClinicalConnectionControllerOptions = {
    store,
    scope: { owner, environment: 'demo' } as ClinicalConnectionControllerOptions['scope'],
    endpoint: 'https://sync.example',
    session: {
      getCurrentUser: () => (estado.user ? ({ id: estado.user } as never) : null),
      getSnapshot: () => ({ uploadAllowed: estado.uploadAllowed }) as never,
    },
    connection: { run: vi.fn(async (q: string) => void sql.push(q)) as never },
    getConnector: () => ({ uploadData }) as unknown as PowerSyncBackendConnector,
    signal: controlador.signal,
    database,
    clearPauseTimer: vi.fn(),
    ...over,
  };
  return { options, sql, estado, store, controlador, database, uploadData };
}

describe('controlador de conexión clínica', () => {
  it('conecta, libera pausas y no duplica conexiones concurrentes', async () => {
    const t = preparar();
    const c = createClinicalConnectionController(t.options);
    await Promise.all([c.resume(), c.resume()]);
    expect(t.database.connect).toHaveBeenCalledTimes(1);
    expect(c.isConnected()).toBe(true);
    expect(t.sql.some((q) => q.includes("SET status='pendiente'"))).toBe(true);
    expect(t.options.clearPauseTimer).toHaveBeenCalled();
  });

  it('no reanuda si el almacén está cerrado, se abortó o cambió el usuario', async () => {
    for (const ajuste of [
      (t: ReturnType<typeof preparar>) => (t.store.closed = true),
      (t: ReturnType<typeof preparar>) => t.controlador.abort(),
      (t: ReturnType<typeof preparar>) => (t.estado.user = 'otro'),
    ]) {
      const t = preparar();
      ajuste(t);
      await createClinicalConnectionController(t.options).resume();
      expect(t.database.connect).not.toHaveBeenCalled();
    }
  });

  it('sin endpoint marca la falta de configuración', async () => {
    const t = preparar({ endpoint: null });
    await createClinicalConnectionController(t.options).resume();
    expect(t.store.pauseCode).toBe('SIN_CONFIGURACION');
    expect(t.database.connect).not.toHaveBeenCalled();
  });

  it('en modo sesión reintenta solo con autorización vigente', async () => {
    const sinPermiso = preparar();
    sinPermiso.estado.uploadAllowed = false;
    await createClinicalConnectionController(sinPermiso.options).resume('session');
    expect(sinPermiso.database.connect).not.toHaveBeenCalled();

    const conPermiso = preparar();
    conPermiso.store.pauseCode = 'SESION_EXPIRED';
    await createClinicalConnectionController(conPermiso.options).resume('session');
    expect(conPermiso.store.pauseCode).toBeNull();
    expect(conPermiso.database.connect).toHaveBeenCalledTimes(1);
  });

  it('sin reintento conserva una pausa activa y no conecta', async () => {
    const t = preparar();
    t.store.pauseCode = 'RECHAZO';
    await createClinicalConnectionController(t.options).resume(false);
    expect(t.database.connect).not.toHaveBeenCalled();
    expect(t.sql).toEqual([]);

    const libre = preparar();
    await createClinicalConnectionController(libre.options).resume(false);
    expect(libre.sql).toEqual(["DELETE FROM qc_storage_control WHERE id='runtime:pause'"]);
    expect(libre.database.connect).toHaveBeenCalled();
  });

  it('no conecta si la carga no está autorizada', async () => {
    const t = preparar();
    t.estado.uploadAllowed = false;
    await createClinicalConnectionController(t.options).resume(true);
    expect(t.database.connect).not.toHaveBeenCalled();
  });

  it('propaga un error de conexión y permite reintentar después', async () => {
    const t = preparar();
    t.database.connect.mockRejectedValueOnce(new Error('sin red'));
    const c = createClinicalConnectionController(t.options);
    await expect(c.resume()).rejects.toThrow('sin red');
    expect(c.isConnected()).toBe(false);
    await c.resume();
    expect(c.isConnected()).toBe(true);
  });

  it('desconecta si la autorización cambia mientras conectaba', async () => {
    const t = preparar();
    t.database.connect.mockImplementationOnce(async () => {
      t.estado.uploadAllowed = false;
    });
    const c = createClinicalConnectionController(t.options);
    await c.resume();
    expect(c.isConnected()).toBe(false);
    expect(t.database.disconnect).toHaveBeenCalled();
  });

  it('ya conectado, el modo sesión reintenta comandos pausados solo con permiso', async () => {
    const t = preparar();
    const c = createClinicalConnectionController(t.options);
    await c.resume();
    t.sql.length = 0;
    await c.resume('session');
    expect(t.sql.length).toBeGreaterThan(0);
    t.sql.length = 0;
    t.estado.uploadAllowed = false;
    await c.resume('session');
    expect(t.sql).toEqual([]);
    await c.resume(true);
    expect(t.database.connect).toHaveBeenCalledTimes(1);
  });

  it('la desconexión espera una reanudación en curso y se comparte entre llamadas', async () => {
    const t = preparar();
    let liberar!: () => void;
    t.database.connect.mockImplementationOnce(
      () => new Promise<undefined>((r) => (liberar = () => r(undefined))),
    );
    const c = createClinicalConnectionController(t.options);
    const reanudar = c.resume();
    await vi.waitFor(() => expect(t.database.connect).toHaveBeenCalled());
    const d1 = c.disconnect();
    const d2 = c.disconnect();
    liberar();
    await Promise.all([reanudar, d1, d2]);
    expect(c.isConnected()).toBe(false);
  });

  it('una reanudación espera la desconexión en curso', async () => {
    const t = preparar();
    const c = createClinicalConnectionController(t.options);
    await c.resume();
    let liberar!: () => void;
    t.database.disconnect.mockImplementationOnce(
      () => new Promise<undefined>((r) => (liberar = () => r(undefined))),
    );
    const d = c.disconnect();
    const r = c.resume();
    liberar();
    await Promise.all([d, r]);
    expect(t.database.disconnect).toHaveBeenCalledTimes(1);
    expect(c.isConnected()).toBe(true);
  });

  it('desconectar sin conexión no llama a la base', async () => {
    const t = preparar();
    await createClinicalConnectionController(t.options).disconnect();
    expect(t.database.disconnect).not.toHaveBeenCalled();
  });

  it('la subida pendiente reanuda si no hay conexión y sube si ya hay', async () => {
    const t = preparar();
    const c = createClinicalConnectionController(t.options);
    await c.triggerPendingUpload();
    expect(c.isConnected()).toBe(true);
    await c.triggerPendingUpload();
    expect(t.uploadData).toHaveBeenCalledTimes(1);
    t.uploadData.mockRejectedValueOnce(new Error('pausa clínica'));
    await expect(c.triggerPendingUpload()).resolves.toBeUndefined();
  });

  it('la subida pendiente no actúa con pausa, sin permiso o con otro usuario', async () => {
    for (const ajuste of [
      (t: ReturnType<typeof preparar>) => (t.store.pauseCode = 'RECHAZO'),
      (t: ReturnType<typeof preparar>) => (t.estado.uploadAllowed = false),
      (t: ReturnType<typeof preparar>) => (t.estado.user = null),
    ]) {
      const t = preparar();
      ajuste(t);
      await createClinicalConnectionController(t.options).triggerPendingUpload();
      expect(t.database.connect).not.toHaveBeenCalled();
    }
  });

  it('la subida tolera un conector sin uploadData', async () => {
    const t = preparar({ getConnector: () => ({}) as PowerSyncBackendConnector });
    const c = createClinicalConnectionController(t.options);
    await c.resume();
    await expect(c.triggerPendingUpload()).resolves.toBeUndefined();
  });

  it('createClinicalResume expone la reanudación compatible', async () => {
    const t = preparar();
    await createClinicalResume(t.options)();
    expect(t.database.connect).toHaveBeenCalledTimes(1);
  });
});
