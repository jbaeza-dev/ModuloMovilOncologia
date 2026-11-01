import { createWriteStream } from 'node:fs';
import { mkdir, rename, unlink, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import busboy from 'busboy';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import type { Database } from './db.js';
import { ApiError } from './errors.js';
import type { SimulatorConfig } from './config.js';
import type { Principal } from './types.js';
import { enterMutation } from './mutation-gate.js';
import { canonical, categoryName, requireOperator, requireUuid } from './preparation.js';
export {
  isMaintenanceActive,
  setMaintenanceActive,
  getActivePublishes,
  drainPublishes,
} from './mutation-gate.js';

const MAX_EDUCATIONAL_IMAGE_PIXELS = 8_000_000;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
let uploads = 0;
export interface PublishResult {
  status: number;
  body: unknown;
}
interface ParsedMultipart {
  fields: Record<string, string>;
  tempFilePath: string;
  fileBytes: Buffer;
}
async function parseMultipartBody(req: IncomingMessage, tempDir: string): Promise<ParsedMultipart> {
  const tempFilePath = join(tempDir, `temp-${randomUUID()}.tmp`);
  const fields: Record<string, string> = {};
  const chunks: Buffer[] = [];
  const jobs: Promise<void>[] = [];
  let fileCount = 0;
  let bytes = 0;
  let failure: Error | null = null;
  let bb: busboy.Busboy;
  try {
    bb = busboy({
      headers: req.headers,
      limits: { fileSize: MAX_FILE_SIZE, files: 1, fields: 5, parts: 6, fieldSize: 8192 },
    });
  } catch {
    throw new ApiError(400, 'ERROR_MULTIPART', 'Use multipart/form-data.');
  }
  const fail = (error: Error) => {
    failure ??= error;
    bb.destroy(error);
  };
  const abort = () => fail(new ApiError(400, 'CLIENTE_DESCONECTADO', 'Carga interrumpida.'));
  const timer = setTimeout(
    () => fail(new ApiError(408, 'TIMEOUT_CARGA', 'La carga excedió 20 segundos.')),
    20000,
  );
  req.once('aborted', abort);
  try {
    await new Promise<void>((resolve, reject) => {
      bb.on('field', (name, value, info) => {
        if (
          !['titulo', 'descripcion', 'categoria', 'operacion_id'].includes(name) ||
          name in fields ||
          info.valueTruncated
        )
          return fail(
            new ApiError(
              422,
              'ERROR_VALIDACION',
              'Campo desconocido, repetido o demasiado grande.',
            ),
          );
        fields[name] = value;
      });
      bb.on('file', (name, file) => {
        file.on('error', () => undefined);
        if (name !== 'archivo' || ++fileCount !== 1) {
          file.resume();
          fail(new ApiError(422, 'ARCHIVO_REQUERIDO', 'Se admite un único campo archivo.'));
          return;
        }
        file.on('limit', () => fail(new ApiError(413, 'CARGA_DEMASIADO_GRANDE', 'Máximo 5 MiB.')));
        file.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes <= MAX_FILE_SIZE) chunks.push(chunk);
        });
        const job = pipeline(file, createWriteStream(tempFilePath, { flags: 'wx' }));
        jobs.push(job);
        void job.catch((error) =>
          fail(
            error instanceof ApiError
              ? error
              : new ApiError(500, 'ERROR_ALMACENAMIENTO', 'No se pudo guardar el temporal.'),
          ),
        );
      });
      bb.on('filesLimit', () =>
        fail(new ApiError(422, 'ERROR_VALIDACION', 'Solo se admite una imagen.')),
      );
      for (const event of ['fieldsLimit', 'partsLimit'] as const)
        bb.on(event, () =>
          fail(new ApiError(422, 'ERROR_VALIDACION', 'Demasiadas partes multipart.')),
        );
      bb.once('error', reject);
      bb.once('close', () => (failure ? reject(failure) : resolve()));
      req.pipe(bb);
    });
    await Promise.all(jobs);
    if (!fileCount || !bytes)
      throw new ApiError(422, 'ARCHIVO_REQUERIDO', 'La imagen no puede estar vacía.');
    return { fields, tempFilePath, fileBytes: Buffer.concat(chunks) };
  } catch (error) {
    await Promise.allSettled(jobs);
    await unlink(tempFilePath).catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timer);
    req.unpipe(bb);
    req.removeListener('aborted', abort);
  }
}

