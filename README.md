# QuimioCare — módulo móvil de quimioterapia

Aplicación Android de acompañamiento durante quimioterapia, organizada como monorepositorio pnpm. El entorno académico utiliza pacientes sintéticos y material educativo autorizado de CUIDAQUIMIO y puede demostrarse sin depender del módulo clínico/web externo.

## Estado de esta entrega

La app conserva registros, borradores, historial y archivos clínicos cifrados y separados por cuenta y entorno. Utiliza el SDK PowerSync como único emisor clínico, sesiones renovables, aceptación de términos por edición y un gateway propio. Los flujos incluyen signos vitales, seguimiento ePRO global, perfil con protocolo formal mFOLFOX6 (cáncer de colon eviQ 637) y fármacos activos, vinculación inmediata con refresco reactivo de formularios e infografías, registro automático de notificaciones push de dispositivo (UUIDv4 estable), rediseño visual de selección de días en recordatorios y agenda compartida, y biblioteca multimedia de imágenes y videos de YouTube.

El flujo de bienvenida guía automáticamente al usuario nuevo al inicio tras aceptar los consentimientos, y la pantalla de inicio permite habilitar avisos pendientes en tiempo real. En el simulador, la interfaz Swagger (/quimiocare/docs/preparacion/) se encuentra organizada en categorías temáticas para facilitar la inspección formal. Los diagnósticos nativos se habilitan solo en builds sintéticas explícitas. Las cuentas de demostración no admiten datos de pacientes reales.

## Estructura

| Ruta                  | Responsabilidad                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| `apps/mobile/`        | Expo, React Native y TypeScript; rutas finas y funcionalidades separadas                                       |
| `apps/simulator/`     | 16 operaciones clínicas, una IA determinista y seis helpers demo, con PostgreSQL                               |
| `packages/contracts/` | OpenAPI originales preservados, tipos, validación de fronteras y ediciones propias identificadas               |
| `infra/demo/`         | Contenedores, origen y almacenamiento persistente, migraciones/semillas y configuración privada local          |
| `infra/powersync/`    | Servicio fijado y reglas de réplica autorizada                                                                 |
| `apps/gateway/`       | Gateway operativo con autenticación y asociaciones de dispositivos; agenda y asistente se completan en su plan |

La biblioteca permite descargar imágenes PNG/JPEG con verificación de integridad y consultar videos de YouTube solo online. No ofrece PDF educativos. Los reportes PDF/XLSX son una función diferente y se conservan. El catálogo CUIDAQUIMIO corresponde a las 42 imágenes y 44 videos publicados en su sitio el 28-10-2026, con sus fuentes y textos accesibles. La sección Podcast enlaza los cuatro audios originales de Google Drive, solo online y en orden pedagógico; no descarga ni almacena audio.

## Requisitos

- Node22.23.2 recomendado en `.nvmrc`; también se admite Node24 según package.json.
- pnpm11.19.0 fijado por el repositorio.
- Android físico/development build para módulos nativos.
- Podman con proveedor Compose para el entorno previsto; Docker Compose es una alternativa de comprobación local. La universidad requiere su aceptación operativa propia.

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test:local
pnpm test:ui
pnpm test:contracts
pnpm test:simulator
pnpm build:services
```

Las pruebas HTTP requieren `TEST_DATABASE_URL` con credenciales privadas y una base sintética separada cuyo nombre termine en `_test`:

```bash
pnpm test:integration
```

No ejecutar esta suite sobre la base que usa el teléfono: reinicia datos de prueba. El runner no sustituye PostgreSQL por memoria ni omite la suite cuando falta configuración.

## Ejecutar la aplicación

```bash
pnpm --filter @modulo-movil-oncologia/mobile start
pnpm --filter @modulo-movil-oncologia/mobile run android
```

La build demo existente usa `EXPO_PUBLIC_DEMO_MODE=true`. Las URLs se configuran por entorno; localhost en Android corresponde al teléfono. El protocolo de diagnóstico Android del equipo detalla la compilación del APK y las pruebas PowerSync. Un bundle JavaScript correcto no acredita recepción push ni réplica nativa.

## Servicios propios y contratos

El entorno demo se configura mediante `node infra/demo/configure.mjs` y su definición está en `infra/demo/compose.yaml`. La documentación local del equipo detalla el arranque y las pruebas de persistencia. No imprimir `.env`, tokens ni salidas de Compose con secretos interpolados. Los scripts de configuración no sobrescriben credenciales sobre volúmenes existentes.

Consultar el [paquete de contratos](packages/contracts/README.md) y el [simulador](apps/simulator/README.md). El gateway no debe convertirse en un segundo emisor clínico: la integración prevista usa SDK PowerSync y uploadData hacia la API clínica conforme al contrato.

## Comprobación y revisión

CI verifica calidad móvil, contratos y HTTP con PostgreSQL. Cada capacidad se acepta con evidencia de su entorno real; pruebas unitarias, compilación y aceptación nativa son resultados distintos.

Las guías operativas y los informes de validación del equipo se conservan localmente fuera del repositorio. En ellos se describe la configuración de CI/CD, el `.env` privado del host y la evidencia de validación; las pruebas locales no acreditan por sí solas el servidor universitario.

Cada cambio se entrega para revisión de Javier y requiere su visto bueno y mensaje exacto antes del commit. La publicación e integración de una rama necesitan su autorización aplicable.
