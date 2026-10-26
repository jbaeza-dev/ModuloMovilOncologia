# QuimioCare — módulo móvil de quimioterapia

Aplicación Android de acompañamiento durante quimioterapia, organizada como monorepositorio pnpm. El entorno académico utiliza pacientes y contenido sintéticos y puede demostrarse sin depender del módulo clínico/web externo.

## Estado de esta entrega

La base móvil conserva registros, borradores, historial y archivos locales aislados por paciente, biblioteca de imágenes/YouTube, recordatorios locales y exportación PDF/XLSX. El Plan 01 incorpora contratos verificables, un simulador persistente y el entorno PowerSync propio.

El diagnóstico nativo de P01 es una pantalla técnica habilitada solo en una build sintética explícita. Usa una base separada y no migra el historial existente. La documentación técnica, los resultados y las capturas se conservan en el contexto local del equipo. La incorporación completa de sesión, sincronización clínica, gateway, agenda compartida y triaje corresponde a los planes posteriores. No se declara aquí integración con los sistemas externos reales ni despliegue universitario completado.

## Estructura

| Ruta                  | Responsabilidad                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `apps/mobile/`        | Expo, React Native y TypeScript; rutas finas y funcionalidades separadas                                   |
| `apps/simulator/`     | 16 operaciones clínicas, una IA determinista y seis helpers demo, con PostgreSQL                           |
| `packages/contracts/` | OpenAPI originales preservados, tipos y validación de fronteras; extensión educativa PDF propia versionada |
| `infra/demo/`         | Contenedores, origen y almacenamiento persistente, migraciones/semillas y configuración privada local      |
| `infra/powersync/`    | Servicio fijado y reglas de réplica autorizada                                                             |
| `apps/gateway/`       | Componente previsto para los planes siguientes; aún no implementado                                        |

La biblioteca educativa objetivo admite imágenes y PDF offline, y videos solo online. El contrato original de imágenes/video se conserva; la ampliación PDF propia se versiona por separado y no se atribuye al backend externo sin evidencia.

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

Los cambios del Plan 01 quedan sin commit hasta la revisión de Javier y hasta que proporcione el mensaje exacto. No se publica una rama ni se integra a main como consecuencia automática de pasar pruebas.
