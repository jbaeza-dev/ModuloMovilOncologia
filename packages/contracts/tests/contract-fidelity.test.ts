import { describe, expect, it } from 'vitest';
import clinical from '../specs/openapi-clinico-rc32-bundle.json' with { type: 'json' };
import ai from '../specs/openapi-ia-rc31.json' with { type: 'json' };
import {
  contractInventory,
  getClinicalAiExecutionDoc,
  getEvaluationExecutionDoc,
  getGatewayExecutionDoc,
} from '../src/index.js';

describe('Fidelidad Contractual y Especificaciones de Ejecución', () => {
  it('conserva cada operación y schema de los archivos externos originales', () => {
    const projected = getClinicalAiExecutionDoc();
    const schemas = (projected.components as { schemas: Record<string, unknown> }).schemas;
    for (const source of [clinical, ai]) {
      for (const [path, operation] of Object.entries(source.paths))
        expect(projected.paths[path]).toEqual(operation);
      for (const [name, schema] of Object.entries(source.components.schemas))
        expect(schemas[name]).toEqual(schema);
    }
  });
  it('el inventario contiene exactamente 16 operaciones clínicas y 1 operación de IA', () => {
    const clinicalOps = contractInventory.filter((item) => item.servicio === 'Clínica');
    const aiOps = contractInventory.filter((item) => item.servicio === 'IA');

    expect(clinicalOps).toHaveLength(16);
    expect(aiOps).toHaveLength(1);

    const expectedClinicalPaths = [
      '/api/v1/auth/me',
      '/api/v1/auth/completar-perfil-paciente',
      '/api/v1/pacientes/me/perfil-clinico',
      '/api/v1/pacientes/me/tratamiento-activo',
      '/api/v1/pacientes/me/codigo-vinculacion',
      '/api/v1/pacientes/me/signos-vitales',
      '/api/v1/pacientes/me/signos-vitales/sync',
      '/api/v1/formularios/activo',
      '/api/v1/formularios/{formulario_id}',
      '/api/v1/formularios/{formulario_id}/respuestas',
      '/api/v1/contenido-educativo',
      '/api/v1/contenido-educativo/categorias',
      '/api/v1/contenido-educativo/{contenido_id}',
      '/api/v1/terminos/vigente',
      '/api/v1/pacientes/me/consentimientos',
      '/api/v1/pacientes/me/consentimientos',
    ];

    for (const path of expectedClinicalPaths) {
      expect(clinicalOps.some((op) => op.ruta === path)).toBe(true);
    }

    expect(aiOps[0]?.ruta).toBe('/api/v1/chat');
    expect(aiOps[0]?.metodo).toBe('POST');
  });

  it('el documento de ejecución clínico e IA unifica las 17 operaciones sin alterar schemas', () => {
    const doc = getClinicalAiExecutionDoc();

    expect(doc.openapi).toBe('3.1.0');
    expect(doc.servers).toBeDefined();
    expect(doc.servers).toHaveLength(2);
    expect(doc.servers?.[0]?.url).toBe('http://127.0.0.1:18018/quimiocare');

    // Verificar que todas las 16 operaciones clínicas están presentes
    for (const item of contractInventory.filter((i) => i.servicio === 'Clínica')) {
      const pathItem = doc.paths[item.ruta] as Record<string, { operationId?: string }> | undefined;
      expect(pathItem, `Ruta clínica faltante en doc de ejecución: ${item.ruta}`).toBeDefined();
      const op = pathItem?.[item.metodo.toLowerCase()];
      expect(op, `Método ${item.metodo} faltante en ruta ${item.ruta}`).toBeDefined();
      expect(op?.operationId).toBe(item.operationId);
    }

    // Verificar que la operación de IA está presente
    const chatPath = doc.paths['/api/v1/chat'] as
      | Record<string, { operationId?: string }>
      | undefined;
    expect(chatPath).toBeDefined();
    expect(chatPath?.post?.operationId).toBe('chat_endpoint_api_v1_chat_post');

    // Verificar esquemas componentes de IA
    const schemas = (doc.components as { schemas?: Record<string, unknown> })?.schemas ?? {};
    expect(schemas.ChatRequest).toBeDefined();
    expect(schemas.ChatResponse).toBeDefined();

    // Verificar esquema de seguridad HTTPBearer
    const security =
      (doc.components as { securitySchemes?: Record<string, unknown> })?.securitySchemes ?? {};
    expect(security.HTTPBearer).toBeDefined();
  });

  it('el documento de ejecución de evaluación define vinculación y publicación multipart', () => {
    const doc = getEvaluationExecutionDoc();

    expect(doc.openapi).toBe('3.1.0');
    expect(doc.servers).toBeDefined();
    expect(doc.servers?.[0]?.url).toBe('http://127.0.0.1:18018/quimiocare');

    // 1. Vinculación sintética
    const linkPath = doc.paths['/admin/api/v1/vinculaciones/consumir'] as
      | Record<string, { operationId?: string }>
      | undefined;
    expect(linkPath?.post).toBeDefined();
    expect(linkPath?.post?.operationId).toBe('consumirCodigoVinculacion');

    // 2. Publicación educativa multipart
    const eduPath = doc.paths['/admin/api/v1/contenido-educativo'] as
      | Record<
          string,
          {
            operationId?: string;
            requestBody?: {
              content?: {
                'multipart/form-data'?: {
                  schema?: {
                    required?: string[];
                    properties?: Record<string, { type?: string; format?: string }>;
                  };
                };
              };
            };
          }
        >
      | undefined;
    expect(eduPath?.post).toBeDefined();
    expect(eduPath?.post?.operationId).toBe('publicarContenidoEducativo');

    const multipartSchema = eduPath?.post?.requestBody?.content?.['multipart/form-data']?.schema;
    expect(multipartSchema).toBeDefined();
    expect(multipartSchema?.required).toEqual(
      expect.arrayContaining(['archivo', 'titulo', 'descripcion', 'categoria', 'operacion_id']),
    );
    expect(multipartSchema?.properties?.archivo?.format).toBe('binary');
    expect(multipartSchema?.properties?.operacion_id?.format).toBe('uuid');
  });

  it('el documento de ejecución de gateway preserva sus 13 operaciones contractuales', () => {
    const doc = getGatewayExecutionDoc();

    expect(doc.openapi).toBe('3.1.0');
    expect(doc.servers).toBeDefined();
    expect(doc.servers?.[0]?.url).toBe('http://127.0.0.1:18019/quimiocare-backend');

    const gatewayOps = contractInventory.filter((item) => item.servicio === 'Gateway');
    expect(gatewayOps).toHaveLength(13);

    for (const item of gatewayOps) {
      const pathItem = doc.paths[item.ruta] as Record<string, { operationId?: string }> | undefined;
      expect(pathItem, `Ruta de gateway faltante: ${item.ruta}`).toBeDefined();
      const op = pathItem?.[item.metodo.toLowerCase()];
      expect(op, `Método ${item.metodo} faltante en ruta ${item.ruta}`).toBeDefined();
      expect(op?.operationId).toBe(item.operationId);
    }
  });
});
