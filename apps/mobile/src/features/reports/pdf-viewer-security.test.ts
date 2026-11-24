import { describe, expect, it } from 'vitest';
import { buildPdfJsHtml } from './pdf-viewer-html';
import { PDF_VIEWER_CSP, isAllowedViewerUrl } from './pdf-viewer-security';

describe('seguridad del visor PDF', () => {
  it.each([undefined, 'JVBERi0='])('el HTML declara la política de contenido (%s)', (pdf) => {
    const html = buildPdfJsHtml(pdf);
    const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
    expect(meta?.[1]).toBe(PDF_VIEWER_CSP);
    // La política debe ir antes de cargar pdf.js para aplicarse a todos los scripts.
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('pdf.min.js'));
  });

  it('la política no deja conectarse a ningún servidor ni cargar código remoto', () => {
    const rules = Object.fromEntries(
      PDF_VIEWER_CSP.split(';').map((rule) => {
        const [name, ...values] = rule.trim().split(/\s+/);
        return [name, values];
      }),
    );
    expect(rules['default-src']).toEqual(["'none'"]);
    expect(rules['connect-src']).toEqual(["'none'"]);
    expect(rules['form-action']).toEqual(["'none'"]);
    expect(rules['script-src']).not.toContain('https:');
    expect(rules['script-src']).not.toContain('*');
    expect(rules['script-src']).not.toContain("'unsafe-eval'");
    expect(rules['img-src']).toEqual(['data:', 'blob:']);
  });

  it('conserva la mitigación oficial de CVE-2024-4367 en pdf.js 3.x', () => {
    expect(buildPdfJsHtml('JVBERi0=')).toContain('isEvalSupported: false');
  });

  it.each(['file:///android_asset/', 'file:///android_asset/pdfjs/pdf.min.js', 'about:blank'])(
    'permite cargar el visor (%s)',
    (url) => expect(isAllowedViewerUrl(url)).toBe(true),
  );

  it.each([
    'https://servidor-externo.example/robar?datos=1',
    'http://10.0.2.2/',
    'file:///data/user/0/cl.quimiocare/files/reporte.pdf',
    'file:///android_asset/../../data/user/0/x',
    'intent://abrir#Intent;end',
    'javascript:alert(1)',
    'data:text/html,<script>1</script>',
  ])('bloquea cualquier otra dirección (%s)', (url) => expect(isAllowedViewerUrl(url)).toBe(false));
});
