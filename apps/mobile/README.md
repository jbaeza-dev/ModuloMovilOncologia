# @modulo-movil-oncologia/mobile

Aplicación Android **QuimioCare** para acompañamiento de pacientes en quimioterapia, desarrollada con React Native, Expo, TypeScript y Expo Router.

## Estado actual

La aplicación contiene la base Expo, la navegación principal y la consolidación de la experiencia demostrativa local para Sprint 1 mediante datos sintéticos. Se organiza en cuatro pestañas principales con navegación por pilas independientes:

- **Inicio:** resumen del paciente activo, acceso directo al diario de síntomas libres (`/formulario/sintomas-libres`), cambio dinámico entre pacientes de prueba A/B y distintivo de demostración sintética (`DemoBadge`).
- **Vitales:** registro de constantes vitales en SQLite local con operaciones en cola y generación/exportación de reportes clínicos locales en dos formatos independientes (PDF con `expo-print` y Excel `.xlsx` real con SheetJS Community Edition 0.20.3, compartidos vía `expo-sharing`) con resumen calculado de mediciones (7, 30 y 90 días), detalle cronológico de signos vitales y síntomas con preservación textual libre de inyecciones de fórmulas, almacenados en `reportes_locales/{paciente_id}/` con nombres auditables `reporte_{dias}d_{timestamp}.(pdf|xlsx)`, sanitización HTML, bloqueo de almacenamiento por paciente (`withPatientReportLock`), deduplicación acotada por paciente/período/formato y pantalla de estado con apertura de hoja nativa de compartir.
- **Formulario:** catálogo de cuestionarios médicos asignados de demostración (modelos sintéticos neutros QLQ-C30 y ESAS: 2 para Paciente A, 1 para Paciente B) con validación de respuestas requeridas y rangos, guardado de borradores locales en almacenamiento persistente con respaldo seguro (`.tmp` → `.bak` → `.json`) y confirmación de guardado local, diferenciado de la ruta dedicada de síntomas diarios libres.
- **Educación:** catálogo de recursos educativos con descarga en Markdown en almacenamiento seguro (`recursos_educativos/{paciente_id}/{contenido_id}_{timestamp}.md`), con nombres únicos inmutables, prevención de path traversal con validadores de dominio, compensación en fallo de SQLite, protección de escrituras en curso (`activeWrites`), limpieza de temporales huérfanos y reconciliación automática bidireccional que marca archivos ausentes en SQLite para permitir su reintento desde la app.
- **Perfil:** datos personales, esquema de quimioterapia y código de vinculación médica offline persistidos en SQLite, además de preferencias de apariencia con cuatro paletas accesibles (Turquesa, Azul, Violeta, Ámbar) y soporte claro/oscuro guardado localmente con AsyncStorage.
- **Asistente:** prototipo visual demostrativo sin conexión a servidor ni modelos de lenguaje externos.

Durante desarrollo y modo demo se selecciona explícitamente el paciente sintético A o B. Signos vitales, síntomas, contexto del paciente (perfil, tratamiento, código de vinculación), borradores de cuestionarios, reportes PDF y descargas educativas se guardan de forma persistente y aislada físicamente por paciente, sobreviven al reinicio de la aplicación y funcionan sin conexión. Cada alta clínica crea una operación `pendiente` en la misma transacción. No hay autenticación con servidor, envío REST remoto, sincronización bidireccional ni evaluación clínica.

En Perfil → Preferencias → Accesibilidad y apariencia, se puede seleccionar Turquesa, Azul, Violeta o Ámbar. El modo claro u oscuro sigue el ajuste del dispositivo y la paleta elegida se guarda localmente con AsyncStorage. Alertas y estados clínicos mantienen colores semánticos independientes de la paleta.

## Desarrollo local y compilación

Usar Node.js y pnpm en las versiones fijadas en la raíz. La aplicación cuenta con su propia **Development Build** Android (`cl.ubiobio.quimiocare`) basada en `expo-dev-client`.

### Modo desarrollo (con recarga en vivo mediante Metro)

```bash
pnpm install --frozen-lockfile
# Terminal 1: Iniciar el servidor Metro
pnpm --filter @modulo-movil-oncologia/mobile start

# Terminal 2: Compilar y ejecutar la Development Build en Android
pnpm --filter @modulo-movil-oncologia/mobile android
```

### Build Demo Release autónoma (demostración offline en Modo Avión)

Para evaluar la persistencia local de forma independiente sin depender de una PC ni del servidor Metro:

```bash
# Compilar e instalar la variante Release con datos sintéticos y selector A/B
pnpm --filter @modulo-movil-oncologia/mobile run run:android:demo
```

