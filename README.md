# Módulo Móvil Oncológico

Aplicación Android de acompañamiento para pacientes en tratamiento de **quimioterapia**. Este repositorio corresponde al módulo móvil del proyecto de título y está en su etapa de inicialización.

## Estado actual

El repositorio dispone de la base del monorrepositorio, configuración compartida de TypeScript,
ESLint y Prettier. Todavía no hay aplicación ejecutable, pasarela, API simulada ni servicios
desplegados; cada componente se incorporará en una rama y un pull request propios.

## Componentes previstos

Las aplicaciones y paquetes concretos se incorporarán progresivamente dentro de estas rutas:

| Ruta prevista                 | Responsabilidad                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `apps/mobile/`                | React Native + Expo + TypeScript + Expo Router para Android.                                     |
| `apps/gateway/`               | Pasarela Node.js + Express para chatbot y sesiones/tokens de dispositivo, con autenticación JWT. |
| `apps/central-api-simulator/` | Simulador local de la API clínica del otro módulo, con datos sintéticos.                         |
| `packages/contracts/`         | Contratos y esquemas compartidos cuando se acuerden con el módulo central.                       |
| `infra/local/`                | Entorno de pruebas locales mediante `podman-compose`.                                            |

La app leerá los datos de referencia clínicos desde SQLite replicado por PowerSync. Cuando recupere conectividad, su implementación de `uploadData()` enviará las escrituras clínicas directamente a los endpoints de la API central. **El gateway no transportará esas escrituras** ni incluirá un endpoint `/sync/batch`. El simulador permitirá probar esos flujos sin depender de la disponibilidad del módulo central. Los datos de prueba serán ficticios.

## Requisitos para el desarrollo local

- Node.js 22.23.2 LTS recomendado (también se admite Node.js 24 LTS). Si se utiliza `nvm`, ejecutar `nvm use` desde la raíz.
- pnpm 11.19.0, fijado en `package.json`.
- Entorno de desarrollo Android para ejecutar la app una vez inicializada.
- Podman y `podman-compose` para los servicios locales que se agregarán después.

Instalar las herramientas de desarrollo desde la raíz:

```bash
pnpm install --frozen-lockfile
```

Comprobar formato, lint y tipos con un único comando:

```bash
pnpm check
```

El repositorio mantiene un solo `pnpm-lock.yaml` en la raíz. No deben generarse lockfiles dentro
de `apps/` ni `packages/`. La configuración de workspaces y `nodeLinker: hoisted` está definida en
`pnpm-workspace.yaml`.

Por ahora `typecheck` valida la configuración raíz, porque aún no hay código TypeScript. Cada
aplicación o paquete incorporará su propia comprobación de tipos cuando se cree.

## Colaboración

Cada tarea parte de `main` en una rama corta, se revisa mediante un pull request por la otra persona del equipo y se integra tras superar las comprobaciones disponibles. Este arranque está asociado con [SCRUM-26](https://proyecto-movil-oncologico.atlassian.net/browse/SCRUM-26). Las ramas posteriores incorporarán contratos, Expo, CI, pasarela y simulador de forma independiente.
