import { afterEach, describe, expect, it, vi } from 'vitest';
import { devWarn } from './dev-warn';

const global = globalThis as { __DEV__?: boolean };

describe('devWarn', () => {
  afterEach(() => {
    global.__DEV__ = true;
    vi.restoreAllMocks();
  });

  it('en el APK no escribe nada en el registro del teléfono', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    global.__DEV__ = false;
    devWarn('No se pudo cerrar la sesión.', new Error('token=secreto'));
    expect(warn).not.toHaveBeenCalled();
  });

  it('en desarrollo muestra el mensaje y el error', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = new Error('falla');
    devWarn('No se pudo cerrar la sesión.', error);
    expect(warn).toHaveBeenCalledWith('No se pudo cerrar la sesión.', error);
  });

  it('en desarrollo, sin error, muestra solo el mensaje', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    devWarn('Aviso.');
    expect(warn).toHaveBeenCalledWith('Aviso.');
  });
});
