/** Local server administration utility. Never exposes an HTTP login or issues a Google token. */
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { readConfig } from './config.js';
import { openDatabase, one } from './db.js';
import { prepare, requireUuid } from './preparation.js';
import { handlePublishEducation } from './education-publish.js';

type Item = {
  tipo: 'imagen' | 'video' | 'podcast';
  titulo: string;
  categoria: string;
  url?: string;
  archivo?: string;
  sha256?: string;
  descripcion: string;
  clave: string;
};
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const operationId = (key: string) => {
  const h = sha('quimiocare-education-import-v1:' + key);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

async function main() {
  const [manifestPath, operatorId, mode] = process.argv.slice(2);
  if (!manifestPath || !operatorId || !['--check', '--apply'].includes(mode ?? ''))
    throw new Error('Uso: import-education.js manifiesto.json UUID_OPERADOR --check|--apply');
  requireUuid(operatorId);
  const path = await realpath(manifestPath),
    root = dirname(path);
  const manifest = JSON.parse(await readFile(path, 'utf8')) as {
    version: number;
    elementos: Item[];
  };
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.elementos) ||
    !manifest.elementos.length ||
    manifest.elementos.length > 500
  )
    throw new Error('Manifiesto inválido.');
  const files = new Map<string, string>(),
    keys = new Set<string>();
  for (const item of manifest.elementos) {
    if (
      !['imagen', 'video', 'podcast'].includes(item.tipo) ||
      !item.clave ||
      keys.has(item.clave) ||
      !item.titulo?.trim() ||
      item.titulo.length > 200 ||
      !item.categoria?.trim() ||
      item.categoria.length > 200 ||
      !item.descripcion?.trim() ||
      item.descripcion.length > 1000
    )
      throw new Error('Entrada inválida o duplicada.');
    keys.add(item.clave);
    if (item.tipo === 'imagen') {
      const file = await realpath(resolve(root, item.archivo ?? ''));
      if (!file.startsWith(root + sep))
        throw new Error('Archivo fuera del directorio de importación.');
      const bytes = await readFile(file);
      if (bytes.length > 5 * 1024 * 1024 || sha(bytes) !== item.sha256)
        throw new Error('Tamaño o checksum incorrecto.');
      files.set(item.clave, file);
    } else if (
      item.tipo === 'video'
        ? !/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/.test(item.url ?? '')
        : !/^https:\/\/drive\.google\.com\/file\/d\/[\w-]{10,100}\/view$/.test(item.url ?? '')
    )
      throw new Error('Enlace no compatible.');
  }
  const config = readConfig();
  if (!config.preparationEnabled || config.service !== 'clinical')
    throw new Error('Preparación clínica deshabilitada.');
  const db = openDatabase(config.databaseUrl);
  try {
    const operator = await one<{ auth_subject: string; auth_issuer: string }>(
      db,
      'SELECT auth_subject,auth_issuer FROM qc_demo_operador WHERE id=$1 AND activo=true',
      [operatorId],
    );
    if (!operator || operator.auth_issuer !== config.issuer)
      throw new Error('Operador activo o issuer no verificado.');
    const principal = { id: operator.auth_subject, issuer: operator.auth_issuer };
    if (mode === '--check') {
      console.log(JSON.stringify({ checked: manifest.elementos.length, changes: 0 }));
      return;
    }
    const results: unknown[] = [];
    for (const category of new Set(manifest.elementos.map((i) => i.categoria)))
      await prepare(db, config, principal, 'categorias', {
        nombre: category,
        operacion_id: operationId('category:' + category),
      });
    for (const item of manifest.elementos) {
      const fields = {
        titulo: item.titulo,
        descripcion: item.descripcion,
        categoria: item.categoria,
        operacion_id: operationId(item.clave + ':' + sha(JSON.stringify(item))),
      };
      let result;
      if (item.tipo === 'imagen') {
        const form = new FormData();
        for (const [key, value] of Object.entries(fields)) form.set(key, value);
        const bytes = await readFile(files.get(item.clave)!);
        if (sha(bytes) !== item.sha256)
          throw new Error('El archivo cambió después de la comprobación.');
        const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        form.set(
          'archivo',
          new Blob([new Uint8Array(bytes)], { type: png ? 'image/png' : 'image/jpeg' }),
          png ? 'material.png' : 'material.jpg',
        );
        const request = new Request('http://import.invalid', { method: 'POST', body: form });
        const payload = Buffer.from(await request.arrayBuffer());
        const stream = Readable.from([payload]) as unknown as IncomingMessage;
        stream.headers = {
          'content-type': request.headers.get('content-type')!,
          'content-length': String(payload.length),
        };
        result = await handlePublishEducation(config, db, principal, stream);
      } else
        result = await prepare(
          db,
          config,
          principal,
          'contenido-educativo/' + (item.tipo === 'video' ? 'videos' : 'podcasts'),
          { ...fields, url: item.url },
        );
      results.push({ clave: item.clave, ...result });
      await writeFile(path + '.resultado.json', JSON.stringify(results, null, 2), { mode: 0o600 });
      console.log(JSON.stringify({ clave: item.clave, status: result.status }));
    }
  } finally {
    await db.end();
  }
}
await main();
