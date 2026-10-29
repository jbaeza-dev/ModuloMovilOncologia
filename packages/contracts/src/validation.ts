import eproEditionV12 from '../schemas/epro-edition-v1_2.schema.json' with { type: 'json' };
import { Ajv2020 } from 'ajv/dist/2020.js';
import formatsPlugin from 'ajv-formats';
import type { FormatsPlugin } from 'ajv-formats';
import type { ErrorObject, ValidateFunction } from 'ajv';
import { documents, getOperation, parametersFor, operations } from './documents.js';
import type { ContractOperation, OperationId, Schema, Service } from './documents.js';

export interface ContractIssue {
  location: string;
  keyword: string;
  message: string;
}
export interface ContractResult {
  valid: boolean;
  errors: readonly ContractIssue[];
}
export interface RequestInput {
  body?: unknown;
  path?: Readonly<Record<string, unknown>>;
  query?: Readonly<Record<string, unknown>>;
  headers?: Readonly<Record<string, unknown>>;
  mediaType?: string;
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
});
(formatsPlugin as unknown as FormatsPlugin)(ajv);
// OpenAPI documents contain annotation keys outside JSON Schema; they stay unmodified.
for (const [service, document] of Object.entries(documents))
  ajv.addSchema({ ...document, $id: `urn:quimiocare:${service}` });
ajv.addSchema(eproEditionV12);
const cache = new Map<string, ValidateFunction>();
function compile(service: Service, schema: Schema, key: string): ValidateFunction {
  const cached = cache.get(key);
  if (cached) return cached;
  // Resolve local OpenAPI pointers in the document root without mutating source schemas.
  const qualify = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(qualify);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [
          k,
          k === '$ref' && typeof v === 'string' && v.startsWith('#/')
            ? `urn:quimiocare:${service}${v}`
            : qualify(v),
        ]),
      );
    return value;
  };
  const validator = ajv.compile(qualify(schema) as Schema);
  cache.set(key, validator);
  return validator;
}
function issues(errors: ErrorObject[] | null | undefined, location: string): ContractIssue[] {
  // AJV schema errors are safe metadata only; do not copy payload values into diagnostics.
  return (errors ?? []).map((error) => ({
    location: location + error.instancePath,
    keyword: error.keyword,
    message: error.message ?? 'Invalid contract value',
  }));
}
function check(
  service: Service,
  schema: Schema,
  key: string,
  value: unknown,
  location: string,
): ContractIssue[] {
  const validate = compile(service, schema, key);
  return validate(value) ? [] : issues(validate.errors, location);
}
function failure(location: string, keyword: string, message: string): ContractIssue {
  return { location, keyword, message };
}

export function validateRequest(id: OperationId, input: RequestInput = {}): ContractResult {
  const operation = getOperation(id);
  const errors: ContractIssue[] = [];
  for (const parameter of parametersFor(operation)) {
    const source =
      parameter.in === 'path'
        ? input.path
        : parameter.in === 'query'
          ? input.query
          : parameter.in === 'header'
            ? input.headers
            : undefined;
    const parameterKey =
      parameter.in === 'header'
        ? Object.keys(source ?? {}).find(
            (key) => key.toLowerCase() === parameter.name.toLowerCase(),
          )
        : parameter.name;
    const value = parameterKey ? source?.[parameterKey] : undefined;
    const location = `${parameter.in}/${parameter.name}`;
    if (value === undefined) {
      if (parameter.required)
        errors.push(failure(location, 'required', 'Required parameter is missing'));
    } else if (parameter.schema)
      errors.push(
        ...check(operation.service, parameter.schema, `${id}:${location}`, value, location),
      );
  }
  const bodySpec = operation.spec.requestBody;
  if (bodySpec) {
    if (input.body === undefined) {
      if (bodySpec.required) errors.push(failure('body', 'required', 'Required body is missing'));
    } else {
      const mediaType = input.mediaType ?? 'application/json';
      const schema = bodySpec.content[mediaType]?.schema;
      if (schema === undefined)
        errors.push(failure('body', 'contentType', 'Request media type is not declared'));
      else
        errors.push(
          ...check(operation.service, schema, `${id}:request:${mediaType}`, input.body, 'body'),
        );
    }
  } else if (input.body !== undefined)
    errors.push(failure('body', 'unexpectedBody', 'Operation does not declare a request body'));
  return { valid: errors.length === 0, errors };
}

