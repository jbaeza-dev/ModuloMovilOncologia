import { describe, expect, it, vi } from 'vitest';
import { reconcileActiveAgenda } from './active-agenda';

describe('instancia de agenda vigente durante registro y recuperación', () => {
  it('no anuncia programación cuando aún no hay una instancia activa', async () => {
    expect(
      await reconcileActiveAgenda(
        () => null,
        () => {},
      ),
    ).toBeUndefined();
  });
  it('usa la sustituta si la anterior se cerró durante la operación', async () => {
    const next = { reconcile: vi.fn(async () => 2) };
    let active = {
      reconcile: vi.fn(async () => {
        active = next;
        throw new Error('Coordinador de agenda cerrado.');
      }),
    };
    expect(
      await reconcileActiveAgenda(
        () => active,
        () => {},
      ),
    ).toBe(2);
    expect(next.reconcile).toHaveBeenCalledTimes(1);
  });
  it('descarta la cobertura de una instancia reemplazada aunque no haya lanzado error', async () => {
    const next = { reconcile: vi.fn(async () => 2) };
    let active = {
      reconcile: vi.fn(async () => {
        active = next;
        return 1;
      }),
    };
    expect(
      await reconcileActiveAgenda(
        () => active,
        () => {},
      ),
    ).toBe(2);
  });
  it('conserva los errores reales de una instancia que no cambió', async () => {
    const failure = new Error('Falló el permiso nativo');
    const active = {
      reconcile: vi.fn(async () => {
        throw failure;
      }),
    };
    await expect(
      reconcileActiveAgenda(
        () => active,
        () => {},
      ),
    ).rejects.toBe(failure);
    expect(active.reconcile).toHaveBeenCalledTimes(1);
  });
  it('no sigue una sustitución que coincide con un cambio de cuenta', async () => {
    let sameAccount = true;
    const next = { reconcile: vi.fn(async () => 2) };
    let active = {
      reconcile: vi.fn(async () => {
        active = next;
        sameAccount = false;
        return 1;
      }),
    };
    await expect(
      reconcileActiveAgenda(
        () => active,
        () => {
          if (!sameAccount) throw new Error('Cuenta distinta');
        },
      ),
    ).rejects.toThrow('Cuenta distinta');
    expect(next.reconcile).not.toHaveBeenCalled();
  });
  it('limita las sustituciones continuas y no confirma una cobertura obsoleta', async () => {
    const factory = (): { reconcile: () => Promise<number> } => ({
      reconcile: async () => {
        active = factory();
        return 1;
      },
    });
    let active = factory();
    await expect(
      reconcileActiveAgenda(
        () => active,
        () => {},
      ),
    ).rejects.toThrow('Vuelve a intentarlo');
  });
});
