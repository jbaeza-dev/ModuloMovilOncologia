import type { SqlConnection } from '../core/sql';
import type {
  ActiveEducationalCopyFormat,
  EducationalCopyFormat,
  EducationalInteraction,
  EducationalLocalCopy,
  EducationalLocalCopyMetadata,
  EducationalResource,
  EducationalResourceWithStatus,
} from './education-types';

export function mapRowToLocalCopy(row: {
  paciente_id: string;
  contenido_id: string;
  ruta_local: string | null;
  estado: string;
  fecha_descarga: string | null;
  visualizada: number;
  visualizada_en: string | null;
  revision_declarada?: number;
  revision_declarada_en?: string | null;
  formato?: string;
  tamano_bytes?: number;
  metadata_local_json?: string | null;
  retirado_en?: string | null;
  ultimo_error_retiro?: string | null;
}): EducationalLocalCopy {
  let metadata: EducationalLocalCopyMetadata | undefined;
  if (row.metadata_local_json) {
    try {
      metadata = JSON.parse(row.metadata_local_json);
    } catch {
      // Ignorar json inválido
    }
  }

  const isReviewed = row.revision_declarada === 1;
  const isViewed = row.visualizada === 1;

  return {
    patientId: row.paciente_id,
    contentId: row.contenido_id,
    rutaRelativa: row.ruta_local ?? '',
    rutaAbsoluta: row.ruta_local ?? '',
    formato: (row.formato as EducationalCopyFormat) || 'png',
    tamanoBytes: row.tamano_bytes ?? 0,
    estado: (row.estado as 'pendiente' | 'descargado' | 'error') || 'descargado',
    titulo: metadata?.titulo,
    tipo: metadata?.tipo,
    descripcion: metadata?.descripcion,
    descargadoEn: row.fecha_descarga ?? '',
    visualizadoEn: isViewed ? row.visualizada_en : null,
    revisionDeclarada: isReviewed,
    revisionDeclaradaEn: isReviewed ? (row.revision_declarada_en ?? null) : null,
    retiradoEn: row.retirado_en ?? null,
    ultimoErrorRetiro: row.ultimo_error_retiro ?? null,
    metadataLocal: metadata,
  };
}

export function mapRowToInteraction(row: {
  paciente_id: string;
  contenido_id: string;
  youtube_video_id: string | null;
  version_origen: string | null;
  revision_declarada_en: string | null;
  creado_en: string;
  actualizado_en: string;
}): EducationalInteraction {
  return {
    patientId: row.paciente_id,
    contentId: row.contenido_id,
    youtubeVideoId: row.youtube_video_id,
    versionOrigen: row.version_origen,
    revisionDeclaradaEn: row.revision_declarada_en,
    creadoEn: row.creado_en,
    actualizadoEn: row.actualizado_en,
  };
}

export interface EducationRepository {
  getInteraction(contentId: string): Promise<EducationalInteraction | null>;
  listInteractions(): Promise<EducationalInteraction[]>;
  getLocalCopy(contentId: string): Promise<EducationalLocalCopy | null>;
  listLocalCopies(): Promise<EducationalLocalCopy[]>;
  getRetiredCopy(contentId: string): Promise<EducationalLocalCopy | null>;
  listRetiredCopies(): Promise<EducationalLocalCopy[]>;
  recordRetiredCopyError(contentId: string, rutaLocal: string, errorMensaje: string): Promise<void>;
  removeRetiredCopy(contentId: string, rutaLocal: string): Promise<boolean>;
  getResourceWithStatus(resource: EducationalResource): Promise<EducationalResourceWithStatus>;
  listCatalogWithStatus(
    catalog?: readonly EducationalResource[],
  ): Promise<EducationalResourceWithStatus[]>;

  recordYouTubeInteraction(params: {
    contentId: string;
    youtubeVideoId: string;
    versionOrigen?: string;
  }): Promise<EducationalInteraction>;
  declareYouTubeReviewed(params: {
    contentId: string;
    youtubeVideoId: string;
    versionOrigen?: string;
  }): Promise<{ updated: boolean }>;

