/**
 * Política de contenido del visor PDF. pdf.js y su worker se cargan solo desde los recursos de la
 * app (`file:///android_asset/pdfjs/`); el PDF llega como texto base64, así que la página no
 * necesita conectarse a ningún servidor. Aunque un PDF lograra ejecutar código, no podría enviar
 * datos del paciente hacia afuera (`connect-src`, `img-src` y `form-action` cerrados).
 */
export const PDF_VIEWER_CSP = [
  "default-src 'none'",
  "script-src file: 'unsafe-inline'",
  'worker-src file: blob:',
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

const ASSETS = 'file:///android_asset/';

/** Orígenes que la WebView del visor puede abrir: solo su propia página. */
export const PDF_VIEWER_ORIGINS = [ASSETS + '*', 'about:blank'];

/** Solo se permite el visor; cualquier otra dirección (web, archivos del paciente, intents) se bloquea. */
export function isAllowedViewerUrl(url: string): boolean {
  if (url === 'about:blank') return true;
  if (!url.startsWith(ASSETS)) return false;
  return !/(^|\/)\.\.(\/|$)|%2e%2e/i.test(url.slice(ASSETS.length));
}
