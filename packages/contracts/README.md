# @quimiocare/contracts

Contrato de frontera para los servicios propios de la demostración QuimioCare. Conserva las 16 operaciones clínicas RC3.2, 1 IA RC3.1, 13 gateway y 6 helpers demo del paquete entregado, sin inventar compatibilidad del módulo externo. Los alias C-01..C-16, IA-01, G-01..G-13, D-01..D-06 son identificadores locales y no cambian operationId.

## Uso

```typescript
import { validateRequest, validateResponse, parseQuery } from '@quimiocare/contracts';

const requestResult = validateRequest('C-06', { body: payload });
const responseResult = validateResponse('C-06', 201, acknowledgement);
const query = parseQuery('C-11', new URLSearchParams('limit=20&skip=0'));
```

Cada resultado contiene valid y errores de metadatos sin valores enviados. assertRequest/assertResponse lanzan ContractValidationError. La validación no modifica datos, no inserta defaults y no coerciona cuerpos; parseQuery solo transforma tipos de parámetros HTTP declarados con gramática estricta. Los headers de seguridad/JWT, tamaño del cuerpo, autorización/propiedad, reglas de negocio, idempotencia y transacciones corresponden al servicio, no a AJV.

La validación de configuración ePRO comprueba JSON Schema, no reemplaza el grafo completo, las ediciones ni las reglas tipadas/exclusivas por respuesta. Los límites API no son umbrales de triaje.

## Fuentes y ampliación PDF

specs/, schemas/ y fixtures/ incluyen copias verificadas. PROVENANCE.json registra hash/tamaño por archivo y upstream-manifest.json conserva el manifiesto original. Los ejemplos son datos sintéticos; provisionalForm sigue siendo el fixture provisional histórico, no constancia de validación del instrumento actual.

La ampliación propia 1.1 representa PDF con tipo=documento, formato=pdf y MIME application/pdf: schema separado education-document-v1_1.schema.json y validateEducationDocument. No se agregan tipos al OpenAPI RC3.2 original. El servidor debe decidir explícitamente qué perfil de biblioteca ofrece y documentar esa ampliación; la app no debe enviar esa representación a un sistema externo que no la soporte. La descarga/renderizado offline se acepta en P05; validar metadatos no demuestra bytes, visor ni derechos editoriales.

## Comandos

- pnpm --filter @quimiocare/contracts generate: genera aliases TypeScript desde components.schemas.
- pnpm --filter @quimiocare/contracts generate:check: detecta desvío de generación.
- pnpm --filter @quimiocare/contracts typecheck.
- pnpm --filter @quimiocare/contracts test.
- pnpm --filter @quimiocare/contracts build: genera tipos, compila ESM y copia fixtures binarios/JSON.

Los consumidores Node usan dist/src/index.js y deben construir este paquete antes de arrancar. Tipos se resuelven desde src para evitar depender de artefactos descartables durante typecheck. Fixtures se exporta desde el módulo o @quimiocare/contracts/fixtures; fixtureImageUrl apunta a bytes tanto en fuente como compilado. No hay dependencia runtime de carpetas locales excluidas del repositorio.

AJV2020 valida JSON Schema 2020-12 y ajv-formats comprueba UUID, fechas y otros formatos. Las anotaciones de OpenAPI/x-\* no se interpretan como reglas ni se eliminan de los originales. Las pruebas contrastan fixtures y límites independientes, incluyendo diferencias null/ausente, false/0 y protocolos de respuesta.

Nota de conformance: los ejemplos históricos API-11/API-13 no contienen los cuatro campos archivo\_\* exigidos por el objetivo RC3.2; el validador los rechaza deliberadamente. El fixture de imagen verificable sí los incluye. No se alteran esos ejemplos ni se relaja el schema para ocultar la diferencia.
