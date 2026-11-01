import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import type { Request, Response, NextFunction } from 'express';
import { getGatewayExecutionDoc } from '@quimiocare/contracts';

const require = createRequire(import.meta.url);
let swaggerDistDir = '';
try {
  swaggerDistDir = dirname(require.resolve('swagger-ui-dist/package.json'));
} catch {
  // Ignorar si no está instalado directamente
}

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
};

function getHtml(title: string, specUrl: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <link rel="stylesheet" type="text/css" href="./static/swagger-ui.css" />
  <link rel="icon" type="image/png" href="./static/favicon-32x32.png" sizes="32x32" />
  <link rel="icon" type="image/png" href="./static/favicon-16x16.png" sizes="16x16" />
  <style>
    html { box-sizing: border-box; overflow: -moz-scrollbars-vertical; overflow-y: scroll; }
    *, *:before, *:after { box-sizing: inherit; }
    body { margin:0; background: #fafafa; }
    .topbar { display: none !important; }
    .swagger-ui .info { margin: 25px 0; }
    .swagger-ui .info .title { font-size: 26px; color: #106f6e; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="./static/swagger-ui-bundle.js" charset="UTF-8"></script>
  <script src="./static/swagger-ui-standalone-preset.js" charset="UTF-8"></script>
  <script>
    window.onload = function() {
      window.ui = SwaggerUIBundle({
        url: "${specUrl}",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout",
        persistAuthorization: false,
        validatorUrl: null
      });
    };
  </script>
</body>
</html>`;
}

export function gatewayDocsMiddleware() {
  const isEnabled = process.env.API_DOCS_ENABLED === 'true';

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    let path = req.path;
    if (path.startsWith('/quimiocare-backend/')) {
      path = path.slice('/quimiocare-backend'.length);
    }

    if (!path.startsWith('/docs')) {
      return next();
    }

    if (!isEnabled) {
      res.status(404).json({ error: 'Not Found' });
      return;
    }

    if (path === '/docs' || path === '/docs/') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.setHeader('x-content-type-options', 'nosniff');
      res.send(getHtml('QuimioCare — Gateway API Docs', './openapi.json'));
      return;
    }

    if (path === '/docs/openapi.json') {
      const doc = getGatewayExecutionDoc([
        { url: process.env.GATEWAY_PUBLIC_BASE_URL ?? '/quimiocare-backend' },
      ]);
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.setHeader('x-content-type-options', 'nosniff');
      res.json(doc);
      return;
    }

    const staticMatch = /^\/docs\/static\/([a-zA-Z0-9_.-]+)$/.exec(path);
    if (staticMatch && staticMatch[1] && swaggerDistDir) {
      const filename = staticMatch[1];
      if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        res.status(404).json({ error: 'Not Found' });
        return;
      }
      const filePath = join(swaggerDistDir, filename);
      const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      try {
        const bytes = await readFile(filePath);
        res.setHeader('content-type', mime);
        res.setHeader('content-length', bytes.length);
        res.setHeader('cache-control', 'public, max-age=3600');
        res.setHeader('x-content-type-options', 'nosniff');
        res.end(bytes);
        return;
      } catch {
        res.status(404).json({ error: 'File Not Found' });
        return;
      }
    }

    next();
  };
}
