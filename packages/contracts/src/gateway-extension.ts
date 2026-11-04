import extension from '../schemas/agenda-medication-v1.schema.json' with { type: 'json' };
import type { ContractDocument, JsonObject } from './documents.js';

/** Extend an execution copy only; never mutate copied upstream schemas or push payloads. */
export function withMedicationBinding(source: ContractDocument): ContractDocument {
  const document = structuredClone(source);
  const schemas = document.components.schemas as Record<string, JsonObject>;
  for (const name of [
    'ConfiguracionRecordatorio',
    'CrearRecordatorio',
    'ReemplazarRecordatorio',
    'Recordatorio',
  ]) {
    const schema = schemas[name];
    if (!schema) throw new Error('Missing gateway reminder schema');
    schema.properties = {
      ...(schema.properties as JsonObject),
      ...extension.$defs.binding.properties,
    };
    schema.allOf = [
      ...((schema.allOf as unknown[] | undefined) ?? []),
      ...extension.$defs.binding.allOf,
    ];
  }
  document.info = { ...document.info, version: '1.1.0' };
  return document;
}
