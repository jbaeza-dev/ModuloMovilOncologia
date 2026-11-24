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

/**
 * Enmienda del 24-11-2026 a G-02, decidida por el equipo: si una cuenta cerró sesión sin conexión,
 * otra cuenta puede registrar el push en el mismo teléfono. Solo libera el registro anterior una
 * coincidencia completa de instalación y token; las parciales siguen en REGISTRO_EN_CONFLICTO.
 */
export function withPhoneRelease(source: ContractDocument): ContractDocument {
  const document = structuredClone(source);
  const operation = document.paths['/api/gateway/dispositivo/push-token']?.post as unknown as
    | (JsonObject & { description?: string })
    | undefined;
  if (!operation) throw new Error('Missing gateway push registration');
  const amendment =
    'Enmienda 24-11-2026: una colisión activa con la misma instalación y el mismo token push de otra sesión revoca ese registro anterior (como DELETE) y crea el nuevo; las dos cosas juntas solo se obtienen con el teléfono en la mano. Una coincidencia parcial (solo instalación o solo token) sigue devolviendo REGISTRO_EN_CONFLICTO sin transferir ni revelar la asociación ajena.';
  operation.description = (operation.description ?? '') + ' ' + amendment;
  operation['x-enmiendas'] = [
    {
      fecha: '2026-11-24',
      cambio: amendment,
      motivo:
        'Con el contrato original, si la cuenta anterior cerraba sesión sin conexión, la siguiente cuenta quedaba sin recordatorios en ese teléfono hasta que la anterior volviera a conectarse.',
    },
  ];
  return document;
}
