import clinical from '../specs/openapi-clinico-rc32-bundle.json' with { type: 'json' };
import ai from '../specs/openapi-ia-rc31.json' with { type: 'json' };
import gateway from '../specs/openapi-gateway-quimiocare-v1.json' with { type: 'json' };
import demo from '../specs/openapi-simulador-control-v1.json' with { type: 'json' };
import inventory from '../specs/inventario-endpoints.json' with { type: 'json' };

export type Service = 'clinical' | 'ai' | 'gateway' | 'demo';
export type JsonObject = Record<string, unknown>;
export type Schema = JsonObject | boolean;
export interface Media {
  schema?: Schema;
}
export interface Parameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  schema?: Schema;
}
export interface OperationSpec {
  operationId: string;
  parameters?: Array<Parameter | { $ref: string }>;
  requestBody?: { required?: boolean; content: Record<string, Media> };
  responses: Record<string, { content?: Record<string, Media> }>;
  security?: Array<Record<string, unknown>>;
}
export interface ContractDocument {
  openapi: string;
  info: { version: string };
  components: JsonObject;
  paths: Record<string, Record<string, OperationSpec | Array<Parameter | { $ref: string }>>>;
}
// The cast only describes document structure; payload validation is performed by AJV below.
export const documents = { clinical, ai, gateway, demo } as unknown as Record<
  Service,
  ContractDocument
>;
export const contractInventory = inventory;

export type OperationId =
  | `C-${'01' | '02' | '03' | '04' | '05' | '06' | '07' | '08' | '09' | '10' | '11' | '12' | '13' | '14' | '15' | '16'}`
  | 'IA-01'
  | `G-${'01' | '02' | '03' | '04' | '05' | '06' | '07' | '08' | '09' | '10' | '11' | '12' | '13'}`
  | `D-${'01' | '02' | '03' | '04' | '05' | '06'}`;
export interface ContractOperation {
  id: OperationId;
  service: Service;
  method: string;
  path: string;
  upstreamOperationId: string;
  spec: OperationSpec;
}
const services = { Clínica: 'clinical', IA: 'ai', Gateway: 'gateway', Demo: 'demo' } as const;
const prefixes = { clinical: 'C', ai: 'IA', gateway: 'G', demo: 'D' } as const;
const counters: Record<Service, number> = { clinical: 0, ai: 0, gateway: 0, demo: 0 };
export const operations: readonly ContractOperation[] = inventory.map((item) => {
  const service = services[item.servicio as keyof typeof services];
  if (!service) throw new Error('Unknown contract service');
  const spec = documents[service].paths[item.ruta]?.[item.metodo.toLowerCase()];
  if (!spec || Array.isArray(spec) || spec.operationId !== item.operationId)
    throw new Error('Inventory/OpenAPI mismatch');
  counters[service] += 1;
  return {
    id: `${prefixes[service]}-${String(counters[service]).padStart(2, '0')}` as OperationId,
    service,
    method: item.metodo,
    path: item.ruta,
    upstreamOperationId: spec.operationId,
    spec,
  };
});
export function getOperation(id: OperationId): ContractOperation {
  const operation = operations.find((value) => value.id === id);
  if (!operation) throw new Error(`Unknown contract operation: ${id}`);
  return operation;
}
export function findOperation(
  service: Service,
  method: string,
  pathTemplate: string,
): ContractOperation | undefined {
  return operations.find(
    (op) =>
      op.service === service && op.method === method.toUpperCase() && op.path === pathTemplate,
  );
}
export function resolveDocumentPointer(service: Service, ref: string): unknown {
  if (!ref.startsWith('#/')) throw new Error('Only local document references are supported');
  return ref
    .slice(2)
    .split('/')
    .reduce<unknown>((value, part) => {
      if (!value || typeof value !== 'object') throw new Error('Invalid contract reference');
      return (value as JsonObject)[part.replaceAll('~1', '/').replaceAll('~0', '~')];
    }, documents[service]);
}
export function parametersFor(operation: ContractOperation): Parameter[] {
  const pathParameters = documents[operation.service].paths[operation.path]?.parameters;
  const parameters = [
    ...(Array.isArray(pathParameters) ? pathParameters : []),
    ...(operation.spec.parameters ?? []),
  ];
  return parameters.map((value) =>
    '$ref' in value ? (resolveDocumentPointer(operation.service, value.$ref) as Parameter) : value,
  );
}