export function validateResponse(
  id: OperationId,
  status: number,
  body?: unknown,
  mediaType = 'application/json',
): ContractResult {
  const operation = getOperation(id);
  const response =
    operation.spec.responses[String(status)] ??
    operation.spec.responses[`${Math.floor(status / 100)}XX`] ??
    operation.spec.responses.default;
  if (!response)
    return {
      valid: false,
      errors: [failure('response', 'status', 'Response status is not declared')],
    };
  if (!response.content || !Object.keys(response.content).length) {
    const valid = body === undefined;
    return {
      valid,
      errors: valid
        ? []
        : [failure('response', 'unexpectedBody', 'Response must not contain a body')],
    };
  }
  const media = response.content[mediaType];
  if (!media)
    return {
      valid: false,
      errors: [failure('response', 'contentType', 'Response media type is not declared')],
    };
  if (mediaType !== 'application/json' && mediaType !== 'application/problem+json') {
    const valid = body instanceof Uint8Array;
    return {
      valid,
      errors: valid ? [] : [failure('response', 'binary', 'Binary response must contain bytes')],
    };
  }
  if (!media.schema) return { valid: true, errors: [] };
  const ownEdition =
    (id === 'C-08' || id === 'C-09') &&
    body !== null &&
    typeof body === 'object' &&
    Object.hasOwn(body, 'version_reglas_compuestas');
  const responseSchema = ownEdition ? { $ref: 'urn:quimiocare:epro-edition:1.2' } : media.schema;
  const errors = check(
    operation.service,
    responseSchema,
    `${id}:response:${status}:${mediaType}${ownEdition ? ':epro-1.2' : ''}`,
    body,
    'response',
  );
  return { valid: errors.length === 0, errors };
}

export class ContractValidationError extends Error {
  readonly operationId: OperationId;
  readonly issues: readonly ContractIssue[];
  constructor(operationId: OperationId, result: ContractResult) {
    super(`Contract validation failed for ${operationId}`);
    this.name = 'ContractValidationError';
    this.operationId = operationId;
    this.issues = result.errors;
  }
}
export function assertRequest(id: OperationId, input: RequestInput = {}): void {
  const result = validateRequest(id, input);
  if (!result.valid) throw new ContractValidationError(id, result);
}
export function assertResponse(
  id: OperationId,
  status: number,
  body?: unknown,
  mediaType = 'application/json',
): void {
  const result = validateResponse(id, status, body, mediaType);
  if (!result.valid) throw new ContractValidationError(id, result);
}

// HTTP adapters call this only for query strings. Bodies remain strictly typed and unmodified.
export function parseQuery(
  id: OperationId,
  query: URLSearchParams | Readonly<Record<string, string | string[]>>,
): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  if (query instanceof URLSearchParams) {
    for (const key of new Set(query.keys())) {
      const values = query.getAll(key);
      input[key] = values.length === 1 ? values[0] : values;
    }
  } else Object.assign(input, query);
  const op: ContractOperation = getOperation(id);
  for (const parameter of parametersFor(op)) {
    if (parameter.in !== 'query' || !parameter.schema || typeof parameter.schema !== 'object')
      continue;
    const value = input[parameter.name];
    if (typeof value !== 'string') continue;
    const alternatives = parameter.schema.anyOf;
    const type =
      parameter.schema.type ??
      (Array.isArray(alternatives)
        ? alternatives.find(
            (value: unknown) =>
              value && typeof value === 'object' && 'type' in value && value.type !== 'null',
          )?.type
        : undefined);
    if (type === 'integer' && /^-?(?:0|[1-9]\d*)$/.test(value)) {
      const parsed = Number(value);
      if (Number.isSafeInteger(parsed)) input[parameter.name] = parsed;
    } else if (type === 'number' && /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) input[parameter.name] = parsed;
    } else if (type === 'boolean' && (value === 'true' || value === 'false'))
      input[parameter.name] = value === 'true';
  }
  return input;
}

export function compileAllOperationSchemas(): number {
  let count = 0;
  for (const operation of Object.values(documents))
    count += Object.keys(operation.components.schemas as object).length;
  for (const service of Object.keys(documents) as Service[]) {
    const schemas = documents[service].components.schemas as Record<string, Schema>;
    for (const [name] of Object.entries(schemas))
      compile(service, { $ref: `#/components/schemas/${name}` }, `${service}:component:${name}`);
  }
  for (const operation of operations) {
    for (const parameter of parametersFor(operation)) {
      if (parameter.schema)
        compile(
          operation.service,
          parameter.schema,
          `${operation.id}:${parameter.in}/${parameter.name}`,
        );
    }
    for (const [mediaType, media] of Object.entries(operation.spec.requestBody?.content ?? {})) {
      if (media.schema)
        compile(operation.service, media.schema, `${operation.id}:request:${mediaType}`);
    }
    for (const [status, response] of Object.entries(operation.spec.responses)) {
      for (const [mediaType, media] of Object.entries(response.content ?? {})) {
        if (media.schema && mediaType === 'application/json')
          compile(
            operation.service,
            media.schema,
            `${operation.id}:response:${status}:${mediaType}`,
          );
      }
    }
  }
  return count;
}