  persistCopyInTx(
    tx: SqlConnection,
    params: {
      contentId: string;
      rutaLocal: string;
      formato: ActiveEducationalCopyFormat;
      tamanoBytes: number;
      nowIso: string;
      metadataLocal?: EducationalLocalCopyMetadata;
    },
  ): Promise<EducationalLocalCopy>;

  saveLocalCopy(params: {
    contentId: string;
    rutaLocal: string;
    formato: ActiveEducationalCopyFormat;
    tamanoBytes: number;
    metadataLocal?: EducationalLocalCopyMetadata;
  }): Promise<EducationalLocalCopy>;

  declareCopyReviewed(contentId: string): Promise<{ updated: boolean }>;
  markCopyViewed(contentId: string): Promise<{ updated: boolean }>;
  removeLocalCopy(contentId: string): Promise<{ removed: boolean }>;
}

export function createEducationRepository(
  database: SqlConnection,
  patientId: string,
  nowProvider: () => string = () => new Date().toISOString(),
): EducationRepository {
  return {
    async getInteraction(contentId: string): Promise<EducationalInteraction | null> {
      const row = await database.first<{
        paciente_id: string;
        contenido_id: string;
        youtube_video_id: string | null;
        version_origen: string | null;
        revision_declarada_en: string | null;
        creado_en: string;
        actualizado_en: string;
      }>('SELECT * FROM interaccion_educativa_local WHERE paciente_id = ? AND contenido_id = ?', [
        patientId,
        contentId,
      ]);
      return row ? mapRowToInteraction(row) : null;
    },

    async listInteractions(): Promise<EducationalInteraction[]> {
      const rows = await database.all<{
        paciente_id: string;
        contenido_id: string;
        youtube_video_id: string | null;
        version_origen: string | null;
        revision_declarada_en: string | null;
        creado_en: string;
        actualizado_en: string;
      }>(
        'SELECT * FROM interaccion_educativa_local WHERE paciente_id = ? ORDER BY actualizado_en DESC',
        [patientId],
      );
      return rows.map(mapRowToInteraction);
    },

    async getLocalCopy(contentId: string): Promise<EducationalLocalCopy | null> {
      const row = await database.first<{
        paciente_id: string;
        contenido_id: string;
        ruta_local: string | null;
        estado: string;
        fecha_descarga: string | null;
        visualizada: number;
        visualizada_en: string | null;
        revision_declarada?: number;
        revision_declarada_en?: string | null;
        formato?: string;
        tamano_bytes?: number;
        metadata_local_json?: string | null;
        retirado_en?: string | null;
        ultimo_error_retiro?: string | null;
      }>(
        `SELECT * FROM descarga WHERE paciente_id = ? AND contenido_id = ? AND retirado_en IS NULL`,
        [patientId, contentId],
      );
      return row ? mapRowToLocalCopy(row) : null;
    },

    async listLocalCopies(): Promise<EducationalLocalCopy[]> {
      const rows = await database.all<{
        paciente_id: string;
        contenido_id: string;
        ruta_local: string | null;
        estado: string;
        fecha_descarga: string | null;
        visualizada: number;
        visualizada_en: string | null;
        revision_declarada?: number;
        revision_declarada_en?: string | null;
        formato?: string;
        tamano_bytes?: number;
        metadata_local_json?: string | null;
        retirado_en?: string | null;
        ultimo_error_retiro?: string | null;
      }>(
        `SELECT * FROM descarga WHERE paciente_id = ? AND retirado_en IS NULL ORDER BY COALESCE(fecha_descarga, '1970-01-01') DESC`,
        [patientId],
      );
      return rows.map(mapRowToLocalCopy);
    },

    async getRetiredCopy(contentId: string): Promise<EducationalLocalCopy | null> {
      const row = await database.first<{
        paciente_id: string;
        contenido_id: string;
        ruta_local: string | null;
        estado: string;
        fecha_descarga: string | null;
        visualizada: number;
        visualizada_en: string | null;
        revision_declarada?: number;
        revision_declarada_en?: string | null;
        formato?: string;
        tamano_bytes?: number;
        metadata_local_json?: string | null;
        retirado_en?: string | null;
        ultimo_error_retiro?: string | null;
      }>(
        `SELECT * FROM descarga WHERE paciente_id = ? AND contenido_id = ? AND retirado_en IS NOT NULL`,
        [patientId, contentId],
      );
      return row ? mapRowToLocalCopy(row) : null;
    },

    async listRetiredCopies(): Promise<EducationalLocalCopy[]> {
      const rows = await database.all<{
        paciente_id: string;
        contenido_id: string;
        ruta_local: string | null;
        estado: string;
        fecha_descarga: string | null;
        visualizada: number;
        visualizada_en: string | null;
        revision_declarada?: number;
        revision_declarada_en?: string | null;
        formato?: string;
        tamano_bytes?: number;
        metadata_local_json?: string | null;
        retirado_en?: string | null;
        ultimo_error_retiro?: string | null;
      }>(
        `SELECT * FROM descarga WHERE paciente_id = ? AND retirado_en IS NOT NULL ORDER BY COALESCE(retirado_en, fecha_descarga) DESC`,
        [patientId],
      );
      return rows.map(mapRowToLocalCopy);
    },

    async recordRetiredCopyError(
      contentId: string,
      rutaLocal: string,
      errorMensaje: string,
    ): Promise<void> {
      await database.run(
        `UPDATE descarga
         SET ultimo_error_retiro = ?
         WHERE paciente_id = ? AND contenido_id = ? AND retirado_en IS NOT NULL AND ruta_local = ?`,
        [errorMensaje, patientId, contentId, rutaLocal],
      );
    },

    async removeRetiredCopy(contentId: string, rutaLocal: string): Promise<boolean> {
      const existing = await database.first<{ count: number }>(
        `SELECT COUNT(*) as count FROM descarga
         WHERE paciente_id = ? AND contenido_id = ? AND retirado_en IS NOT NULL AND ruta_local = ?`,
        [patientId, contentId, rutaLocal],
      );
      if (!existing || existing.count === 0) {
        return false;
      }
      await database.run(
        `DELETE FROM descarga
         WHERE paciente_id = ? AND contenido_id = ? AND retirado_en IS NOT NULL AND ruta_local = ?`,
        [patientId, contentId, rutaLocal],
      );
      return true;
    },

    async getResourceWithStatus(
      resource: EducationalResource,
    ): Promise<EducationalResourceWithStatus> {
      const interaction = resource.type === 'video' ? await this.getInteraction(resource.id) : null;
      const localCopy = resource.type !== 'video' ? await this.getLocalCopy(resource.id) : null;
      return {
        ...resource,
        interaction,
        localCopy,
      };
    },

    async listCatalogWithStatus(
      catalog: readonly EducationalResource[] = [],
    ): Promise<EducationalResourceWithStatus[]> {
      const [interactions, copies] = await Promise.all([
        this.listInteractions(),
        this.listLocalCopies(),
      ]);
      const interactionMap = new Map(interactions.map((i) => [i.contentId, i]));
      const copyMap = new Map(copies.map((c) => [c.contentId, c]));

      return catalog.map((resource) => ({
        ...resource,
        interaction: interactionMap.get(resource.id) ?? null,
        localCopy: copyMap.get(resource.id) ?? null,
      }));
    },

    async recordYouTubeInteraction(params: {
      contentId: string;
      youtubeVideoId: string;
      versionOrigen?: string;
    }): Promise<EducationalInteraction> {
      const nowIso = nowProvider();
      const versionOrigen = params.versionOrigen ?? null;

      await database.run(
        `INSERT INTO interaccion_educativa_local (
          paciente_id, contenido_id, youtube_video_id, version_origen, revision_declarada_en, creado_en, actualizado_en
        ) VALUES (?, ?, ?, ?, NULL, ?, ?)
        ON CONFLICT(paciente_id, contenido_id) DO UPDATE SET
          youtube_video_id = excluded.youtube_video_id,
          version_origen = excluded.version_origen,
          revision_declarada_en = CASE
            WHEN interaccion_educativa_local.youtube_video_id = excluded.youtube_video_id
              AND interaccion_educativa_local.version_origen IS excluded.version_origen
            THEN interaccion_educativa_local.revision_declarada_en
            ELSE NULL
          END,
          actualizado_en = excluded.actualizado_en`,
        [patientId, params.contentId, params.youtubeVideoId, versionOrigen, nowIso, nowIso],
      );

      const row = await database.first<{
        paciente_id: string;
        contenido_id: string;
        youtube_video_id: string | null;
        version_origen: string | null;
        revision_declarada_en: string | null;
        creado_en: string;
        actualizado_en: string;
      }>('SELECT * FROM interaccion_educativa_local WHERE paciente_id = ? AND contenido_id = ?', [
        patientId,
        params.contentId,
      ]);

      if (!row) {
        throw new Error('No se pudo recuperar la interacción registrada de YouTube.');
      }
      return mapRowToInteraction(row);
    },

    async declareYouTubeReviewed(params: {
      contentId: string;
      youtubeVideoId: string;
      versionOrigen?: string;
    }): Promise<{ updated: boolean }> {
      const nowIso = nowProvider();
      const versionOrigen = params.versionOrigen ?? null;

      const existing = await database.first<{ revision_declarada_en: string | null }>(
        `SELECT revision_declarada_en FROM interaccion_educativa_local
         WHERE paciente_id = ?
           AND contenido_id = ?
           AND youtube_video_id = ?
           AND version_origen IS ?`,
        [patientId, params.contentId, params.youtubeVideoId, versionOrigen],
      );

      if (!existing) {
        return { updated: false };
      }

      await database.run(
        `UPDATE interaccion_educativa_local
         SET revision_declarada_en = ?, actualizado_en = ?
         WHERE paciente_id = ?
           AND contenido_id = ?
           AND youtube_video_id = ?
           AND version_origen IS ?`,
        [nowIso, nowIso, patientId, params.contentId, params.youtubeVideoId, versionOrigen],
      );

      return { updated: true };
    },

    async persistCopyInTx(
      tx: SqlConnection,
      params: {
        contentId: string;
        rutaLocal: string;
        formato: ActiveEducationalCopyFormat;
        tamanoBytes: number;
        nowIso: string;
        metadataLocal?: EducationalLocalCopyMetadata;
      },
    ): Promise<EducationalLocalCopy> {
      // 1. Consultar estado previo para evaluar conservación estricta de revisión
      const existing = await tx.first<{
        revision_declarada: number;
        revision_declarada_en: string | null;
        metadata_local_json: string | null;
      }>(
        'SELECT revision_declarada, revision_declarada_en, metadata_local_json FROM descarga WHERE paciente_id = ? AND contenido_id = ?',
        [patientId, params.contentId],
      );

      let keepReview = false;
      let prevReviewDate: string | null = null;

      if (existing && existing.revision_declarada === 1) {
        try {
          const prevMeta: EducationalLocalCopyMetadata = existing.metadata_local_json
            ? JSON.parse(existing.metadata_local_json)
            : {};
          const prevVer = prevMeta.versionOrigen ?? null;
          const nextVer = params.metadataLocal?.versionOrigen ?? null;
          const sameVersion = prevVer === nextVer;
          const sameSha =
            Boolean(prevMeta.sha256) && prevMeta.sha256 === params.metadataLocal?.sha256;

          // Se exige identidad de versión (incluyendo ambas nulas) Y de sha256 para conservarla
          if (sameVersion && sameSha) {
            keepReview = true;
            prevReviewDate = existing.revision_declarada_en;
          }
        } catch {
          keepReview = false;
        }
      }

      const finalRevision = keepReview ? 1 : 0;
      const finalRevisionEn = keepReview ? prevReviewDate : null;
      const metadataJson = params.metadataLocal ? JSON.stringify(params.metadataLocal) : null;

      await tx.run(
        `INSERT INTO descarga (
          paciente_id, contenido_id, ruta_local, estado, fecha_descarga,
          visualizada, visualizada_en, revision_declarada, revision_declarada_en,
          formato, tamano_bytes, metadata_local_json, retirado_en, ultimo_error_retiro
        ) VALUES (?, ?, ?, 'descargado', ?, 0, NULL, ?, ?, ?, ?, ?, NULL, NULL)
        ON CONFLICT(paciente_id, contenido_id) DO UPDATE SET
          ruta_local = excluded.ruta_local,
          estado = 'descargado',
          fecha_descarga = excluded.fecha_descarga,
          visualizada = 0,
          visualizada_en = NULL,
          revision_declarada = excluded.revision_declarada,
          revision_declarada_en = excluded.revision_declarada_en,
          formato = excluded.formato,
          tamano_bytes = excluded.tamano_bytes,
          metadata_local_json = excluded.metadata_local_json,
          retirado_en = NULL,
          ultimo_error_retiro = NULL`,
        [
          patientId,
          params.contentId,
          params.rutaLocal,
          params.nowIso,
          finalRevision,
          finalRevisionEn,
          params.formato,
          params.tamanoBytes,
          metadataJson,
        ],
      );

      return {
        patientId,
        contentId: params.contentId,
        rutaRelativa: params.rutaLocal,
        rutaAbsoluta: params.rutaLocal,
        formato: params.formato,
        tamanoBytes: params.tamanoBytes,
        estado: 'descargado',
        titulo: params.metadataLocal?.titulo,
        tipo: params.metadataLocal?.tipo,
        descripcion: params.metadataLocal?.descripcion,
        descargadoEn: params.nowIso,
        visualizadoEn: null,
        revisionDeclarada: finalRevision === 1,
        revisionDeclaradaEn: finalRevisionEn,
        retiradoEn: null,
        ultimoErrorRetiro: null,
        metadataLocal: params.metadataLocal,
      };
    },

    async saveLocalCopy(params: {
      contentId: string;
      rutaLocal: string;
      formato: ActiveEducationalCopyFormat;
      tamanoBytes: number;
      metadataLocal?: EducationalLocalCopyMetadata;
    }): Promise<EducationalLocalCopy> {
      const nowIso = nowProvider();
      let record!: EducationalLocalCopy;

      await database.transaction(async (tx) => {
        record = await this.persistCopyInTx(tx, {
          ...params,
          nowIso,
        });
      });

      return record;
    },

    async declareCopyReviewed(contentId: string): Promise<{ updated: boolean }> {
      const nowIso = nowProvider();
      const existing = await database.first<{ revision_declarada: number }>(
        `SELECT revision_declarada FROM descarga WHERE paciente_id = ? AND contenido_id = ? AND estado = 'descargado'`,
        [patientId, contentId],
      );
      if (!existing) {
        return { updated: false };
      }

      await database.run(
        `UPDATE descarga
         SET revision_declarada = 1, revision_declarada_en = ?
         WHERE paciente_id = ? AND contenido_id = ? AND estado = 'descargado'`,
        [nowIso, patientId, contentId],
      );
      return { updated: true };
    },

    async markCopyViewed(contentId: string): Promise<{ updated: boolean }> {
      const nowIso = nowProvider();
      const existing = await database.first<{ visualizada: number }>(
        `SELECT visualizada FROM descarga WHERE paciente_id = ? AND contenido_id = ? AND estado = 'descargado'`,
        [patientId, contentId],
      );
      if (!existing) {
        return { updated: false };
      }

      await database.run(
        `UPDATE descarga
         SET visualizada = 1, visualizada_en = ?
         WHERE paciente_id = ? AND contenido_id = ? AND estado = 'descargado'`,
        [nowIso, patientId, contentId],
      );
      return { updated: true };
    },

    async removeLocalCopy(contentId: string): Promise<{ removed: boolean }> {
      const existing = await database.first<{ contenido_id: string }>(
        'SELECT contenido_id FROM descarga WHERE paciente_id = ? AND contenido_id = ?',
        [patientId, contentId],
      );
      if (!existing) {
        return { removed: false };
      }

      await database.run('DELETE FROM descarga WHERE paciente_id = ? AND contenido_id = ?', [
        patientId,
        contentId,
      ]);
      return { removed: true };
    },
  };
}
