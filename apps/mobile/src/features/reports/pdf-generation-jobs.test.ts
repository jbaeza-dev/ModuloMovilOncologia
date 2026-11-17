import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearPdfJobs,
  getPdfJob,
  PDF_PRINT_ATTEMPTS,
  PDF_PRINT_TIMEOUT_MS,
  retryOnTimeout,
  startPdfJob,
  TimeoutError,
  withTimeout,
} from './pdf-generation-jobs';
import { clearRenderedPdf, rememberRenderedPdf, takeRenderedPdf } from './rendered-pdf-cache';

const resultado = { persistentUri: '/r/a.pdf', filename: 'a.pdf' };

describe('generaciones de PDF en curso', () => {
  afterEach(() => clearPdfJobs());

  it('entrega el trabajo solo al paciente que lo inició', async () => {
    const job = startPdfJob('paciente-a', () => Promise.resolve(resultado));
    expect(job.id).toMatch(/^pdf-/);
    await expect(getPdfJob(job.id, 'paciente-a')).resolves.toEqual(resultado);
    expect(getPdfJob(job.id, 'paciente-b')).toBeNull();
    expect(getPdfJob(undefined, 'paciente-a')).toBeNull();
    expect(getPdfJob(job.id, null)).toBeNull();
  });

  it('conserva solo los tres trabajos más recientes', () => {
    const ids = [1, 2, 3, 4].map(() => startPdfJob('p', () => Promise.resolve(resultado)).id);
    expect(getPdfJob(ids[0], 'p')).toBeNull();
    expect(ids.slice(1).every((id) => getPdfJob(id, 'p') !== null)).toBe(true);
  });

  it('un trabajo fallido no deja un rechazo sin atender y lo entrega a quien espera', async () => {
    const job = startPdfJob('p', () => Promise.reject(new Error('sin espacio')));
    await expect(job.promise).rejects.toThrow('sin espacio');
  });
});

describe('límite de tiempo de la impresión del PDF', () => {
  afterEach(() => vi.useRealTimers());

  // En un Redmi 13C la impresión no respondió y el visor quedó «Generando…» hasta reiniciar la app.
  it('si la impresión nunca responde, rechaza al cumplirse el límite', async () => {
    vi.useFakeTimers();
    const nunca = new Promise<string>(() => undefined);
    const resultado = withTimeout(nunca, PDF_PRINT_TIMEOUT_MS, 'no respondió');
    const verificacion = expect(resultado).rejects.toThrow(TimeoutError);
    await vi.advanceTimersByTimeAsync(PDF_PRINT_TIMEOUT_MS);
    await verificacion;
  });

  it('el límite deja margen de sobra sobre las generaciones medidas (máximo 1,23 s)', () => {
    expect(PDF_PRINT_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
    expect(PDF_PRINT_ATTEMPTS).toBe(2);
  });

  // Se reprodujo en el teléfono: la primera impresión tras instalar no responde y las siguientes sí.
  it('si el primer intento no responde, reintenta y entrega el PDF del segundo', async () => {
    vi.useFakeTimers();
    const run = vi
      .fn<() => Promise<string>>()
      .mockReturnValueOnce(new Promise(() => undefined))
      .mockResolvedValueOnce('pdf');
    const resultado = retryOnTimeout(run, { attempts: 2, timeoutMs: 15_000, message: 'x' });
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(resultado).resolves.toBe('pdf');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('si ningún intento responde, rechaza tras el último y no sigue intentando', async () => {
    vi.useFakeTimers();
    const run = vi.fn(() => new Promise<string>(() => undefined));
    const resultado = retryOnTimeout(run, {
      attempts: 2,
      timeoutMs: 15_000,
      message: 'no respondió',
    });
    const verificacion = expect(resultado).rejects.toThrow('no respondió');
    await vi.advanceTimersByTimeAsync(30_000);
    await verificacion;
    expect(run).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('un error distinto de no responder (por ejemplo, sin espacio) no se reintenta', async () => {
    const run = vi.fn(() => Promise.reject(new Error('sin espacio')));
    await expect(
      retryOnTimeout(run, { attempts: 2, timeoutMs: 15_000, message: 'x' }),
    ).rejects.toThrow('sin espacio');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('entrega el resultado y el error originales si la impresión termina a tiempo', async () => {
    vi.useFakeTimers();
    await expect(withTimeout(Promise.resolve('pdf'), 1_000, 'x')).resolves.toBe('pdf');
    await expect(withTimeout(Promise.reject(new Error('sin espacio')), 1_000, 'x')).rejects.toThrow(
      'sin espacio',
    );
    // Sin temporizadores pendientes: no queda un rechazo tardío.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('una impresión que termina justo antes del límite no se rechaza', async () => {
    vi.useFakeTimers();
    const tarda = new Promise<string>((resolve) =>
      setTimeout(() => resolve('pdf'), PDF_PRINT_TIMEOUT_MS - 1_000),
    );
    const resultado = withTimeout(tarda, PDF_PRINT_TIMEOUT_MS, 'no respondió');
    await vi.advanceTimersByTimeAsync(PDF_PRINT_TIMEOUT_MS - 1_000);
    await expect(resultado).resolves.toBe('pdf');
  });
});

describe('PDF recién generado en memoria', () => {
  afterEach(() => clearRenderedPdf());

  it('se entrega una sola vez y solo a la misma ruta y paciente', () => {
    rememberRenderedPdf('/r/a.pdf', 'p', 'JVBERi0=');
    expect(takeRenderedPdf('/r/a.pdf', 'otro')).toBeNull();
    rememberRenderedPdf('/r/a.pdf', 'p', 'JVBERi0=');
    expect(takeRenderedPdf('/r/a.pdf', 'p')).toBe('JVBERi0=');
    expect(takeRenderedPdf('/r/a.pdf', 'p')).toBeNull();
  });

  it('no guarda nada si no hay contenido y descarta datos incompletos', () => {
    rememberRenderedPdf('/r/a.pdf', 'p', undefined);
    expect(takeRenderedPdf('/r/a.pdf', 'p')).toBeNull();
    rememberRenderedPdf('/r/a.pdf', 'p', 'JVBERi0=');
    expect(takeRenderedPdf(null, 'p')).toBeNull();
    expect(takeRenderedPdf('/r/a.pdf', 'p')).toBeNull();
  });
});
