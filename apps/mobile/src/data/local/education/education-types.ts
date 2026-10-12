export type EducationalContentType = 'guia' | 'infografia' | 'video';

export type EducationalCopyFormat = 'markdown' | 'png' | 'jpeg';

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
  description: string;
  type: EducationalContentType;
  version: string;
  estimatedReadTimeMinutes?: number;
  youtubeVideoId?: string;
  asset?: EducationalAssetRef;
  contentMarkdown?: string;
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
}

export interface EducationalLocalCopy {
  patientId: string;
  contentId: string;
  rutaRelativa: string;
  rutaAbsoluta?: string;
  formato: EducationalCopyFormat;
  tamanoBytes: number;
  descargadoEn: string;
  visualizadoEn?: string | null;
  revisionDeclarada: boolean;
  revisionDeclaradaEn?: string | null;
  metadataLocal?: EducationalLocalCopyMetadata;
}

export interface EducationalResourceWithStatus extends EducationalResource {
  interaction?: EducationalInteraction | null;
  localCopy?: EducationalLocalCopy | null;
}
