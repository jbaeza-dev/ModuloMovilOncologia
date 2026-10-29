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

La ampliación propia 1.1 de PDF educativo (schema `education-document-v1_1.schema.json` y `validateEducationDocument`) se conserva como antecedente. El alcance activo admite imágenes PNG/JPEG offline y videos externos solo online: no se publica ni habilita un visor PDF educativo. Esta decisión no elimina los reportes PDF/XLSX de la app ni altera el OpenAPI original.

`quimiocare-terminos-v3_0.json` contiene una edición propia de términos, privacidad y consentimiento aprobada por el responsable del proyecto. Es distinta de las muestras 1.0/2.0 y no declara aprobación institucional. La aceptación debe apuntar al UUID de la definición efectivamente presentada; una edición nueva no reescribe actos anteriores.

## Comandos

- pnpm --filter @quimiocare/contracts generate: genera aliases TypeScript desde components.schemas.
- pnpm --filter @quimiocare/contracts generate:check: detecta desvío de generación.
- pnpm --filter @quimiocare/contracts typecheck.
- pnpm --filter @quimiocare/contracts test.
- pnpm --filter @quimiocare/contracts build: genera tipos, compila ESM y copia fixtures binarios/JSON.

Los consumidores Node usan dist/src/index.js y deben construir este paquete antes de arrancar. Tipos se resuelven desde src para evitar depender de artefactos descartables durante typecheck. Fixtures se exporta desde el módulo o @quimiocare/contracts/fixtures; fixtureImageUrl apunta a bytes tanto en fuente como compilado. No hay dependencia runtime de carpetas locales excluidas del repositorio.

AJV2020 valida JSON Schema 2020-12 y ajv-formats comprueba UUID, fechas y otros formatos. Las anotaciones de OpenAPI/x-\* no se interpretan como reglas ni se eliminan de los originales. Las pruebas contrastan fixtures y límites independientes, incluyendo diferencias null/ausente, false/0 y protocolos de respuesta.

Nota de conformance: los ejemplos históricos API-11/API-13 no contienen los cuatro campos archivo\_\* exigidos por el objetivo RC3.2; el validador los rechaza deliberadamente. El fixture de imagen verificable sí los incluye. No se alteran esos ejemplos ni se relaja el schema para ocultar la diferencia.
