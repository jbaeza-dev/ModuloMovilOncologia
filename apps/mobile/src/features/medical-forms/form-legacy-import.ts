import * as Crypto from 'expo-crypto';

import type { FileStorageAdapter } from '../../data/local/file-storage-adapter';
import type { FormDefinitionRecord, FormQuestionRecord } from '../../data/local/form-types';
import { areAnswersEqual, validateFormQuestionsRecords } from '../../data/local/form-validation';
import type { SqlConnection } from '../../data/local/sql';
import { getPatientDraftDirectory, isValidDraftPayload, withDraftLock } from './form-draft-storage';
import type { MedicalFormDraft } from './medical-form-types';

export async function computeSha256(content: string): Promise<string> {
  try {
    return await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, content);
  } catch {
    if (typeof globalThis.crypto?.subtle?.digest === 'function') {
      const encoder = new TextEncoder();
      const data = encoder.encode(content);
      const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    try {
      const nodeCrypto = await import('node:crypto');
      return nodeCrypto.createHash('sha256').update(content, 'utf8').digest('hex');
    } catch {
      throw new Error('No se pudo calcular la huella criptográfica SHA-256.');
    }
  }
}

export type ImportLegacyResult = {
  imported: number;
  cleaned: number;
  pendingCleanups: number;
  errors: number;
};

