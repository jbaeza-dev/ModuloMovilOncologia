import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(root + path, 'utf8');

/** Segundos de proxy_read_timeout de cada bloque `location` que atiende la API del gateway. */
function gatewayApiTimeouts(conf) {
  const blocks = [...conf.matchAll(/location\s+[^{]*api\/gateway\/[^{]*\{([^}]*)\}/g)];
  return blocks.map((block) => {
    const match = /proxy_read_timeout\s+(\d+)s;/.exec(block[1]);
    assert.ok(match, 'Cada ruta de la API del gateway declara proxy_read_timeout');
    return Number(match[1]);
  });
}
const gatewayRequestMs = Number(
  /integer\('HTTP_REQUEST_TIMEOUT_MS',\s*(\d+)/.exec(read('apps/gateway/src/config/index.ts'))[1],
);
const appAssistantMs = Number(
  /timeoutMs:\s*(\d+)/.exec(
    read('apps/mobile/src/services/assistant/http-assistant-adapter.ts'),
  )[1],
);

for (const file of [
  'infra/universidad/proxy/gateway.conf',
  'infra/universidad/proxy/gateway.eval.conf',
])
  test(`${file}: el gateway responde antes que el proxy, y el proxy antes que la app`, () => {
    const timeouts = gatewayApiTimeouts(read(file));
    assert.equal(timeouts.length, 2, 'Rutas /api/gateway/ y /quimiocare-backend/api/gateway/');
    for (const seconds of timeouts) {
      assert.ok(
        seconds * 1000 > gatewayRequestMs,
        `proxy ${seconds}s debe superar el límite del gateway (${gatewayRequestMs} ms)`,
      );
      assert.ok(
        seconds * 1000 < appAssistantMs,
        `proxy ${seconds}s debe ser menor que la espera de la app (${appAssistantMs} ms)`,
      );
    }
  });