function validateAndDecodeImage(bytes: Buffer): { format: 'png' | 'jpeg'; mime: string } {
  if (bytes.length < 8) {
    throw new ApiError(
      422,
      'FORMATO_NO_PERMITIDO',
      'Archivo demasiado corto o cabecera binaria insuficiente.',
    );
  }

  // Comprobar PNG: 89 50 4E 47 0D 0A 1A 0A
  const isPng =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;

  if (isPng) {
    if (bytes.length < 24) {
      throw new ApiError(422, 'FORMATO_NO_PERMITIDO', 'Cabecera PNG incompleta para validar IHDR.');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);

    if (width === 0 || height === 0) {
      throw new ApiError(422, 'FORMATO_NO_PERMITIDO', 'Dimensiones de imagen PNG inválidas.');
    }

    if (width * height > MAX_EDUCATIONAL_IMAGE_PIXELS) {
      throw new ApiError(
        422,
        'RESOLUCION_EXCESIVA',
        `La resolución (${width}x${height} = ${width * height} px) supera el límite de 8 Megapíxeles.`,
      );
    }

    // Decodificación real con pngjs para validar deflate, CRCs y chunk IEND
    try {
      PNG.sync.read(bytes);
    } catch (err) {
      throw new ApiError(
        422,
        'FORMATO_NO_PERMITIDO',
        'El archivo PNG está corrupto o truncado (fallo de descompresión raster).',
        err,
      );
    }

    return { format: 'png', mime: 'image/png' };
  }

  // Comprobar JPEG: FF D8 FF
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (isJpeg) {
    try {
      const decoded = jpeg.decode(bytes, {
        maxMemoryUsageInMB: 64,
        maxResolutionInMP: 8,
        tolerantDecoding: false,
      });

      if (
        !decoded.width ||
        !decoded.height ||
        decoded.width * decoded.height > MAX_EDUCATIONAL_IMAGE_PIXELS
      ) {
        throw new ApiError(
          422,
          'RESOLUCION_EXCESIVA',
          'La resolución de la imagen JPEG supera el límite de 8 Megapíxeles.',
        );
      }
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(
        422,
        'FORMATO_NO_PERMITIDO',
        'El archivo JPEG está corrupto, truncado o viola los límites estrictos de decodificación.',
        err,
      );
    }

    return { format: 'jpeg', mime: 'image/jpeg' };
  }

  throw new ApiError(
    422,
    'FORMATO_NO_PERMITIDO',
    'Solo se admiten imágenes válidas en formato PNG o JPEG. Formatos como SVG o ejecutables están estrictamente prohibidos.',
  );
}

