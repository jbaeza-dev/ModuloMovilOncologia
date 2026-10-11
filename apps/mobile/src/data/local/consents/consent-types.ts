export type TermDefinitionRecord = {
  termino_id: string;
  version: string;
  titulo: string;
  contenido_markdown: string;
  requerido: number;
  vigente_desde: string;
  vigente_hasta: string | null;
  huella_sha256: string;
  obtenido_en: string;
};

export type UserConsentRecord = {
  id: string;
  paciente_id: string;
  termino_id: string;
  version: string;
  estado: 'otorgado' | 'revocado';
  fecha_otorgamiento: string;
  fecha_revocacion: string | null;
  creado_en: string;
};

export type ConsentEventRecord = {
  id: string;
  paciente_id: string;
  consentimiento_id: string;
  termino_id: string;
  version: string;
  secuencia: number;
  accion: 'otorgado' | 'revocado';
  fecha_evento: string;
};

export type ConsentStatus = 'nunca_otorgado' | 'otorgado' | 'revocado';

export type ConsentStatusInfo = {
  terminoId: string;
  version: string;
  estado: ConsentStatus;
  activeConsent: UserConsentRecord | null;
  lastConsent: UserConsentRecord | null;
  lastEvent: ConsentEventRecord | null;
};

export type ConsentQueueRecord = {
  id: string;
  consentimiento_id: string;
  paciente_id: string;
  termino_id: string;
  version: string;
  secuencia: number;
  accion: 'otorgado' | 'revocado';
  fecha_evento: string;
};

export type TermDefinitionBundle = {
  terminos: Array<{
    terminoId: string;
    version: string;
    titulo: string;
    contenidoMarkdown: string;
    requerido?: boolean | number;
    vigenteDesde: string;
    vigenteHasta?: string | null;
    obtenidoEn?: string;
  }>;
};
