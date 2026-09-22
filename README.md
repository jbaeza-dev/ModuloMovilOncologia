# Módulo Móvil Oncológico

Aplicación Android de acompañamiento para pacientes en tratamiento de **quimioterapia**. Este repositorio corresponde al módulo móvil del proyecto de título y está en su etapa de inicialización.

## Estado actual

El repositorio dispone de la base del monorrepositorio, configuración compartida de TypeScript,
ESLint y Prettier, e integración continua para comprobar formato, lint y tipos en cada PR hacia
`main`. La app Expo tiene una pantalla inicial técnica. Todavía no hay flujos clínicos, pasarela,
API simulada ni servicios desplegados; cada componente se incorporará en su propio pull request.

## Componentes previstos

Las aplicaciones y paquetes se incorporan progresivamente dentro de estas rutas:

| Ruta prevista                 | Responsabilidad                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `apps/mobile/`                | Base React Native + Expo + TypeScript + Expo Router para Android; todavía sin datos clínicos.    |
| `apps/gateway/`               | Pasarela Node.js + Express para chatbot y sesiones/tokens de dispositivo, con autenticación JWT. |
| `apps/central-api-simulator/` | Simulador local de la API clínica del otro módulo, con datos sintéticos.                         |
| `packages/contracts/`         | Contratos y esquemas compartidos cuando se acuerden con el módulo central.                       |
| `infra/local/`                | Entorno de pruebas locales mediante `podman-compose`.                                            |

La app leerá los datos de referencia clínicos desde SQLite replicado por PowerSync. Cuando recupere conectividad, su implementación de `uploadData()` enviará las escrituras clínicas directamente a los endpoints de la API central. **El gateway no transportará esas escrituras** ni incluirá un endpoint `/sync/batch`. El simulador permitirá probar esos flujos sin depender de la disponibilidad del módulo central. Los datos de prueba serán ficticios.

## Requisitos para el desarrollo local

- Node.js 22.23.2 LTS recomendado (también se admite Node.js 24 LTS). Si se utiliza `nvm`, ejecutar `nvm use` desde la raíz.
- pnpm 11.19.0, fijado en `package.json`.
- Dispositivo o emulador Android para validar la app de forma nativa cuando esté disponible.
- Podman y `podman-compose` para los servicios locales que se agregarán después.

Instalar las herramientas de desarrollo desde la raíz:

```bash
pnpm install --frozen-lockfile
```

Comprobar formato, lint y tipos con un único comando:

```bash
pnpm check
```

Iniciar el servidor de desarrollo de la app desde la raíz:

```bash
pnpm --filter @modulo-movil-oncologia/mobile start
```

Para abrirla en un dispositivo o emulador Android configurado:

```bash
pnpm --filter @modulo-movil-oncologia/mobile android
```

Comprobar la salud y compatibilidad de dependencias Expo:

```bash
pnpm --filter @modulo-movil-oncologia/mobile doctor
```

Generar el bundle JavaScript para Android (valida empaquetado y Metro sin emulador):

```bash
pnpm --filter @modulo-movil-oncologia/mobile bundle:android
```

Esta base no contiene PowerSync ni persistencia clínica. Expo Go sirve para comprobar la pantalla
inicial, pero no valida el driver nativo previsto para PowerSync. Antes de integrar PowerSync se
definirá un `android.package` estable y se probará una _development build_ en Android. La
exportación del bundle Android tampoco sustituye esa prueba nativa.

El repositorio mantiene un solo `pnpm-lock.yaml` en la raíz. No deben generarse lockfiles dentro
de `apps/` ni `packages/`. La configuración de workspaces y `nodeLinker: hoisted` está definida en
`pnpm-workspace.yaml`.

`typecheck` valida recursivamente la configuración raíz y el código TypeScript de todos los paquetes
del workspace (`apps/*` y `packages/*`). Los futuros componentes se evaluarán automáticamente al
declarar su script `typecheck`.

## Colaboración

Cada tarea parte de `main` en una rama corta, se revisa mediante un pull request por la otra persona del equipo y se integra tras superar las comprobaciones disponibles. Este arranque está asociado con [SCRUM-26](https://proyecto-movil-oncologico.atlassian.net/browse/SCRUM-26); la integración continua inicial corresponde a [SCRUM-46](https://proyecto-movil-oncologico.atlassian.net/browse/SCRUM-46). Las ramas posteriores incorporarán contratos, Expo, pasarela y simulador de forma independiente.