export async function handlePublishEducation(
  config: SimulatorConfig,
  db: Database,
  principal: Principal | undefined,
  req: IncomingMessage,
): Promise<PublishResult> {
  const leave = enterMutation();
  let parsed: ParsedMultipart | undefined;
  let destination = '';
  let mayDelete = true;
  let admitted = false;
  try {
    if (!principal) throw new ApiError(401, 'NO_AUTENTICADO', 'Autenticación requerida.');
    const operator = await requireOperator(db, config, principal);
    if (uploads >= 2)
      throw new ApiError(429, 'CARGAS_OCUPADAS', 'Hay dos publicaciones en curso. Reintente.');
    uploads++;
    admitted = true;
    await mkdir(config.educationMediaRoot, { recursive: true });
    await mkdir(config.educationTempDir, { recursive: true });
    if ((await stat(config.educationTempDir)).dev !== (await stat(config.educationMediaRoot)).dev)
      throw new ApiError(
        503,
        'CONFIGURACION_INVALIDA',
        'Temporal y destino deben compartir filesystem.',
      );
    parsed = await parseMultipartBody(req, config.educationTempDir);
    const operation = requireUuid(parsed.fields.operacion_id);
    const title = parsed.fields.titulo?.trim();
    const description = parsed.fields.descripcion?.trim();
    if (!title || title.length > 200 || !description || description.length > 1000)
      throw new ApiError(
        422,
        'ERROR_VALIDACION',
        'Título y descripción son obligatorios (máximo 200/1000 caracteres).',
      );
    const category = await categoryName(db, parsed.fields.categoria);
    const image = validateAndDecodeImage(parsed.fileBytes);
    const sha = createHash('sha256').update(parsed.fileBytes).digest('hex');
    const client = await db.connect();
    let released = false;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='5s'");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('qc-preparacion-write'))");
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['education:' + operation]);
      const prior = (
        await client.query('SELECT * FROM qc_demo_operacion_educativa WHERE operacion_id=$1', [
          operation,
        ])
      ).rows[0];
      if (prior) {
        if (prior.operador_id !== operator)
          throw new ApiError(403, 'ACCESO_DENEGADO', 'Operación de otro operador.');
        if (
          prior.archivo_sha256 !== sha ||
          prior.titulo !== title ||
          prior.descripcion !== description ||
          prior.categoria !== category
        )
          throw new ApiError(409, 'CONFLICTO_OPERACION_ID', 'La operación tiene otros datos.');
        await client.query('ROLLBACK');
        return { status: 200, body: prior.resultado };
      }
      const otherPreparation = (
        await client.query(
          'SELECT operador_id FROM qc_preparacion_operacion WHERE operacion_id=$1',
          [operation],
        )
      ).rows[0];
      if (otherPreparation)
        throw new ApiError(
          otherPreparation.operador_id !== operator ? 403 : 409,
          'CONFLICTO_OPERACION_ID',
          'Identificador usado en otra preparación.',
        );
      const id = randomUUID(),
        revision = randomUUID(),
        ext = image.format === 'png' ? 'png' : 'jpg';
      const dir = join(config.educationMediaRoot, id);
      await mkdir(dir, { recursive: true });
      destination = join(dir, `${revision}.${ext}`);
      await rename(parsed.tempFilePath, destination);
      const result = {
        id,
        profesional_id: operator,
        titulo: title,
        descripcion: description,
        tipo: 'imagen',
        url: `${config.publicBaseUrl}/archivos/educacion/${id}/${revision}.${ext}`,
        categoria: category,
        activo: true,
        fecha_creacion: new Date().toISOString(),
        carpeta_id: null,
        archivo_mime: image.mime,
        archivo_tamano_bytes: parsed.fileBytes.length,
        archivo_revision: revision,
        archivo_sha256: sha,
      };
      await client.query(
        `INSERT INTO contenido_educativo(id,profesional_id,titulo,descripcion,tipo,url,categoria,activo,fecha_creacion,archivo_mime,archivo_tamano_bytes,archivo_revision,archivo_sha256)
        VALUES($1,$2,$3,$4,'imagen',$5,$6,true,$7,$8,$9,$10,$11)`,
        [
          id,
          operator,
          title,
          description,
          result.url,
          category,
          result.fecha_creacion,
          image.mime,
          parsed.fileBytes.length,
          revision,
          sha,
        ],
      );
      await client.query(
        `INSERT INTO qc_demo_operacion_educativa(operacion_id,operador_id,contenido_id,archivo_sha256,titulo,descripcion,categoria,resultado)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [operation, operator, id, sha, title, description, category, JSON.stringify(result)],
      );
      const action = 'contenido-educativo/imagenes';
      const digest = createHash('sha256')
        .update(canonical({ action, title, description, category, sha }))
        .digest('hex');
      await client.query(
        'INSERT INTO qc_preparacion_operacion(operacion_id,operador_id,accion,payload_sha256,resultado) VALUES($1,$2,$3,$4,$5)',
        [operation, operator, action, digest, JSON.stringify(result)],
      );
      await client.query(
        'INSERT INTO qc_preparacion_auditoria(operacion_id,operador_id,accion) VALUES($1,$2,$3)',
        [operation, operator, action],
      );
      try {
        await client.query('COMMIT');
        mayDelete = false;
      } catch {
        // Destroy the uncertain connection before waiting for its transaction lock elsewhere.
        mayDelete = false;
        client.release(true);
        released = true;
        const verify = await db.connect().catch(() => {
          throw new ApiError(
            503,
            'COMMIT_INCIERTO',
            'Resultado pendiente de verificación; reintente la misma operación.',
          );
        });
        try {
          await verify.query('BEGIN');
          await verify.query("SET LOCAL lock_timeout='5s'");
          await verify.query("SET LOCAL statement_timeout='6s'");
          await verify.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
            'education:' + operation,
          ]);
          const found = (
            await verify.query(
              'SELECT resultado FROM qc_demo_operacion_educativa WHERE operacion_id=$1',
              [operation],
            )
          ).rows[0];
          if (found) {
            await verify.query('ROLLBACK');
            return { status: 201, body: found.resultado };
          }
          mayDelete = true;
          await verify.query('ROLLBACK');
          throw new ApiError(
            503,
            'PUBLICACION_NO_CONFIRMADA',
            'Reintente con el mismo operacion_id.',
          );
        } catch (error) {
          await verify.query('ROLLBACK').catch(() => undefined);
          throw error instanceof ApiError
            ? error
            : new ApiError(
                503,
                'COMMIT_INCIERTO',
                'No fue posible verificar la publicación. Se conserva el archivo. Reintente con el mismo operacion_id.',
              );
        } finally {
          verify.release();
        }
      }
      return { status: 201, body: result };
    } catch (error) {
      if (!released) await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      if (!released) client.release();
    }
  } finally {
    if (parsed) await unlink(parsed.tempFilePath).catch(() => undefined);
    if (destination && mayDelete) await unlink(destination).catch(() => undefined);
    if (admitted) uploads--;
    leave();
  }
}
