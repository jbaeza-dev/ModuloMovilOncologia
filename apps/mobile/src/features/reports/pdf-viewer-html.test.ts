import { runInNewContext } from 'node:vm';
import { expect, it, vi } from 'vitest';
import { buildPdfJsHtml } from './pdf-viewer-html';

it('fits the actual PDF page to the viewport and allows zoom and refitting after resize', async () => {
  const messages: Array<{ current: number; zoom: number }> = [];
  const canvas = {
    width: 0,
    height: 0,
    style: {} as Record<string, string>,
    getContext: () => ({}),
  };
  const elements = { 'pdf-canvas': canvas, 'status-msg': { style: {} }, 'page-box': { style: {} } };
  const render = vi.fn().mockReturnValue({ promise: Promise.resolve() });
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    render,
  };
  const callbacks: Record<string, () => void> = {};
  const window: Record<string, unknown> = {
    innerWidth: 360,
    devicePixelRatio: 3,
    ReactNativeWebView: { postMessage: (value: string) => messages.push(JSON.parse(value)) },
    addEventListener: (event: string, callback: () => void) => {
      callbacks[event] = callback;
    },
  };
  const html = buildPdfJsHtml('JVBERi0=');
  const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)![1];
  runInNewContext(script, {
    window,
    document: { getElementById: (id: keyof typeof elements) => elements[id] },
    atob: (text: string) => Buffer.from(text, 'base64').toString('binary'),
    pdfjsLib: {
      GlobalWorkerOptions: {},
      getDocument: () => ({ promise: Promise.resolve({ numPages: 2, getPage: async () => page }) }),
    },
  });
  const flush = async () => {
    for (let n = 0; n < 8; n++) await Promise.resolve();
  };
  await flush();
  expect(Number.parseInt(canvas.style.width)).toBe(344);
  (window.zoomIn as () => void)();
  await flush();
  expect(Number.parseInt(canvas.style.width)).toBeGreaterThan(344);
  expect(messages.at(-1)?.zoom).toBe(1.25);
  (window.resetZoom as () => void)();
  await flush();
  window.innerWidth = 800;
  callbacks.resize();
  await flush();
  expect(Number.parseInt(canvas.style.width)).toBe(784);
  expect(canvas.width * canvas.height).toBeLessThanOrEqual(4_000_000);
  (window.nextPage as () => void)();
  await flush();
  expect(messages.at(-1)?.current).toBe(2);
});

it('sin PDF prepara pdf.js y su worker, avisa READY y abre el documento al recibirlo', async () => {
  const messages: Array<{ type: string; total?: number }> = [];
  const canvas = {
    width: 0,
    height: 0,
    style: {} as Record<string, string>,
    getContext: () => ({}),
  };
  const status = { style: {} as Record<string, string>, innerText: '' };
  const elements = { 'pdf-canvas': canvas, 'status-msg': status, 'page-box': { style: {} } };
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
    render: () => ({ promise: Promise.resolve() }),
  };
  const getDocument = vi.fn().mockReturnValue({
    promise: Promise.resolve({ numPages: 4, getPage: async () => page }),
  });
  class PDFWorker {
    constructor(public options: unknown) {}
  }
  const window: Record<string, unknown> = {
    innerWidth: 360,
    devicePixelRatio: 2,
    ReactNativeWebView: { postMessage: (value: string) => messages.push(JSON.parse(value)) },
    addEventListener: () => undefined,
  };
  const html = buildPdfJsHtml();
  expect(html).toContain('Generando el reporte PDF…');
  const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)![1];
  runInNewContext(script, {
    window,
    document: { getElementById: (id: keyof typeof elements) => elements[id] },
    atob: (text: string) => Buffer.from(text, 'base64').toString('binary'),
    pdfjsLib: { GlobalWorkerOptions: {}, getDocument, PDFWorker },
  });
  expect(messages).toEqual([{ type: 'READY' }]);
  expect(getDocument).not.toHaveBeenCalled();
  (window.qcLoadPdf as (b64: string) => void)('JVBERi0=');
  for (let n = 0; n < 8; n++) await Promise.resolve();
  expect(getDocument.mock.calls[0][0].worker).toBeInstanceOf(PDFWorker);
  expect(getDocument.mock.calls[0][0].data).toBe('%PDF-');
  expect(messages.at(-1)).toMatchObject({ type: 'PAGE_UPDATE', total: 4, rendered: true });
});

it('informa un PDF que no se puede abrir', async () => {
  const messages: Array<{ type: string }> = [];
  const status = { style: {}, innerText: '' };
  const html = buildPdfJsHtml();
  const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)![1];
  const window: Record<string, unknown> = {
    ReactNativeWebView: { postMessage: (value: string) => messages.push(JSON.parse(value)) },
    addEventListener: () => undefined,
  };
  runInNewContext(script, {
    window,
    document: {
      getElementById: (id: string) =>
        id === 'status-msg' ? status : { getContext: () => ({}), style: {} },
    },
    atob: (text: string) => text,
    pdfjsLib: {
      GlobalWorkerOptions: {},
      getDocument: () => ({ promise: Promise.reject(new Error('dañado')) }),
    },
  });
  (window.qcLoadPdf as (b64: string) => void)('x');
  for (let n = 0; n < 4; n++) await Promise.resolve();
  expect(messages.at(-1)).toMatchObject({ type: 'ERROR' });
  expect(status.innerText).toBe('No se pudo abrir este PDF. Vuelve a intentarlo.');
});
