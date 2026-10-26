import { Ajv2020 } from 'ajv/dist/2020.js';
import formatsPlugin from 'ajv-formats';
import type { FormatsPlugin } from 'ajv-formats';
import pdfSchema from '../schemas/education-document-v1_1.schema.json' with { type: 'json' };
import eproSchema from '../schemas/schema-configuracion-epro-v1-objetivo.json' with { type: 'json' };
import type { ContractResult } from './validation.js';

export interface EducationDocumentV11 {
  id: string;
  profesional_id: string;
  titulo: string;
  descripcion: string;
  tipo: 'documento';
  formato: 'pdf';
  url: string;
  categoria: string;
  activo: true;
  fecha_creacion: string;
  carpeta_id?: string | null;
  archivo_mime: 'application/pdf';
  archivo_tamano_bytes: number;
  archivo_revision: string;
  archivo_sha256: string;
}
const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
});
(formatsPlugin as unknown as FormatsPlugin)(ajv);
const validateDocument = ajv.compile(pdfSchema);
const validateConfiguration = ajv.compile(eproSchema);
export function validateEducationDocument(value: unknown): ContractResult {
  const valid = validateDocument(value);
  return {
    valid,
    errors: valid
      ? []
      : (validateDocument.errors ?? []).map((e) => ({
          location: 'document' + e.instancePath,
          keyword: e.keyword,
          message: e.message ?? 'Invalid document',
        })),
  };
}
export function validateEproConfiguration(value: unknown): ContractResult {
  const valid = validateConfiguration(value);
  return {
    valid,
    errors: valid
      ? []
      : (validateConfiguration.errors ?? []).map((e) => ({
          location: 'configuration' + e.instancePath,
          keyword: e.keyword,
          message: e.message ?? 'Invalid configuration',
        })),
  };
}
