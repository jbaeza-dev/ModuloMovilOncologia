import type { SimulatorConfig } from '../config.js';
import type { Database } from '../db.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { operatorFromHeader } from '../auth.js';
import { requireOperator } from '../preparation.js';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import {
  getClinicalAiExecutionDoc,
  getEvaluationExecutionDoc,
  getPreparationExecutionDoc,
} from '@quimiocare/contracts';
const require = createRequire(import.meta.url);
const swaggerDistDir = dirname(require.resolve('swagger-ui-dist/package.json'));
const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
};
function getHtml(preparation: { root: string; issuer: string; publicKey: string }): string {
  const authConfig = JSON.stringify(preparation).replace(/</g, '\\u003c');
  const assets = preparation.root + 'static/';
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <title>QuimioCare — Acceso al simulador</title>
  <link rel="stylesheet" href="${assets}swagger-ui.css">
  <link rel="icon" href="${assets}favicon-32x32.png">
  <style>
    * { box-sizing:border-box; } [hidden] { display:none !important; }
    body { margin:0; background:#f3f7f6; color:#18332f; font:16px/1.5 system-ui,sans-serif; color-scheme:light; }
    .access { max-width:1400px; margin:auto; padding:20px 24px; }
    .access h1 { font-size:22px; margin:0; } .access p { margin:8px 0; }
    .login-card { width:min(480px,calc(100% - 32px)); margin:8vh auto 24px; padding:32px; background:white; border:1px solid #c9dcd6; border-radius:16px; }
    .login-card h2 { margin-top:0; font-size:26px; line-height:1.25; }
    button { min-height:44px; padding:12px 18px; background:#106f6e; color:white; border:0; border-radius:8px; font:600 16px system-ui; cursor:pointer; }
    button:focus-visible { outline:3px solid #b26c00; outline-offset:3px; }
    button:disabled { opacity:.6; cursor:wait; } #qc-login { width:100%; margin:12px 0; }
    #qc-access-status { min-height:24px; }
    nav { display:flex; gap:12px; flex-wrap:wrap; padding:12px 24px; background:#fff; border-block:1px solid #c9dcd6; }
    .topbar,.swagger-ui .auth-wrapper,.swagger-ui .authorization__btn { display:none; }
    .swagger-ui .info { margin:24px 0; } .swagger-ui .info .title { color:#106f6e; }
  </style>
</head>
<body>
  <header class="access">
    <h1>Servidor simulado QuimioCare</h1>
    <p id="qc-access-status" role="status" aria-live="polite">Preparando acceso…</p>
    <button id="qc-logout" type="button" hidden>Salir de Swagger</button>
  </header>
  <section id="qc-login-gate" class="login-card" aria-labelledby="qc-login-title">
    <h2 id="qc-login-title">Inicia sesión para continuar</h2>
    <p>Accede con tu cuenta Google autorizada como operador para preparar datos de demostración y consultar los contratos.</p>
    <button id="qc-login" type="button">Entrar con Google</button>
    <p>Solo las cuentas autorizadas pueden acceder al simulador.</p>
  </section>
  <main id="qc-swagger-shell" hidden>
    <nav aria-label="Documentación del simulador">
      <button id="qc-document-preparacion" type="button">Preparar datos</button>
      <button id="qc-document-contrato" type="button">Contrato clínico e IA</button>
    </nav>
    <div id="swagger-ui"></div>
  </main>
  <script src="${preparation.root}preparation-auth.js"></script>
  <script src="${assets}swagger-ui-bundle.js"></script>
  <script src="${assets}swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      let existingUi;
      window.initPreparationAuth(async function(token, view, authorizeRequest) {
        const root = ${authConfig}.root;
        const specUrl = view === 'contrato' ? root.replace('preparacion/', 'openapi.json') : root + 'openapi.json';
        const response = await fetch(specUrl, {
          headers: { authorization: 'Bearer ' + token },
          cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12000)
        });
        if (!response.ok) throw new Error('No se pudo abrir la documentación. Vuelve a iniciar sesión.');
        const spec = await response.json();
        if (existingUi) {
          existingUi.specActions.updateJsonSpec(spec);
          return existingUi;
        }
        return await new Promise(function(resolve) {
          let instance;
          instance = SwaggerUIBundle({
            spec: spec, dom_id: '#swagger-ui', deepLinking: false,
            presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
            layout: 'StandaloneLayout', persistAuthorization: false, defaultModelsExpandDepth: -1, validatorUrl: null,
            requestInterceptor: authorizeRequest,
            responseInterceptor: function(result) {
              if (result.status === 401 && window.qcPreparationAuth) window.qcPreparationAuth.expired();
              return result;
            },
            onComplete: function() { queueMicrotask(function() { existingUi = instance; resolve(instance); }); }
          });
        });
      }, ${authConfig});
    };
  </script>
</body>
</html>`;
}

export async function handleSwaggerRoute(
  config: SimulatorConfig,
  db: Database,
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<boolean> {
  if (!config.apiDocsEnabled) {
    return false;
  }
  if (req.method !== 'GET') return false;
  // Normalizar removiendo prefijo opcional /quimiocare
  let path = pathname;
  if (path.startsWith('/quimiocare/')) {
    path = path.slice('/quimiocare'.length);
  }
  if (
    [
      '/docs/preparacion/openapi.json',
      '/docs/openapi.json',
      '/docs/evaluacion/openapi.json',
    ].includes(path)
  ) {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('vary', 'Authorization');
    const principal = await operatorFromHeader(config, req.headers.authorization, db);
    await requireOperator(db, config, principal);
  }
  if (path === '/docs/preparacion') {
    res.writeHead(308, { location: pathname + '/' });
    res.end();
    return true;
  }
  if (path === '/docs/preparacion/' || path === '/docs/preparacion/oauth/callback') {
    const root = (pathname.startsWith('/quimiocare/') ? '/quimiocare' : '') + '/docs/preparacion/';
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
      'x-content-type-options': 'nosniff',
    });
    res.end(
      getHtml({
        root,
        issuer: config.authProvider === 'supabase' ? config.issuer.replace(/\/$/, '') : '',
        publicKey: config.authPublicKey ?? '',
      }),
    );
    return true;
  }
  if (path === '/docs/preparacion/preparation-auth.js') {
    const script = await readFile(new URL('./preparation-auth.js', import.meta.url));
    res.writeHead(200, {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(script);
    return true;
  }
  if (path === '/docs/preparacion/openapi.json') {
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    const servers = [
      {
        url: pathname.startsWith('/quimiocare/') ? '/quimiocare' : '/',
        description: 'Este servidor',
      },
    ];
    res.end(JSON.stringify(getPreparationExecutionDoc(servers)));
    return true;
  }
  // 1. Rutas HTML de documentación
  if (path === '/docs' || path === '/docs/') {
    res.writeHead(308, {
      location:
        (pathname.startsWith('/quimiocare/') ? '/quimiocare' : '') +
        '/docs/preparacion/?vista=contrato',
      'cache-control': 'no-store',
    });
    res.end();
    return true;
  }
  if (path === '/docs/evaluacion' || path === '/docs/evaluacion/') {
    res.writeHead(308, {
      location: (pathname.startsWith('/quimiocare/') ? '/quimiocare' : '') + '/docs/preparacion/',
      'cache-control': 'no-store',
    });
    res.end();
    return true;
  }
  // 2. Rutas OpenAPI JSON
  if (path === '/docs/openapi.json') {
    const doc = getClinicalAiExecutionDoc([{ url: config.publicBaseUrl }]);
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(JSON.stringify(doc));
    return true;
  }
  if (path === '/docs/evaluacion/openapi.json') {
    const doc = getEvaluationExecutionDoc([{ url: config.publicBaseUrl }]);
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(JSON.stringify(doc));
    return true;
  }
  // 3. Recursos estáticos de Swagger UI (CSS, JS, PNG)
  const staticMatch = /^\/docs(?:\/(?:evaluacion|preparacion))?\/static\/([a-zA-Z0-9_.-]+)$/.exec(
    path,
  );
  if (staticMatch && staticMatch[1]) {
    const filename = staticMatch[1];
    // Evitar cualquier path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
      return true;
    }
    const filePath = join(swaggerDistDir, filename);
    const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    try {
      const bytes = await readFile(filePath);
      res.writeHead(200, {
        'content-type': mime,
        'content-length': bytes.length,
        'cache-control': 'public, max-age=3600',
        'x-content-type-options': 'nosniff',
      });
      res.end(bytes);
      return true;
    } catch {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'File Not Found' }));
      return true;
    }
  }
  return false;
}