export async function importLegacyDrafts(
  patientId: string,
  database: SqlConnection,
  adapter: FileStorageAdapter,
  baseDirResolver?: (p: string) => string,
  newId: () => string = () => {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    return 'gen-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  },
  now: () => string = () => new Date().toISOString(),
): Promise<ImportLegacyResult> {
  const result: ImportLegacyResult = {
    imported: 0,
    cleaned: 0,
    pendingCleanups: 0,
    errors: 0,
  };

  const baseDir = baseDirResolver
    ? baseDirResolver(patientId)
    : getPatientDraftDirectory(patientId).uri;

  const dirExists = adapter.directoryExists
    ? await adapter.directoryExists(baseDir)
    : await adapter.exists(baseDir);

  if (!dirExists) {
    return result;
  }

  const files = await adapter.listDirectory(baseDir);
  const normalizedBaseDir = baseDir.replace(/\\/g, '/');
  const sep = normalizedBaseDir.endsWith('/') ? '' : '/';

  // Extraer nombres base de borradores (ej: form-qlq30-muestra_v1.0)
  const baseNames = new Set<string>();
  for (const fileUri of files) {
    const normalizedUri = fileUri.replace(/\\/g, '/');
    const lastSlash = normalizedUri.lastIndexOf('/');
    const fileName = lastSlash >= 0 ? normalizedUri.slice(lastSlash + 1) : normalizedUri;
    if (fileName.endsWith('.json')) {
      baseNames.add(fileName.slice(0, -5));
    } else if (fileName.endsWith('.bak')) {
      baseNames.add(fileName.slice(0, -4));
    }
  }

  for (const baseName of baseNames) {
    const jsonPath = `${normalizedBaseDir}${sep}${baseName}.json`;
    const bakPath = `${normalizedBaseDir}${sep}${baseName}.bak`;
    const relativeFileName = `${baseName}.json`;

    await withDraftLock(jsonPath, async () => {
      // 1. Lectura de recuperación de solo lectura (fuera de transacción SQL)
      const jsonExists = await adapter.exists(jsonPath);
      const bakExists = await adapter.exists(bakPath);

      let jsonRaw: string | null = null;
      let jsonSha256: string | null = null;
      let jsonValid = false;
      if (jsonExists) {
        try {
          jsonRaw = await adapter.readText(jsonPath);
          jsonSha256 = await computeSha256(jsonRaw);
          jsonValid = isValidDraftPayload(jsonRaw, patientId);
        } catch {
          jsonValid = false;
        }
      }

      let bakRaw: string | null = null;
      let bakSha256: string | null = null;
      let bakValid = false;
      if (bakExists) {
        try {
          bakRaw = await adapter.readText(bakPath);
          bakSha256 = await computeSha256(bakRaw);
          bakValid = isValidDraftPayload(bakRaw, patientId);
        } catch {
          bakValid = false;
        }
      }

      // 2. Comprobar estado previo en importacion_formularios_legacy
      const existingImport = await database.first<{
        estado: string;
        huella_sha256: string;
        huella_bak_sha256: string | null;
      }>(
        `SELECT estado, huella_sha256, huella_bak_sha256
         FROM importacion_formularios_legacy
         WHERE paciente_id = ? AND archivo_relativo = ?`,
        [patientId, relativeFileName],
      );

      if (existingImport?.estado === 'importado') {
        // Ya fue completamente importado y limpiado
        return;
      }

      if (existingImport?.estado === 'limpieza_pendiente') {
        const jsonHashMismatch =
          jsonExists &&
          Boolean(jsonSha256) &&
          Boolean(existingImport.huella_sha256) &&
          jsonSha256 !== existingImport.huella_sha256;

        const bakHashMismatch =
          bakExists &&
          Boolean(bakSha256) &&
          Boolean(existingImport.huella_bak_sha256) &&
          bakSha256 !== existingImport.huella_bak_sha256;

        if (jsonHashMismatch || bakHashMismatch) {
          const motivo = jsonHashMismatch
            ? 'El contenido del archivo JSON cambió tras el commit: huella modificada'
            : 'El contenido del archivo .bak cambió tras el commit: huella modificada';

          await database.run(
            `UPDATE importacion_formularios_legacy
             SET estado = 'revision_requerida', ultimo_error = ?
             WHERE paciente_id = ? AND archivo_relativo = ?`,
            [motivo, patientId, relativeFileName],
          );
          result.errors++;
          return;
        }

        // Reintento exclusivo de limpieza física (sin reinsertar entregas ni cola)
        let cleanedJson = true;
        let cleanedBak = true;

        if (jsonExists) {
          if (
            jsonRaw &&
            jsonSha256 &&
            existingImport.huella_sha256 &&
            jsonSha256 === existingImport.huella_sha256
          ) {
            try {
              const deleted = await adapter.deleteFile(jsonPath);
              const stillExists = await adapter.exists(jsonPath);
              cleanedJson = deleted && !stillExists;
            } catch {
              cleanedJson = false;
            }
          } else {
            cleanedJson = false;
          }
        }

        if (bakExists) {
          if (
            bakRaw &&
            bakSha256 &&
            existingImport.huella_bak_sha256 &&
            bakSha256 === existingImport.huella_bak_sha256
          ) {
            try {
              const deleted = await adapter.deleteFile(bakPath);
              const stillExists = await adapter.exists(bakPath);
              cleanedBak = deleted && !stillExists;
            } catch {
              cleanedBak = false;
            }
          } else {
            cleanedBak = false;
          }
        }

        if (cleanedJson && cleanedBak) {
          await database.run(
            `UPDATE importacion_formularios_legacy
             SET estado = 'importado', ultimo_error = NULL
             WHERE paciente_id = ? AND archivo_relativo = ?`,
            [patientId, relativeFileName],
          );
          result.cleaned++;
        } else {
          result.pendingCleanups++;
        }
        return;
      }

      // Si ninguno es válido
      if (!jsonValid && !bakValid) {
        await database.run(
          `INSERT INTO importacion_formularios_legacy (
            paciente_id, archivo_relativo, huella_sha256, huella_bak_sha256,
            destino_tipo, destino_id, estado, fecha_importacion, ultimo_error
          ) VALUES (?, ?, ?, ?, 'invalido', NULL, 'revision_requerida', ?, ?)
          ON CONFLICT (paciente_id, archivo_relativo) DO UPDATE SET
            estado = 'revision_requerida',
            ultimo_error = excluded.ultimo_error`,
          [
            patientId,
            relativeFileName,
            jsonSha256 ?? bakSha256 ?? '0',
            bakSha256,
            now(),
            'Archivo JSON y respaldo .bak inválidos o corruptos',
          ],
        );
        result.errors++;
        return;
      }

      // Seleccionar payload válido (JSON preferido sobre .bak)
      const selectedRaw = jsonValid && jsonRaw ? jsonRaw : bakRaw!;
      const selectedSha256 = jsonValid && jsonSha256 ? jsonSha256 : bakSha256!;
      const parsed: MedicalFormDraft = JSON.parse(selectedRaw);

      // Verificar que la definición exista en SQLite
      const formDef = await database.first<FormDefinitionRecord>(
        'SELECT * FROM formulario_cache WHERE formulario_id = ? AND version = ?',
        [parsed.formularioId, parsed.version],
      );

      if (!formDef) {
        await database.run(
          `INSERT INTO importacion_formularios_legacy (
            paciente_id, archivo_relativo, huella_sha256, huella_bak_sha256,
            destino_tipo, destino_id, estado, fecha_importacion, ultimo_error
          ) VALUES (?, ?, ?, ?, 'invalido', NULL, 'revision_requerida', ?, ?)
          ON CONFLICT (paciente_id, archivo_relativo) DO UPDATE SET
            estado = 'revision_requerida',
            ultimo_error = excluded.ultimo_error`,
          [
            patientId,
            relativeFileName,
            selectedSha256,
            bakSha256,
            now(),
            `Definición no encontrada para formulario '${parsed.formularioId}' v${parsed.version}`,
          ],
        );
        result.errors++;
        return;
      }

      // Si la entrega legacy estaba marcada como completada, validar sus respuestas
      if (parsed.completado) {
        const questions = await database.all<FormQuestionRecord>(
          'SELECT * FROM pregunta_cache WHERE formulario_id = ? AND version = ?',
          [parsed.formularioId, parsed.version],
        );

        const validation = validateFormQuestionsRecords(questions, parsed.respuestas);
        if (!validation.isValid) {
          const firstError = Object.values(validation.errors)[0];
          await database.run(
            `INSERT INTO importacion_formularios_legacy (
              paciente_id, archivo_relativo, huella_sha256, huella_bak_sha256,
              destino_tipo, destino_id, estado, fecha_importacion, ultimo_error
            ) VALUES (?, ?, ?, ?, 'invalido', NULL, 'revision_requerida', ?, ?)
            ON CONFLICT (paciente_id, archivo_relativo) DO UPDATE SET
              estado = 'revision_requerida',
              ultimo_error = excluded.ultimo_error`,
            [
              patientId,
              relativeFileName,
              selectedSha256,
              bakSha256,
              now(),
              `Entrega completada con respuestas inválidas: ${firstError}`,
            ],
          );
          result.errors++;
          return;
        }
      }

      // Comprobar si ya existe un borrador en SQLite
      const sqliteDraft = await database.first<{
        entrega_id: string;
        respuestas_json: string;
      }>(
        'SELECT entrega_id, respuestas_json FROM borrador_formulario WHERE paciente_id = ? AND formulario_id = ? AND version = ?',
        [patientId, parsed.formularioId, parsed.version],
      );

      // Si es un borrador y SQLite ya posee uno, comparar contenidos antes de omitir o limpiar
      if (!parsed.completado && sqliteDraft) {
        let sqliteAnswers: Record<string, unknown> | null;
        try {
          sqliteAnswers = JSON.parse(sqliteDraft.respuestas_json);
        } catch {
          sqliteAnswers = null;
        }

        const isIdentical = areAnswersEqual(sqliteAnswers, parsed.respuestas);
        if (!isIdentical) {
          // Las respuestas difieren: conservar el archivo físico y registrar revisión requerida
          await database.run(
            `INSERT INTO importacion_formularios_legacy (
              paciente_id, archivo_relativo, huella_sha256, huella_bak_sha256,
              destino_tipo, destino_id, estado, fecha_importacion, ultimo_error
            ) VALUES (?, ?, ?, ?, 'borrador', ?, 'revision_requerida', ?, ?)
            ON CONFLICT (paciente_id, archivo_relativo) DO UPDATE SET
              estado = 'revision_requerida',
              ultimo_error = excluded.ultimo_error`,
            [
              patientId,
              relativeFileName,
              selectedSha256,
              bakSha256,
              sqliteDraft.entrega_id,
              now(),
              'Conflicto: borrador existente en SQLite con respuestas diferentes',
            ],
          );
          result.errors++;
          return;
        }
      }

      const timestamp = now();
      let destinoTipo: 'borrador' | 'respuesta' = 'borrador';
      let destinoId: string = parsed.formularioId;

      // 3. Transacción SQL dedicada para este borrador/respuesta
      await database.transaction(async (tx) => {
        if (parsed.completado) {
          destinoTipo = 'respuesta';
          const deliveryId = newId();
          destinoId = deliveryId;
          const queueId = newId();

          // Inserción en respuesta_formulario
          await tx.run(
            `INSERT INTO respuesta_formulario (
              id, paciente_id, formulario_id, version, respuestas_json, fecha_confirmacion, creado_localmente_en
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              deliveryId,
              patientId,
              parsed.formularioId,
              parsed.version,
              JSON.stringify(parsed.respuestas),
              parsed.guardadoEn,
              timestamp,
            ],
          );

          // Inserción en cola_envio
          await tx.run(
            `INSERT INTO cola_envio (
              id, paciente_id, tipo_entidad, registro_id, payload_json, estado, creado_en, actualizado_en
            ) VALUES (?, ?, 'respuesta_formulario', ?, ?, 'pendiente', ?, ?)`,
            [
              queueId,
              patientId,
              deliveryId,
              JSON.stringify({
                schemaVersion: 1,
                entity: 'respuesta_formulario',
                record: {
                  id: deliveryId,
                  paciente_id: patientId,
                  formulario_id: parsed.formularioId,
                  version: parsed.version,
                  respuestas: parsed.respuestas,
                  fecha_confirmacion: parsed.guardadoEn,
                },
              }),
              timestamp,
              timestamp,
            ],
          );
        } else {
          destinoTipo = 'borrador';
          if (!sqliteDraft) {
            const deliveryId = newId();
            destinoId = deliveryId;
            await tx.run(
              `INSERT INTO borrador_formulario (
                paciente_id, formulario_id, version, entrega_id, respuestas_json, guardado_en, version_payload
              ) VALUES (?, ?, ?, ?, ?, ?, 1)`,
              [
                patientId,
                parsed.formularioId,
                parsed.version,
                deliveryId,
                JSON.stringify(parsed.respuestas),
                parsed.guardadoEn,
              ],
            );
          } else {
            destinoId = sqliteDraft.entrega_id;
          }
        }

        // Registrar inicialmente en limpieza_pendiente dentro de la misma transacción
        await tx.run(
          `INSERT INTO importacion_formularios_legacy (
            paciente_id, archivo_relativo, huella_sha256, huella_bak_sha256,
            destino_tipo, destino_id, estado, fecha_importacion, ultimo_error
          ) VALUES (?, ?, ?, ?, ?, ?, 'limpieza_pendiente', ?, NULL)
          ON CONFLICT (paciente_id, archivo_relativo) DO UPDATE SET
            huella_sha256 = excluded.huella_sha256,
            huella_bak_sha256 = excluded.huella_bak_sha256,
            destino_tipo = excluded.destino_tipo,
            destino_id = excluded.destino_id,
            estado = 'limpieza_pendiente',
            fecha_importacion = excluded.fecha_importacion,
            ultimo_error = NULL`,
          [
            patientId,
            relativeFileName,
            jsonSha256 ?? selectedSha256,
            bakSha256,
            destinoTipo,
            destinoId,
            timestamp,
          ],
        );
      });

      result.imported++;

      // 4. Limpieza física verificando huellas independientes tras el commit exitoso
      let cleanJsonOk = true;
      let cleanBakOk = true;

      if (jsonExists && (await adapter.exists(jsonPath))) {
        try {
          const currentRaw = await adapter.readText(jsonPath);
          const currentSha = await computeSha256(currentRaw);
          if (currentSha === jsonSha256) {
            const deleted = await adapter.deleteFile(jsonPath);
            const stillExists = await adapter.exists(jsonPath);
            cleanJsonOk = deleted && !stillExists;
          } else {
            cleanJsonOk = false;
          }
        } catch {
          cleanJsonOk = false;
        }
      }

      if (bakExists && (await adapter.exists(bakPath))) {
        try {
          const currentBakRaw = await adapter.readText(bakPath);
          const currentBakSha = await computeSha256(currentBakRaw);
          if (currentBakSha === bakSha256) {
            const deleted = await adapter.deleteFile(bakPath);
            const stillExists = await adapter.exists(bakPath);
            cleanBakOk = deleted && !stillExists;
          } else {
            cleanBakOk = false;
          }
        } catch {
          cleanBakOk = false;
        }
      }

      if (cleanJsonOk && cleanBakOk) {
        await database.run(
          `UPDATE importacion_formularios_legacy
           SET estado = 'importado', ultimo_error = NULL
           WHERE paciente_id = ? AND archivo_relativo = ?`,
          [patientId, relativeFileName],
        );
        result.cleaned++;
      } else {
        result.pendingCleanups++;
      }
    });
  }

  return result;
}
