import preparation from '../specs/openapi-simulador-preparacion-v1.json' with { type: 'json' };
import clinical from '../specs/openapi-clinico-rc32-bundle.json' with { type: 'json' };
import ai from '../specs/openapi-ia-rc31.json' with { type: 'json' };
import gateway from '../specs/openapi-gateway-quimiocare-v1.json' with { type: 'json' };
import evaluation from '../specs/openapi-simulador-evaluacion-v1.json' with { type: 'json' };
import type { ContractDocument, JsonObject } from './documents.js';

export interface ServerConfig {
  url: string;
  description?: string;
}

export const DEFAULT_CLINICAL_SERVERS: ServerConfig[] = [
  {
    url: 'http://127.0.0.1:18018/quimiocare',
    description: 'Proxy Nginx de Evaluación (Puerto 18018)',
  },
  { url: 'http://localhost:3002', description: 'Simulador Clínico directo (Puerto 3002)' },
];

export const DEFAULT_GATEWAY_SERVERS: ServerConfig[] = [
  {
    url: 'http://127.0.0.1:18019/quimiocare-backend',
    description: 'Proxy Nginx de Evaluación (Puerto 18019)',
  },
  { url: 'http://localhost:3001', description: 'Gateway QuimioCare directo (Puerto 3001)' },
];

export const DEFAULT_EVALUATION_SERVERS: ServerConfig[] = [
  {
    url: 'http://127.0.0.1:18018/quimiocare',
    description: 'Proxy Nginx de Evaluación (Puerto 18018)',
  },
  { url: 'http://localhost:3002', description: 'Simulador Clínico directo (Puerto 3002)' },
];

/**
 * Genera el documento de ejecución unificado para la interfaz de documentación
 * de las 17 operaciones contractuales (16 Clínicas + 1 IA).
 * Adapta exclusivamente los servidores y fusiona esquemas sin mutar los contratos originales.
 */
export function getClinicalAiExecutionDoc(
  servers: ServerConfig[] = DEFAULT_CLINICAL_SERVERS,
): ContractDocument {
  const clinicalDoc = clinical as unknown as ContractDocument;
  const aiDoc = ai as unknown as ContractDocument;

  const mergedPaths: JsonObject = {
    ...JSON.parse(JSON.stringify(clinicalDoc.paths)),
    ...JSON.parse(JSON.stringify(aiDoc.paths)),
  };

  const clinicalComponents = (clinicalDoc.components ?? {}) as JsonObject;
  const aiComponents = (aiDoc.components ?? {}) as JsonObject;

  const mergedSchemas: JsonObject = {
    ...((clinicalComponents.schemas ?? {}) as JsonObject),
    ...((aiComponents.schemas ?? {}) as JsonObject),
  };

  const mergedSecuritySchemes: JsonObject = {
    ...((clinicalComponents.securitySchemes ?? {}) as JsonObject),
    ...((aiComponents.securitySchemes ?? {}) as JsonObject),
  };

  return {
    openapi: '3.1.0',
    info: {
      title: 'QuimioCare — Contrato Clínico e IA Unificado (17 Operaciones)',
      version: '1.0.0-rc32-local',
      description:
        'Documento de ejecución local que unifica las 16 operaciones clínicas acordadas y la operación de IA (IA-01), manteniendo estricta fidelidad con los esquemas originales.',
    },
    servers,
    paths: mergedPaths as ContractDocument['paths'],
    components: {
      ...clinicalComponents,
      ...aiComponents,
      schemas: mergedSchemas,
      securitySchemes: mergedSecuritySchemes,
    },
  };
}

/**
 * Genera el documento de ejecución para las operaciones auxiliares de evaluación del simulador:
 * Vinculación sintética y publicación multipart educativa.
 */
export function getEvaluationExecutionDoc(
  servers: ServerConfig[] = DEFAULT_EVALUATION_SERVERS,
): ContractDocument {
  const evalDoc = JSON.parse(JSON.stringify(evaluation)) as ContractDocument;
  evalDoc.servers = servers;
  return evalDoc;
}

/**
 * Genera el documento de ejecución para el contrato del Gateway de QuimioCare.
 */
export function getGatewayExecutionDoc(
  servers: ServerConfig[] = DEFAULT_GATEWAY_SERVERS,
): ContractDocument {
  const gwDoc = JSON.parse(JSON.stringify(gateway)) as ContractDocument;
  gwDoc.servers = servers;
  return gwDoc;
}

export function getPreparationExecutionDoc(
  servers: ServerConfig[] = DEFAULT_EVALUATION_SERVERS,
): ContractDocument {
  return { ...structuredClone(preparation), servers } as unknown as ContractDocument;
}
