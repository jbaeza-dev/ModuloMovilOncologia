# Módulo Móvil Oncológico

Aplicación Android de acompañamiento para pacientes en tratamiento de **quimioterapia**. Este repositorio corresponde al módulo móvil del proyecto de título y se desarrolla como un monorepositorio pnpm.

## Estado actual

El repositorio contiene la base Expo y la navegación principal de QuimioCare, además de un prototipo visual navegable de las pantallas previstas para el Sprint 1. La interfaz incluye Inicio, Perfil, acceso, vinculación, vitales, síntomas, educación, asistente y reportes, con datos de demostración. En Perfil → Preferencias se puede elegir entre cuatro paletas; el modo claro u oscuro sigue la configuración del dispositivo y la paleta se conserva localmente.

La rama de persistencia añade SQLite para guardar signos vitales y descripciones de síntomas sintéticos, consultar historiales por paciente de prueba y conservar operaciones pendientes. Las demás pantallas clínicas siguen siendo una experiencia de presentación. No hay autenticación, envío de datos, triaje, sincronización, descargas, exportación ni servicios desplegados.

## Componentes previstos

Las aplicaciones y paquetes se incorporan progresivamente dentro de estas rutas:

| Ruta prevista                 | Responsabilidad                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `apps/mobile/`                | React Native + Expo + TypeScript + Expo Router para Android; registros sintéticos en SQLite local. |
| `apps/gateway/`               | Pasarela Node.js + Express para chatbot y sesiones/tokens de dispositivo, con autenticación JWT.   |
| `apps/central-api-simulator/` | Simulador local de la API clínica del otro módulo, con datos sintéticos.                           |
| `packages/contracts/`         | Contratos y esquemas compartidos cuando se acuerden con el módulo central.                         |
| `infra/local/`                | Entorno de pruebas locales mediante `podman-compose`.                                              |

Para la demostración de Sprint 1 se acordó guardar registros en SQLite propio y preparar su futuro envío REST mediante una cola local. PowerSync se incorporará por separado para el catálogo educativo. El contrato v0 del simulador continúa en revisión, por lo que la app todavía no transmite registros.

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
pnpm run test:local
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
pnpm --filter @modulo-movil-oncologia/mobile run doctor
```

Generar el bundle JavaScript para Android (valida empaquetado y Metro sin emulador):

```bash
pnpm --filter @modulo-movil-oncologia/mobile bundle:android
```

La aplicación aún no contiene PowerSync. Los datos de prueba de signos y síntomas se guardan en SQLite dentro del dispositivo. Expo Go incluye `expo-sqlite` para revisar esta etapa; una futura integración PowerSync requerirá validación nativa propia. La exportación del bundle Android comprueba el empaquetado de JavaScript y no sustituye la revisión en dispositivo o emulador.

El repositorio mantiene un solo `pnpm-lock.yaml` en la raíz. No deben generarse lockfiles dentro
de `apps/` ni `packages/`. La configuración de workspaces y `nodeLinker: hoisted` está definida en
`pnpm-workspace.yaml`.

`typecheck` valida recursivamente la configuración raíz y el código TypeScript de todos los paquetes
del workspace (`apps/*` y `packages/*`). Los futuros componentes se evaluarán automáticamente al
declarar su script `typecheck`.

## Colaboración

El repositorio ya cuenta con la base Expo (PR5), la navegación principal (PR9), las pantallas visuales previstas para PR10–PR13 y la selección de apariencia accesible. La rama `feat/scrum-19-persistencia-sqlite` incorpora la primera parte funcional del registro offline. Los cambios futuros partirán de `main` y mantendrán la separación entre interfaz, datos locales y servicios.
