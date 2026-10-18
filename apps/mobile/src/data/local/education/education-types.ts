export type EducationalContentType = 'guia' | 'infografia' | 'video';

export type ActiveEducationalCopyFormat = 'png' | 'jpeg';

export type EducationalCopyFormat = ActiveEducationalCopyFormat | 'markdown';

export type EducationalAssetRef =
  | {
      type: 'bundled';
      assetKey: string;
      extension: 'md' | 'png' | 'jpg' | 'jpeg';
      mimeType: string;
    }
  | {
      type: 'remote';
      url: string;
      extension: 'md' | 'png' | 'jpg' | 'jpeg';
      mimeType: string;
    };

export interface EducationalResource {
  id: string;
  title: string;
  category: number;
  categoryName: string;
  categorySlug?: string;
  description: string;
  type: EducationalContentType;
  version: string;
  estimatedReadTimeMinutes?: number;
  youtubeVideoId?: string;
  asset?: EducationalAssetRef;
  contentMarkdown?: string;
  textoAccesible?: string;
}

export interface EducationalInteraction {
  patientId: string;
  contentId: string;
  youtubeVideoId?: string | null;
  versionOrigen?: string | null;
  revisionDeclaradaEn?: string | null;
  creadoEn: string;
  actualizadoEn: string;
}

export interface EducationalLocalCopyMetadata {
  sha256?: string;
  versionOrigen?: string;
  mimeType?: string;
  anchoPx?: number;
  altoPx?: number;
  titulo?: string;
  tipo?: EducationalContentType;
  descripcion?: string;
  textoAccesible?: string;
  [key: string]: unknown;
}

export interface EducationalLocalCopy {
  patientId: string;
  contentId: string;
  rutaRelativa: string;
  rutaAbsoluta?: string;
  formato: EducationalCopyFormat;
  tamanoBytes: number;
  estado?: 'pendiente' | 'descargado' | 'error';
  titulo?: string;
  tipo?: EducationalContentType;
  descripcion?: string;
  descargadoEn: string;
  visualizadoEn?: string | null;
  revisionDeclarada: boolean;
  revisionDeclaradaEn?: string | null;
  retiradoEn?: string | null;
  ultimoErrorRetiro?: string | null;
  metadataLocal?: EducationalLocalCopyMetadata;
}

export interface EducationalResourceWithStatus extends EducationalResource {
  interaction?: EducationalInteraction | null;
  localCopy?: EducationalLocalCopy | null;
}
