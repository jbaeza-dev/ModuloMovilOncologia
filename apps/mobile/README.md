# @modulo-movil-oncologia/mobile

Aplicación Android **QuimioCare** para acompañar a pacientes en quimioterapia (protocolo de
demostración mFOLFOX6, cáncer de colon, eviQ 637). Está hecha con Expo SDK 57, React Native 0.86,
React 19 y TypeScript, y funciona sin conexión: guarda todo primero en el teléfono y sincroniza
cuando hay red.

La historia de cada incremento, con sus escenarios de aceptación de ese momento, está en
[docs/historial-incrementos.md](docs/historial-incrementos.md).

## Funcionalidades

| Funcionalidad           | Qué hace                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Acceso y consentimiento | Google con OAuth 2.0 + PKCE (Supabase) en `universidad-demo`, selección de pacientes sintéticos A/B en `demo`, términos versionados y RUT. |
| Signos vitales          | Registro validado (temperatura, presión, pulso, SatO2, dolor ENA obligatorio), historial por día y gráfico semanal.                        |
| Seguimiento ePRO        | Formularios versionados con preguntas condicionales, borradores locales y envío al servidor.                                               |
| Orientación de síntomas | Motor de reglas versionado que orienta en A1, A2, B, C o D. La definición sigue en `draft` y se evalúa en modo sintético.                  |
| Educación               | 42 infografías verificadas por SHA-256, 44 videos de YouTube y 4 podcasts (CUIDAQUIMIO).                                                   |
| Reportes                | PDF (expo-print) y Excel (SheetJS) de 7, 30 o 90 días, cifrados en el teléfono.                                                            |
| Recordatorios y agenda  | Recordatorios locales y agenda compartida con el gateway: push a la hora y respaldo local 120 s después.                                   |
| Medicamentos del día    | Confirmación de tomas (tomada u omitida) con historial de correcciones.                                                                    |
| Asistente               | Consultas vía gateway, 15 s de límite, 2.000 caracteres, aviso permanente de que no reemplaza al equipo médico.                            |
| Perfil y preferencias   | Tratamiento, equipo tratante, código de vinculación, dispositivos, almacenamiento, 4 paletas accesibles y guía de ahorro de batería.       |

## Arquitectura

```text
src/app/        Rutas de Expo Router (solo componen pantallas)
src/features/   Pantallas y lógica por funcionalidad
src/services/   Sesión, agenda, recordatorios, asistente, notificaciones, formularios
src/data/       local/ (SQLite, migraciones, repositorios), sync/ (PowerSync, cifrado), agenda/
src/providers/  LocalDataProvider (estado global) y sus hooks, contexto de paciente, tema
src/components/ Componentes visuales reutilizables
src/hooks/      Consultas reactivas y estado de recordatorios
```

Las dependencias van solo hacia abajo: `data/` no conoce React, por eso la lógica y SQLite se
prueban en Node.

- **Una base SQLite cifrada por cuenta y entorno** (`data/sync/native-runtime.ts`): la abre el SDK
  de PowerSync con SQLCipher y una clave AES-256 guardada en SecureStore. Ahí corren las 20
  migraciones locales (`data/local/migrations/001` a `020`) y viven las tablas del SDK, de modo
  que un registro clínico y su comando de subida se escriben en la misma transacción.
- **Sincronización:** PowerSync replica solo catálogos (`formulario`, `pregunta`,
  `contenido_educativo`). Los signos y respuestas ePRO se suben como comandos de solo inserción
  que `ClinicalConnector` envía con ACK durable e idempotencia por UUID.
- **Archivos cifrados** con AES-256-GCM y datos autenticados por cuenta (`native-cipher.ts`).
- **Contexto de paciente** (`providers/patient-context-manager.ts`): cada operación asíncrona se
  descarta si cambió la «época»; el cierre de sesión ocurre en dos fases (inmediata y drenaje).
- **Estado global** (`providers/LocalDataProvider.tsx`): compone hooks con una sola
  responsabilidad cada uno: `usePatientContext` (sesión y contexto), `useClinicalStore` (base
  cifrada y revisiones), `useAgendaRuntime` (agenda compartida), `useFormImport` (borradores
  antiguos), `useReminderReconciliation` (reprogramar avisos) y `useNotificationResponses`
  (avisos tocados o recibidos).
