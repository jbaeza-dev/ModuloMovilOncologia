import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormDraftController, type FormDraftIdentity } from './form-draft-controller';

describe('FormDraftController', () => {
  const identity: FormDraftIdentity = {
    formId: 'form-daily-test',
    version: '1.0.0',
    periodoClave: 'dia:2026-10-18',
    deliveryId: 'del-uuid-1',
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aplica debounce a llamadas consecutivas y guarda el último estado', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onConfirm = vi.fn().mockResolvedValue('del-uuid-1');

    const controller = new FormDraftController({
      identity,
      onSave,
      onConfirm,
      debounceMs: 300,
    });

    controller.queueSave({ P10: 'H' });
    controller.queueSave({ P10: 'Ho' });
    controller.queueSave({ P10: 'Hola' });

    expect(onSave).not.toHaveBeenCalled();

    // Avanzar tiempo por debajo del debounce
    vi.advanceTimersByTime(200);
    expect(onSave).not.toHaveBeenCalled();

    // Completar el tiempo de debounce
    await vi.advanceTimersByTimeAsync(150);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(
      { formId: identity.formId, version: identity.version, periodoClave: identity.periodoClave },
      { P10: 'Hola' },
      undefined,
    );
  });

  it('ejecuta inmediatamente cuando immediate = true', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onConfirm = vi.fn().mockResolvedValue('del-uuid-1');

    const controller = new FormDraftController({
      identity,
      onSave,
      onConfirm,
      debounceMs: 300,
    });

    controller.queueSave({ P1: 'si' }, 'sec-1', true);
    await vi.runAllTimersAsync();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(
      { formId: identity.formId, version: identity.version, periodoClave: identity.periodoClave },
      { P1: 'si' },
      'sec-1',
    );
  });

  it('serializa escrituras evitando concurrencia sobre la base de datos', async () => {
    let activeCalls = 0;
    let maxConcurrent = 0;

    const onSave = vi.fn().mockImplementation(async () => {
      activeCalls++;
      maxConcurrent = Math.max(maxConcurrent, activeCalls);
      await new Promise((res) => setTimeout(res, 50));
      activeCalls--;
    });
    const onConfirm = vi.fn().mockResolvedValue('del-uuid-1');

    const controller = new FormDraftController({
      identity,
      onSave,
      onConfirm,
      debounceMs: 10,
    });

    controller.queueSave({ P1: '1' }, undefined, true);
    controller.queueSave({ P1: '2' }, undefined, true);

    await vi.runAllTimersAsync();

    expect(maxConcurrent).toBe(1);
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it('flush vacía inmediatamente cualquier escritura pendiente', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onConfirm = vi.fn().mockResolvedValue('del-uuid-1');

    const controller = new FormDraftController({
      identity,
      onSave,
      onConfirm,
      debounceMs: 500,
    });

    controller.queueSave({ P10: 'Pendiente' });
    expect(onSave).not.toHaveBeenCalled();

    await controller.flush();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(expect.anything(), { P10: 'Pendiente' }, undefined);
  });

  it('confirmación cancela escrituras pendientes y bloquea llamadas posteriores de autosave', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onConfirm = vi.fn().mockResolvedValue('del-uuid-1');

    const controller = new FormDraftController({
      identity,
      onSave,
      onConfirm,
      debounceMs: 300,
    });

    controller.queueSave({ P10: 'Texto en tipeo' });

    // Confirmar entrega
    const resultId = await controller.confirm({ P1: 'si', P10: 'Final' });
    expect(resultId).toBe('del-uuid-1');
    expect(onConfirm).toHaveBeenCalledTimes(1);

    // El guardado pendiente no debe haberse ejecutado después de confirmar
    await vi.runAllTimersAsync();
    expect(onSave).not.toHaveBeenCalled();

    // Intentar guardar después de la confirmación es un no-op
    controller.queueSave({ P10: 'Intento tardío' }, undefined, true);
    await vi.runAllTimersAsync();
    expect(onSave).not.toHaveBeenCalled();

    expect(controller.getStatus().isConfirmed).toBe(true);
  });

  it('dispara onSaveSuccess cuando el guardado es exitoso y onSaveError cuando falla', async () => {
    const onSave = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Fallo de SQLite'));
    const onConfirm = vi.fn().mockResolvedValue('del-uuid-1');
    const onSaveSuccess = vi.fn();
    const onSaveError = vi.fn();

    const controller = new FormDraftController({
      identity,
      onSave,
      onConfirm,
      onSaveSuccess,
      onSaveError,
      debounceMs: 10,
    });

    // 1. Guardado exitoso
    controller.queueSave({ P1: 'si' }, 'sec-1', true);
    await vi.runAllTimersAsync();
    expect(onSaveSuccess).toHaveBeenCalledTimes(1);
    expect(onSaveError).not.toHaveBeenCalled();

    // 2. Guardado fallido
    controller.queueSave({ P1: 'no' }, 'sec-1', true);
    await vi.runAllTimersAsync();
    expect(onSaveError).toHaveBeenCalledTimes(1);
    expect(onSaveError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('flush rechaza si el guardado falla, conserva hasPending en true y permite reintentar con éxito', async () => {
    const errorSqlite = new Error('Disk I/O error');
    const onSave = vi.fn().mockRejectedValueOnce(errorSqlite).mockResolvedValueOnce(undefined);
    const onConfirm = vi.fn().mockResolvedValue('del-uuid-1');

    const controller = new FormDraftController({
      identity,
      onSave,
      onConfirm,
      debounceMs: 200,
    });

    controller.queueSave({ P10: 'Comentario no guardado' }, 'sec-10');
    expect(controller.getStatus().hasPending).toBe(true);

    // flush debe intentar la escritura pendiente y fallar arrojando el error
    await expect(controller.flush()).rejects.toThrow('Disk I/O error');
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(controller.getStatus().hasPending).toBe(true);

    // Reintentar guardado exitosamente
    controller.queueSave({ P10: 'Comentario no guardado' }, 'sec-10', true);
    await controller.flush();
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(controller.getStatus().hasPending).toBe(false);
  });
});
