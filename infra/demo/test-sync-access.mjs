import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';

const configPath = process.argv[2] ?? new URL('.env', import.meta.url);
if (!configPath) throw new Error('Indicar la ruta privada de .env del laboratorio.');
const env = Object.fromEntries(
  readFileSync(configPath, 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_0-9]+=/.test(l))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);
if (env.APP_ENV !== 'demo') throw new Error('Solo entorno demo.');
const api = env.SIMULATOR_PUBLIC_BASE_URL;
if (!['127.0.0.1', 'localhost'].includes(new URL(api).hostname))
  throw new Error('Esta comprobación es solo local.');
const response = await fetch(api + '/__demo/auth/session', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ paciente_demo: 'A' }),
});
assert.equal(response.status, 200);
const session = await response.json();
const original = JSON.parse(
  Buffer.from(session.access_token.split('.')[1], 'base64url').toString(),
);
function sign(claims) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', env.DEMO_SIGNING_KEY)
    .update(header + '.' + payload)
    .digest('base64url');
  return header + '.' + payload + '.' + signature;
}
async function checkpoint(token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const result = await fetch('http://127.0.0.1:8080/sync/stream', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson',
      },
      body: JSON.stringify({
        buckets: [],
        include_checksum: true,
        raw_data: true,
        client_id: randomUUID(),
      }),
      signal: controller.signal,
    });
    if (result.status !== 200)
      return { status: result.status, buckets: 0, error: (await result.text()).slice(0, 350) };
    const reader = result.body.getReader();
    let pending = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += new TextDecoder().decode(value);
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const frame = JSON.parse(line);
        if (frame.checkpoint)
          return { status: 200, buckets: frame.checkpoint.buckets?.length ?? 0 };
        if (frame.error) return { status: 200, buckets: 0, error: JSON.stringify(frame.error) };
      }
    }
    throw new Error('El stream terminó sin checkpoint.');
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
const cases = [
  ['A autorizado', original, true],
  [
    'B autorizado',
    { ...original, sub: '2dcb04f2-a2ad-5ea4-b711-9acd7e570002', demo_patient: 'B' },
    true,
  ],
  ['otro propietario', { ...original, sub: randomUUID() }, false],
  ['rol incorrecto', { ...original, role: 'administrador' }, false],
  ['cohorte incorrecta', { ...original, cohort: 'otra' }, false],
  ['emisor incorrecto', { ...original, iss: 'otro' }, false],
];
for (const [name, claims, allowed] of cases) {
  const result = await checkpoint(sign(claims));
  assert.equal(result.status, 200, JSON.stringify({ name, ...result }));
  assert.equal(result.buckets > 0, allowed, JSON.stringify({ name, ...result }));
  console.log(
    JSON.stringify({ case: name, status: result.status, buckets: result.buckets, passed: true }),
  );
}
for (const [name, token] of [
  ['audiencia incorrecta', sign({ ...original, aud: 'otra' })],
  ['vencido', sign({ ...original, exp: Math.floor(Date.now() / 1000) - 60 })],
  ['firma inválida', session.access_token + 'x'],
]) {
  const result = await checkpoint(token);
  assert.equal(result.status, 401, JSON.stringify({ name, ...result }));
  console.log(JSON.stringify({ case: name, status: result.status, passed: true }));
}