El script `run:android:demo` establece automáticamente `EXPO_PUBLIC_DEMO_MODE=true` mediante `cross-env` y compila la variante Release con el bundle JavaScript y assets embebidos.

El archivo APK autónomo se genera en:
`apps/mobile/android/app/build/outputs/apk/release/app-release.apk`

Para probarlo sin conexión en un emulador o dispositivo real:

1. Instalar el APK: `adb install -r apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
2. Activar el **Modo Avión** en el dispositivo y asegurarse de no tener el servidor Metro corriendo.
3. Iniciar la app en frío: se presentará el selector de pacientes sintéticos A y B.
4. Responder cuestionarios, guardar borradores locales, generar reportes PDF y descargar recursos educativos sin red. Cerrar la aplicación forzosamente (`adb shell am force-stop cl.ubiobio.quimiocare`) y reabrirla para comprobar que la persistencia en SQLite, almacenamiento seguro y aislamiento por paciente se mantienen intactos.

## Comprobaciones

Desde la raíz:

```bash
pnpm check
pnpm run test:local
pnpm --filter @modulo-movil-oncologia/mobile run doctor
pnpm --filter @modulo-movil-oncologia/mobile bundle:android
```

Las 150 pruebas unitarias con Vitest (`pnpm run test:local`) distribuidas en 12 suites modulares (8 suites de persistencia SQLite: `migrations.test.ts`, `records-outbox.test.ts`, `patient-context.test.ts`, `downloads.test.ts`, `forms.test.ts`, `clinical-context.test.ts`, `consents.test.ts`, `report-data.test.ts`; junto a `resource-storage.test.ts`, `medical-forms.test.ts`, `report-security.test.ts` y `report-xlsx.test.ts`) comprueban las migraciones de SQLite, aislamiento A/B, repositorios clínicos, compensación ante fallos de base de datos, validación de respuestas en cuestionarios, reemplazo seguro de borradores, sanitización de reportes locales, exportación multi-formato (PDF y XLSX), preservación de texto literal libre de inyecciones, contexto clínico, consentimientos, benchmark de extracción y volumen de datos en Node (< 3s para 500 signos y 500 síntomas), prevención de deadlocks cruzados (A/B) y lógica de reconciliación bidireccional en harnesses independientes con directorios temporales aislados por proceso. La exportación `bundle:android` comprueba el empaquetado JavaScript de Expo Router sin requerir emulador; la ejecución nativa con la Development Build (`android` / `run:android:demo`) valida el runtime nativo en Android (SQLite, `expo-file-system`, `expo-print`, `expo-sharing` y aislamiento por paciente). QuimioCare utiliza su propia Development Build en lugar de Expo Go para dar soporte completo a módulos nativos presentes y futuros (como PowerSync).

### Acreditación de RNF-06 y verificación en Android

El benchmark automatizado en Node evalúa exclusivamente la extracción de base de datos y construcción en memoria de `ReportData`. La acreditación formal del requerimiento no funcional **RNF-06** (generación y persistencia de reportes en menos de 3 segundos) requiere ser ejecutada en un dispositivo físico Android de referencia en modo release, midiendo cinco repeticiones por formato (PDF y XLSX) con el archivo binario completo persistido en disco.

El protocolo de verificación en Android abarca los siguientes escenarios clave:

1. **Generación de PDF multipágina:** verificación visual de formato, paginación limpia sin cortes de fila (`page-break-inside: avoid`), encabezados con fecha de emisión y zona horaria (`America/Santiago`), y disclaimers demostrativos.
2. **Apertura de planilla Excel (.xlsx):** comprobación de apertura en visor de hojas de cálculo del sistema operativo, validando las tres hojas estructuradas (`Resumen`, `Signos vitales` y `Sintomas`), los identificadores de registro, las fechas locales y la ausencia de texto `'—'` en celdas numéricas ausentes.
3. **Reporte con solo síntomas:** generación correcta cuando no existen signos vitales registrados en el período pero sí síntomas clínicos.
4. **Persistencia tras reinicio:** verificación de supervivencia del reporte en el almacenamiento tras forzar el cierre de la app (`am force-stop`) y posterior reapertura, comprobando la depuración automática de temporales huérfanos (`.tmp_reporte_*`).
5. **Aislamiento de almacenamiento A/B:** confirmación de que los reportes generados para el Paciente A no son accesibles ni listados cuando el usuario conmuta al Paciente B.
6. **Conservación ante cancelación de compartir:** si el usuario descarta o cancela la hoja de compartir del sistema, o si el componente de compartir no está disponible, el archivo del reporte permanece intacto y confirmado en el almacenamiento local.

## Organización

- `src/app/`: rutas y layouts de Expo Router (incluyendo pestañas, rutas auxiliares y `/formulario/sintomas-libres`).
- `src/components/`: pantalla base, acciones de navegación, cabeceras y distintivos (`DemoBadge.tsx`).
- `src/features/`: pantallas por funcionalidad:
  - `home/`: pantalla de inicio y selector de paciente sintético en demo.
  - `vitals/`: registro e historial de constantes vitales en SQLite.
  - `medical-forms/`: catálogo y formulario de cuestionarios asignados sintéticos (`MedicalFormsScreens.tsx`), persistencia segura de borradores locales (`form-draft-storage.ts`), validación de respuestas (`medical-form-validation.ts`) y asignaciones por paciente (`medical-form-service.ts`).
  - `form/`: pantalla dedicada al registro diario de síntomas libres (`SymptomDataScreen.tsx`, ruta `/formulario/sintomas-libres`).
  - `reports/`: resumen de vitales y síntomas, plantilla médica HTML con sanitización (`report-template.ts`), generador PDF (`report-pdf.ts`), generador Excel `.xlsx` estructurado (`report-xlsx.ts`) y pantallas de configuración y estado (`ReportsScreens.tsx`, `ReportStatusScreen`).
  - `education/`: catálogo educativo, lector de copias locales en Markdown, compensación ante errores y reconciliación bidireccional (`EducationScreens.tsx`).
  - `profile/`: perfil clínico, esquema de quimioterapia, código de vinculación y preferencias de apariencia.
  - `assistant/`: prototipo visual del asistente oncológico.
- `src/data/local/`: persistencia local modularizada por dominio:
  - `core/`: base de datos SQLite (`database.ts`, adaptadores Expo/Node), sembrador de datos sintéticos (`seeder.ts`) y tipos base (`types.ts`, `sql.ts`).
  - `migrations/`: migraciones versionadas de esquema SQL (001 a 006, `migrator.ts`).
  - `forms/`: persistencia, ingestión y validación de formularios médicos y borradores.
  - `clinical-context/`: repositorio e ingestión de contexto clínico (diagnósticos, esquema de quimioterapia, medicamentos, citas).
  - `consents/`: registro inmutable de consentimientos, verificación de términos y firmas criptográficas.
  - `reports/`: repositorio de reportes (`report-repository.ts`), tipos y snapshot inmutable `ReportData` (`report-types.ts`).
  - `files/`: gestión y reconciliación de archivos locales descargados y almacenamiento binario seguro de reportes (`report-storage.ts`, `resource-storage.ts`, `reconciliation.ts`).
  - `testing/`: harness aislado de pruebas (`sqlite-test-harness.ts`) para suites unitarias en Node.
  - `repository.ts`: fachada unificada de persistencia para el consumo de pantallas y providers.
- `src/hooks/`: hooks reactivos reutilizables (`use-local-query.ts`).
- `src/utils/`: utilidades compartidas, incluyendo cálculo criptográfico SHA-256 (`crypto.ts`).
- `src/theme.ts`: paletas de colores accesibles, tokens semánticos, espaciados y radios compartidos.
- `src/providers/ThemeProvider.tsx`: selección de paleta, modo claro/oscuro del dispositivo y persistencia en AsyncStorage.
- `src/providers/LocalDataProvider.tsx`: apertura transaccional de SQLite, siembra sintética y gestión del paciente activo.

Cada pestaña tiene una pila. Perfil y Asistente pertenecen a Inicio; el registro de
signos vitales pertenece a Vitales; el registro diario de síntomas libres cuenta con su
propia ruta accesible desde Inicio. `router.navigate` evita apilar reiteradamente el
mismo destino y `withAnchor` conserva la raíz de la pila al entrar en una ruta interna.
La barra inferior permanece visible; Atrás recorre la pila y luego vuelve a Inicio.
La navegación desconocida permite reemplazar la ruta por Inicio.

Los iconos son Feather mediante `@expo/vector-icons`; `expo-font` carga su fuente
local antes de mostrar la interfaz. No necesitan descargar recursos al abrir la app.

## Arquitectura prevista

La app usa su propio SQLite para registros clínicos y cola local; PowerSync administrará otra base para el catálogo educativo cuando se implemente la infraestructura central. El contrato v0 sigue en revisión y esta rama no incluye cliente HTTP ni worker de envío remoto. Las pruebas con Vitest ejercitan migraciones y repositorios sobre SQLite real en Node; el recorrido en Android valida el adaptador nativo por separado.

Las futuras pruebas de componentes nativos usarán herramientas compatibles con
Expo y React Native.
