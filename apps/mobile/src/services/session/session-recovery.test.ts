import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionRecovery, needsSessionRecovery } from './session-recovery';
import type { SessionSnapshot } from './http-session-types';
const recoveries: SessionRecovery[] = [];
afterEach(() => {
  recoveries.splice(0).forEach((item) => item.dispose());
  vi.useRealTimers();
});
function harness(local = false) {
  vi.useFakeTimers();
  let snapshot: SessionSnapshot = {
    state: 'service_unavailable',
    user: { id: 'a', name: 'Prueba', isDemo: true, localPatientId: 'local-a' },
    identity: null,
    stale: true,
    terms: null,
    consent: null,
    uploadAllowed: false,
    message: null,
    revision: 0,
  };
  const listeners = new Set<() => void>();
  const update = (patch: Partial<SessionSnapshot>) => {
    snapshot = { ...snapshot, ...patch, revision: snapshot.revision + 1 };
    listeners.forEach((fn) => fn());
  };
  const refreshIdentity = vi.fn(async (): Promise<void> => {
    throw new Error('Sin conexión de prueba');
  });
  const recovery = new SessionRecovery(
    {
      getSnapshot: () => snapshot,
      subscribe: (fn) => {
        listeners.add(fn);
        return () => {
          listeners.delete(fn);
        };
      },
      refreshIdentity,
    },
    local,
  );
  recoveries.push(recovery);
  return { recovery, refreshIdentity, update };
}
describe('Recuperación automática de sesión sin interacción ni aceptación implícita', () => {
  it('reintenta con espera creciente y se detiene cuando vuelven los permisos', async () => {
    const h = harness();
    h.recovery.setForeground(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.refreshIdentity).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(h.refreshIdentity).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.refreshIdentity).toHaveBeenCalledTimes(2);
    h.refreshIdentity.mockImplementation(async () => {
      h.update({ state: 'context_ready', stale: false, uploadAllowed: true });
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.refreshIdentity).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(120000);
    expect(h.refreshIdentity).toHaveBeenCalledTimes(3);
  });
  it('recupera al volver la red y no sondea mientras el teléfono está sin red', async () => {
    const h = harness();
    h.recovery.setOnline(false);
    h.recovery.setForeground(true);
    await vi.advanceTimersByTimeAsync(120000);
    expect(h.refreshIdentity).not.toHaveBeenCalled();
    h.recovery.setOnline(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.refreshIdentity).toHaveBeenCalledTimes(1);
    h.recovery.setOnline(false);
    await vi.advanceTimersByTimeAsync(120000);
    expect(h.refreshIdentity).toHaveBeenCalledTimes(1);
  });
  it('no repite llamadas en segundo plano ni después de desmontarse', async () => {
    const h = harness();
    h.recovery.setForeground(true);
    await vi.advanceTimersByTimeAsync(0);
    h.recovery.setForeground(false);
    await vi.advanceTimersByTimeAsync(120000);
    expect(h.refreshIdentity).toHaveBeenCalledTimes(1);
    h.recovery.setForeground(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.refreshIdentity).toHaveBeenCalledTimes(2);
    h.recovery.dispose();
    await vi.advanceTimersByTimeAsync(120000);
    expect(h.refreshIdentity).toHaveBeenCalledTimes(2);
  });
  it.each(['expired', 'access_denied', 'terms_pending', 'profile_incomplete'] as const)(
    'no reintenta automáticamente el estado que requiere decisión %s',
    async (state) => {
      const h = harness();
      h.update({ state, stale: false });
      h.recovery.setForeground(true);
      await vi.advanceTimersByTimeAsync(0);
      const initial = h.refreshIdentity.mock.calls.length;
      await vi.advanceTimersByTimeAsync(120000);
      expect(h.refreshIdentity).toHaveBeenCalledTimes(initial);
      if (state === 'expired' || state === 'access_denied') expect(initial).toBe(0);
    },
  );
  it('agrupa los avisos de red y primer plano mientras hay una lectura en curso', async () => {
    const h = harness();
    let release!: () => void;
    h.refreshIdentity.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    h.recovery.setForeground(true);
    await vi.advanceTimersByTimeAsync(0);
    h.recovery.setOnline(true);
    h.recovery.setForeground(false);
    h.recovery.setForeground(true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(h.refreshIdentity).toHaveBeenCalledTimes(1);
    h.update({ state: 'context_ready', stale: false, uploadAllowed: true });
    release();
    await vi.advanceTimersByTimeAsync(120000);
    expect(h.refreshIdentity).toHaveBeenCalledTimes(1);
  });
  it('conserva el transporte local de laboratorio aunque los radios indiquen desconexión', async () => {
    const h = harness(true);
    h.recovery.setOnline(false);
    h.recovery.setForeground(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.refreshIdentity).toHaveBeenCalledTimes(1);
  });
  it('el cambio a una cuenta sin sesión elimina el reintento pendiente', async () => {
    const h = harness();
    h.recovery.setForeground(true);
    await vi.advanceTimersByTimeAsync(0);
    h.update({ user: null, state: 'no_identity' });
    await vi.advanceTimersByTimeAsync(120000);
    expect(h.refreshIdentity).toHaveBeenCalledTimes(1);
  });
  it('recupera automáticamente cuando el usuario está en clinical_incomplete esperando vinculación', async () => {
    const h = harness();
    h.update({ state: 'clinical_incomplete', stale: false, uploadAllowed: false });
    h.recovery.setForeground(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.refreshIdentity).toHaveBeenCalledTimes(1);
    h.refreshIdentity.mockImplementation(async () => {
      h.update({ state: 'context_ready', stale: false, uploadAllowed: true });
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.refreshIdentity).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60000);
    expect(h.refreshIdentity).toHaveBeenCalledTimes(2);
  });
});

it('conserva el intervalo creciente aunque el token pase por renovando antes de cada fallo', async () => {
  const h = harness();
  h.refreshIdentity.mockImplementation(async () => {
    h.update({ state: 'renewing' });
    h.update({ state: 'service_unavailable', stale: true, uploadAllowed: false });
    throw new Error('Renovación temporalmente inaccesible');
  });
  h.recovery.setForeground(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(h.refreshIdentity).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(2000);
  expect(h.refreshIdentity).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(2000);
  expect(h.refreshIdentity).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(3000);
  expect(h.refreshIdentity).toHaveBeenCalledTimes(3);
});

describe('needsSessionRecovery y condiciones de elegibilidad', () => {
  const snap = (patch: Partial<SessionSnapshot>): SessionSnapshot => ({
    state: 'context_ready',
    user: { id: 'a', name: 'Prueba', isDemo: true, localPatientId: 'local-a' },
    identity: null,
    stale: false,
    terms: null,
    consent: null,
    uploadAllowed: true,
    message: null,
    revision: 0,
    ...patch,
  });
  it('solo recupera con usuario y en estados recuperables', () => {
    expect(needsSessionRecovery(snap({}))).toBe(false);
    expect(needsSessionRecovery(snap({ stale: true }))).toBe(true);
    expect(needsSessionRecovery(snap({ uploadAllowed: false }))).toBe(true);
    expect(needsSessionRecovery(snap({ state: 'clinical_incomplete' }))).toBe(true);
    expect(needsSessionRecovery(snap({ state: 'service_unavailable', user: null }))).toBe(false);
    expect(needsSessionRecovery(snap({ state: 'expired' }))).toBe(false);
  });

  it('no reintenta en estados bloqueados, sin conexión o en segundo plano', async () => {
    const h = harness();
    h.update({ state: 'expired' });
    h.recovery.setForeground(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.refreshIdentity).not.toHaveBeenCalled();
    h.update({ state: 'service_unavailable' });
    h.recovery.setOnline(false);
    await vi.advanceTimersByTimeAsync(60000);
    expect(h.refreshIdentity).not.toHaveBeenCalled();
    h.recovery.setOnline(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.refreshIdentity).toHaveBeenCalledTimes(1);
    h.recovery.setForeground(false);
    await vi.advanceTimersByTimeAsync(60000);
    expect(h.refreshIdentity).toHaveBeenCalledTimes(1);
  });

  it('con transporte local sigue reintentando aunque el sistema informe sin red', async () => {
    const h = harness(true);
    h.recovery.setForeground(true);
    h.recovery.setOnline(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.refreshIdentity).toHaveBeenCalled();
  });

  it('el cambio de cuenta reinicia los intentos y un contexto sano los limpia', async () => {
    const h = harness();
    h.recovery.setForeground(true);
    await vi.advanceTimersByTimeAsync(0);
    h.update({ user: { id: 'b', name: 'Otra', isDemo: true, localPatientId: 'local-b' } });
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.refreshIdentity.mock.calls.length).toBeGreaterThanOrEqual(2);
    h.update({ state: 'context_ready', stale: false, uploadAllowed: true });
    const llamadas = h.refreshIdentity.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120000);
    expect(h.refreshIdentity).toHaveBeenCalledTimes(llamadas);
  });

  it('después de desechar no vuelve a intentar', async () => {
    const h = harness();
    h.recovery.dispose();
    h.recovery.setForeground(true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(h.refreshIdentity).not.toHaveBeenCalled();
  });
});