- **Agenda compartida** (`services/agenda`): intenciones locales, reglas del gateway y alarmas de
  respaldo exactas; el permiso de notificaciones se pide una vez por apertura o con un botón.

## Modos y configuración

El modo se fija al compilar con `EXPO_PUBLIC_APP_ENV`:

| Modo               | Uso                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------- |
| `demo`             | Pacientes sintéticos A/B contra el simulador (`EXPO_PUBLIC_DEMO_MODE=true`).                 |
| `universidad-demo` | Despliegue universitario con Google + PKCE; es el APK que compila CI en cada push a `main`.  |
| `production`       | Preparado en el código (exige HTTPS, emisor y clave pública); aún sin perfil de compilación. |

Variables principales: `EXPO_PUBLIC_CLINICAL_URL`, `EXPO_PUBLIC_GATEWAY_URL`,
`EXPO_PUBLIC_POWERSYNC_URL`, `EXPO_PUBLIC_AUTH_URL`, `EXPO_PUBLIC_AUTH_ISSUER`,
`EXPO_PUBLIC_AUTH_AUDIENCE`, `EXPO_PUBLIC_AUTH_PUBLIC_KEY`, `EXPO_PUBLIC_AUTH_REDIRECT_URI`
(`quimiocare://acceso/oauth`) y `EXPO_PUBLIC_EXPO_PROJECT_ID`. El APK no contiene secretos: solo
direcciones públicas y la clave pública de verificación.

El manifiesto Android desactiva el respaldo automático (`allowBackup: false`) y el tráfico HTTP sin
cifrar (`plugins/withSecureNetwork.js`), salvo en la build de diagnóstico P01 por USB.

## Ejecutar y compilar

Desde la raíz del repositorio, con las versiones de Node y pnpm fijadas:

```bash
pnpm install --frozen-lockfile
pnpm --filter @modulo-movil-oncologia/mobile start
pnpm --filter @modulo-movil-oncologia/mobile android
```

El APK de entrega lo compila `.github/workflows/build-apk.yml` (`expo prebuild` y
`./gradlew assembleRelease`, `arm64-v8a` o universal). Para una build demo local:

```bash
pnpm --filter @modulo-movil-oncologia/mobile run run:android:demo
```

## Pruebas

```bash
pnpm check             # formato, lint y tipos de todo el monorepositorio
pnpm run test:local    # Vitest: lógica, SQLite real en Node, sincronización, triage, reportes
pnpm run test:ui       # Jest + React Native Testing Library: pantallas y accesibilidad
pnpm --filter @modulo-movil-oncologia/mobile run doctor
pnpm --filter @modulo-movil-oncologia/mobile run bundle:android
```

Al 17-11-2026: **1.069 pruebas Vitest** y **316 pruebas Jest**, todas en verde. Las de SQLite usan
una base real (`data/local/testing/sqlite-test-harness.ts`), no simulaciones.

Las pruebas de extremo a extremo en Android (6 flujos de Maestro, `pnpm run test:e2e`) están en
[e2e/](e2e/README.md); se corren a mano con un teléfono conectado, no en CI.

## Verificación en dispositivo

El 13 y 17-11-2026 se ejecutaron 13 pruebas en un Redmi 13C 5G (Android 14, HyperOS 1.0) por
adb: permisos, alarmas exactas, avisos con la app cerrada, tras reinicio, en reposo profundo, con
ahorro de batería y sin red, tiempo de apertura del PDF (máximo 1,23 s, RNF-06 < 3 s), TalkBack y
letra máxima. Los hallazgos se corrigieron en los PR #28 a #34 y se verificaron de nuevo en el
teléfono. El detalle está en el Anexo D del informe.

RNF-05 (cambio de paciente en menos de 1 s) se midió con video a 60 cuadros/s en 5 cierres de
sesión: la pantalla de acceso queda visible en 0,40 a 0,43 s. El drenaje posterior (cancelar avisos
y cerrar la base) sigue en segundo plano con el aviso «Cerrando la sesión anterior».

## Limitaciones conocidas

- La orientación de síntomas no tiene aprobación clínica y el plan paliativo individual está
  desactivado.
- Las reglas de PowerSync solo admiten a los pacientes sintéticos A y B.
- La retención de datos clínicos de 90 días está implementada pero desactivada
  (`CLINICAL_RETENTION_ENABLED`).
- No hay certificate pinning (el certificado del dominio lo administra la universidad).
- Solo Android.
