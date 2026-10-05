# Módulo Móvil Oncológico

Aplicación Android de acompañamiento para pacientes en tratamiento de **quimioterapia**. Este repositorio corresponde al módulo móvil del proyecto de título y se desarrolla como un monorepositorio pnpm.

## Estado actual

El repositorio contiene la base Expo y la navegación principal de QuimioCare, consolidada para la demostración independiente de Sprint 1 mediante datos sintéticos. La interfaz se estructura en cuatro pestañas principales (Inicio, Vitales, Formulario y Educación), complementada por Perfil, Asistente y Reportes:

- **Inicio:** resumen del paciente activo, acceso directo al registro diario de síntomas libres (`/formulario/sintomas-libres`), cambio entre pacientes de prueba A/B y distintivo explícito de demostración sintética (`DemoBadge`).
- **Vitales:** registro atómico de signos vitales en SQLite local con operaciones en cola y generación/exportación persistente de reportes PDF locales (`expo-print` y `expo-sharing`) con resumen temporal calculado desde la base de datos (7, 30 y 90 días).
- **Formulario:** catálogo de cuestionarios médicos asignados de demostración (modelos sintéticos protocolizados QLQ-C30 y ESAS) con guardado de borradores locales en almacenamiento persistente por paciente y envío demostrativo, diferenciado de la ruta dedicada de síntomas diarios libres.
- **Educación:** catálogo de guías educativas con descargas físicas en Markdown aisladas por paciente (`recursos_educativos/{paciente_id}/{contenido_id}_{timestamp}.md`), con nombres únicos inmutables, prevención de path traversal y reconciliación automática bidireccional entre SQLite y el sistema de archivos.
- **Perfil:** datos del paciente, esquema de quimioterapia y código de vinculación médica offline persistidos en SQLite, junto con la selección de cuatro paletas accesibles (Turquesa, Azul, Violeta, Ámbar) y soporte claro/oscuro guardado localmente.
- **Asistente:** prototipo visual demostrativo sin conexión a servidor ni modelos de lenguaje externos.

No hay autenticación con servidor central, envío remoto de registros, triaje clínico automatizado, sincronización bidireccional ni servicios desplegados.

## Componentes previstos

Las aplicaciones y paquetes se incorporan progresivamente dentro de estas rutas:

| Ruta prevista                 | Responsabilidad                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `apps/mobile/`                | React Native + Expo + TypeScript + Expo Router para Android; registros sintéticos en SQLite local. |
| `apps/gateway/`               | Pasarela Node.js + Express para chatbot y sesiones/tokens de dispositivo, con autenticación JWT.   |
| `apps/central-api-simulator/` | Simulador local de la API clínica del otro módulo, con datos sintéticos.                           |
| `packages/contracts/`         | Contratos y esquemas compartidos cuando se acuerden con el módulo central.                         |
| `infra/local/`                | Entorno de pruebas locales mediante `podman-compose`.                                              |

## Requisitos para el desarrollo local

- Node.js 22.23.2 LTS recomendado (también se admite Node.js 24 LTS). Si se utiliza `nvm`, ejecutar `nvm use` desde la raíz.
- pnpm 11.19.0, fijado en `package.json`.
- Dispositivo o emulador Android para validar la app de forma nativa cuando esté disponible.
- Podman y `podman-compose` para los servicios locales que se agregarán después.

Instalar las herramientas de desarrollo desde la raíz:

```bash
pnpm install --frozen-lockfile
```

Comprobar formato, lint, tipos y pruebas unitarias con la suite local:

```bash
pnpm check
pnpm run test:local
```

Iniciar el servidor de desarrollo de la app desde la raíz:

```bash
pnpm --filter @modulo-movil-oncologia/mobile start
```

Para compilar y ejecutar la **Development Build** en un dispositivo o emulador Android configurado:

```bash
pnpm --filter @modulo-movil-oncologia/mobile android
```

Para generar e instalar la **Build Demo Release autónoma** (JavaScript embebido y selector A/B para pruebas 100% offline sin Metro ni PC):

```bash
pnpm --filter @modulo-movil-oncologia/mobile run run:android:demo
```

Comprobar la salud y compatibilidad de dependencias Expo:

```bash
pnpm --filter @modulo-movil-oncologia/mobile run doctor
```

Generar el bundle JavaScript para Android (valida empaquetado y Metro sin emulador):

```bash
pnpm --filter @modulo-movil-oncologia/mobile bundle:android
```

La aplicación aún no contiene PowerSync. Los datos de prueba de signos, síntomas, contexto y descargas educativas se guardan en SQLite y en el sistema de archivos del dispositivo de manera aislada por paciente. QuimioCare cuenta con su propia **Development Build** nativa (`expo-dev-client`) con paquete `cl.ubiobio.quimiocare`, reemplazando el uso de Expo Go para dar soporte completo a dependencias nativas presentes (`expo-sqlite`, `expo-file-system`, `expo-print`, `expo-sharing`) y futuras. La exportación del bundle Android comprueba el empaquetado de JavaScript y no sustituye la revisión en dispositivo o emulador.

El repositorio mantiene un solo `pnpm-lock.yaml` en la raíz. No deben generarse lockfiles dentro
de `apps/` ni `packages/`. La configuración de workspaces y `nodeLinker: hoisted` está definida en
`pnpm-workspace.yaml`.

`typecheck` valida recursivamente la configuración raíz y el código TypeScript de todos los paquetes
del workspace (`apps/*` y `packages/*`). Los futuros componentes se evaluarán automáticamente al
declarar su script `typecheck`.

## Colaboración

El repositorio ya cuenta con la base Expo (PR5), la navegación principal (PR9), las pantallas visuales previstas (PR10–PR13), la selección de apariencia accesible, la persistencia local de signos, síntomas y contexto en SQLite (SCRUM-19/SCRUM-17/SCRUM-20), y la consolidación de la experiencia demostrativa local (reconciliación de copias educativas, reportes PDF nativos locales, aislamiento A/B con disclaimers, y cuestionarios médicos asignados con guardado de borradores). Los cambios futuros partirán de `main` y mantendrán la separación entre interfaz, datos locales y servicios.
