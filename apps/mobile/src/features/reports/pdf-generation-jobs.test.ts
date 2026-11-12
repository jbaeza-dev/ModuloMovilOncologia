import { afterEach, describe, expect, it } from 'vitest';
import { clearPdfJobs, getPdfJob, startPdfJob } from './pdf-generation-jobs';
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
