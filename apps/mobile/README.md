# @modulo-movil-oncologia/mobile

Aplicación Android **QuimioCare** para acompañamiento de pacientes en quimioterapia, desarrollada con React Native, Expo, TypeScript y Expo Router.

## Estado actual

La aplicación contiene la base Expo, la navegación principal y la consolidación de la experiencia demostrativa local para Sprint 1 mediante datos sintéticos. Se organiza en cuatro pestañas principales con navegación por pilas independientes:

- **Inicio:** resumen del paciente activo, acceso directo al diario de síntomas libres (`/formulario/sintomas-libres`), cambio dinámico entre pacientes de prueba A/B y distintivo de demostración sintética (`DemoBadge`).
- **Vitales:** registro de constantes vitales en SQLite local con operaciones en cola y generación/exportación de reportes clínicos locales en dos formatos independientes (PDF con `expo-print` y Excel `.xlsx` real con SheetJS Community Edition 0.20.3, compartidos vía `expo-sharing`) con resumen calculado de mediciones (7, 30 y 90 días), detalle cronológico de signos vitales y síntomas con preservación textual libre de inyecciones de fórmulas, almacenados en `reportes_locales/{paciente_id}/` con nombres auditables `reporte_{dias}d_{timestamp}.(pdf|xlsx)`, sanitización HTML, bloqueo de almacenamiento por paciente (`withPatientReportLock`), deduplicación acotada por paciente/período/formato y pantalla de estado con apertura de hoja nativa de compartir.
- **Formulario:** catálogo de cuestionarios médicos asignados de demostración (modelos sintéticos neutros QLQ-C30 y ESAS: 2 para Paciente A, 1 para Paciente B) con validación de respuestas requeridas y rangos, guardado de borradores locales en almacenamiento persistente con respaldo seguro (`.tmp` → `.bak` → `.json`) y confirmación de guardado local, diferenciado de la ruta dedicada de síntomas diarios libres.
- **Educación:** catálogo multimedia de recursos educativos (videos de YouTube online con advertencia de consumo de datos y guías Markdown e infografías PNG descargables en almacenamiento seguro con verificación criptográfica SHA-256 en SQLite v7), con nombres únicos inmutables, prevención de path traversal con validadores de dominio, compensación en fallo de SQLite, protección de escrituras en curso (`activeWrites`), limpieza de temporales huérfanos y reconciliación automática bidireccional que marca archivos ausentes en SQLite para permitir su reintento desde la app.
- **Perfil:** datos personales, esquema de quimioterapia y código de vinculación médica offline persistidos en SQLite, además de preferencias de apariencia con cuatro paletas accesibles (Turquesa, Azul, Violeta, Ámbar) y soporte claro/oscuro guardado localmente con AsyncStorage.
- **Recordatorios locales y avisos:** sistema de avisos 100% offline basado en `expo-notifications` y Android AlarmManager, con preservación absoluta de privacidad en pantalla de bloqueo («Tienes un recordatorio en QuimioCare» / «Ingresa a la aplicación para revisar tu seguimiento diario»), sin escrituras en `cola_envio`. Switch maestro y reglas opt-in deshabilitadas inicialmente; ventana móvil determinista de 14 días renovable en apertura (hasta 128 trabajos nativos); vinculación a signos vitales y medicamentos activos; bandeja de avisos auditables (`/avisos`) con historial y filtros de entrega (`Todos`, `Programados`, `Observados`, `Cancelados`) y navegación en contexto sin inferir tomas clínicas.
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
4. Responder cuestionarios, guardar borradores locales, generar reportes PDF, descargar recursos educativos y programar recordatorios sin red. Cerrar la aplicación forzosamente (`adb shell am force-stop cl.ubiobio.quimiocare`) y reabrirla para comprobar que la persistencia en SQLite, almacenamiento seguro, alarmas locales y aislamiento por paciente se mantienen intactos.

## Comprobaciones

Desde la raíz:

```bash
pnpm check
pnpm run test:local
pnpm run test:ui
pnpm --filter @modulo-movil-oncologia/mobile run doctor
pnpm --filter @modulo-movil-oncologia/mobile run bundle:android
```

Las 189 pruebas unitarias con Vitest (`pnpm run test:local`) distribuidas en 17 suites modulares (12 suites de persistencia SQLite: `migrations.test.ts`, `records-outbox.test.ts`, `patient-context.test.ts`, `downloads.test.ts`, `education.test.ts`, `forms.test.ts`, `clinical-context.test.ts`, `consents.test.ts`, `report-data.test.ts`, `reminder-repository.test.ts`, `occurrence-scheduler.test.ts`, `notification-coordinator.test.ts`; junto a `resource-storage.test.ts`, `medical-forms.test.ts`, `report-security.test.ts`, `report-xlsx.test.ts` y `environment.test.ts`), más las 2 suites de pruebas de interfaz con Jest y React Native Testing Library (`pnpm run test:ui`, 21 pruebas de UI en `education.ui.test.tsx` y `reminders.ui.test.tsx`), comprueban las migraciones de SQLite (v1 a v8), aislamiento A/B, repositorios clínicos, almacenamiento multimedia educativo, validación de respuestas en cuestionarios, reemplazo seguro de borradores, exportación multi-formato (PDF y XLSX), cálculo determinista de ocurrencias de recordatorios con ventana móvil de 14 días y saltos DST en America/Santiago, despacho idempotente en el sistema operativo, preservación estricta de privacidad en notificaciones de cabecera y pantalla bloqueada, y resiliencia ante cierres forzados. La exportación `bundle:android` comprueba el empaquetado JavaScript de Expo Router sin requerir emulador; la ejecución nativa con la Development Build (`android` / `run:android:demo`) valida el runtime nativo en Android (SQLite, `expo-file-system`, `expo-network`, `expo-print`, `expo-sharing`, `expo-notifications` y aislamiento por paciente).

### Acreditación de RNF-06 y verificación en Android

El benchmark automatizado en Node (`report-data.test.ts`) evalúa exclusivamente la extracción de base de datos SQLite y construcción en memoria de `ReportData`. La acreditación formal del requerimiento no funcional **RNF-06** (generación y persistencia de reportes clínicos en menos de 3 segundos sobre hardware móvil de gama media/baja) y la verificación funcional de la experiencia nativa se ejecutan de manera diferenciada siguiendo el protocolo aprobado para el commit inmutable **`0360dfb`** y complementado para los incrementos 4 y 5.

#### Precisiones metodológicas del protocolo

1. **Delimitación de la ventana de medición temporal:** El cronómetro inicia en el instante exacto en que el usuario confirma la acción («Generar y compartir» en la interfaz móvil) —abarcando la consulta transaccional SQLite sobre `tx` y el cálculo del snapshot en memoria `ReportData`— hasta recibir el resultado del archivo binario final persistido en almacenamiento privado (`persistReportFile`), **antes** de abrir la hoja de compartir del sistema (`expo-sharing`).
2. **Estructura de muestreo (fría vs. calientes):** Se registran 5 ejecuciones consecutivas por formato (PDF y XLSX), identificando la primera medición como fría (_cold start_ de compilación de plantillas y caches de I/O) y las cuatro siguientes como calientes (_warm_). La medición fría se conserva íntegramente en el informe; el promedio de las calientes se calcula por separado, pero la medición fría no se descarta.
3. **Criterio estricto de acreditación (no solo promedio):** Para acreditar RNF-06 no basta un promedio menor a 3 segundos; se reportan los 5 tiempos individuales y se exige que el **tiempo máximo absoluto** satisfaga `max < 3.000 ms` (< 3,00 s) para un volumen representativo de prueba (500 signos vitales y 500 síntomas en 90 días).
4. **Separación de entornos y trazabilidad de compilación:**
   - **Validación funcional (Escenarios 1 al 6 y N-01 al N-06):** Emulador Android AVD `Dispositivo_Liviano` (Android 14 / API 34).
   - **Rendimiento RNF-06:** Teléfono físico de referencia en variante Release (`app-release.apk`, SHA inmutable `0360dfb`), ejecutado en Modo Avión sin servidor Metro ni depuración interactiva.
5. **Expectativas ajustadas del visor y formato:**
   - **PDF:** La plantilla médica HTML contiene un **único pie institucional al final del documento** (no repetido por página). La aplicación no abre automáticamente un visor interno, sino la **hoja de compartir nativa del sistema**, desde la que el usuario selecciona una aplicación compatible. La revisión multipágina comprueba legibilidad tipográfica, integridad de los datos y ausencia de recortes de filas gracias a reglas CSS de salto limpio (`page-break-inside: avoid`).
   - **XLSX:** Apertura vía hoja de compartir en visores de hoja de cálculo del sistema (Microsoft Excel, Google Sheets o LibreOffice). Se valida la presencia de 3 hojas estructuradas (`Resumen`, `Signos vitales`, `Sintomas`), identificadores de registro, fechas locales y ausencia de texto `'—'` en celdas numéricas vacías, garantizando preservación literal sin inyecciones de fórmulas.
6. **Aislamiento A/B verificado en la aplicación:** Al conmutar entre el Paciente A y el Paciente B, la interfaz de usuario aísla estrictamente el catálogo y listado de reportes, descargas y recordatorios: **el Paciente B no lista ni accede a los datos ni a las notificaciones de AlarmManager del Paciente A**.
7. **Resiliencia y cancelación:** Tras un cierre forzado (`am force-stop`), los reportes confirmados sobreviven y la agenda de recordatorios se reconcilia automáticamente sin trabajos huérfanos ni duplicados.

#### Trazabilidad de compilación y escenarios del incremento 5 (Recordatorios y avisos locales)

- **Trazabilidad de la compilación probada (Release autónoma Incremento 5):**
  - **Variante Release Demo (compilada con `EXPO_PUBLIC_DEMO_MODE=true`):**
    - **Ruta del APK:** `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`
    - **SHA-256 del APK:** `98FD88E95F222DAB08C68E1C601D8DF8D2531A8C7D66E54AB22C4B6AF1FA6741`
    - **Comportamiento:** Selector sintético A/B, siembra de pacientes en SQLite v8, switch opt-in deshabilitado por defecto y generación local de ocurrencias en Modo Avión.
  - **Variante Release Estándar (compilada sin `EXPO_PUBLIC_DEMO_MODE`):**
    - **SHA-256 del APK:** `9146EDED86AAB21472BE72EE108A4038CBF4E3F0E1E7AE797BDFE67AF5337FE2`
    - **Comportamiento:** Pantalla estándar de inicio ("Sesión requerida") sin selector A/B ni datos sintéticos sembrados.

- **Resultados de escenarios de aceptación nativa en Android (Modo Avión / sin Metro):**
  - **A-01 (Actualización y persistencia de esquema SQLite v8):** Ejecución de migración 008 en base de datos existente con clave foránea compuesta `(paciente_id, medicamento_id)` referenciando `medicamento_activo_cache(paciente_id, id)` e índice único de idempotencia `idx_notificacion_ocurrencia_unica`. Integridad de datos y tablas previas 100% conservada.
  - **N-01 (Estado inicial y denegación de permisos):** Switch maestro en `false` por defecto y reglas inactivas. Con permiso denegado en el sistema operativo, la aplicación muestra banner informativo claro sin fallos ni excepciones no controladas.
  - **N-02 & N-03 (Activación, programación y entrega en Modo Avión / Background):** Al activar el switch y habilitar reglas, el planificador puro calcula deterministamente la ventana móvil de 14 días (ej. 26 ocurrencias para signos vitales y medicación). Las ocurrencias se persisten en `notificacion_local` y se programan en Android AlarmManager (`RTC_WAKEUP`). Con la app en segundo plano y Modo Avión activo, la alarma despierta al sistema y presenta la notificación en la barra de estado con texto genérico que preserva la privacidad del paciente («Tienes un recordatorio en QuimioCare» / «Ingresa a la aplicación para revisar tu seguimiento diario»).
  - **N-04 (Vínculo de medicación y DST America/Santiago):** Regla de medicación ligada a `med-a-1` ('Ondansetrón 8 mg'). El cálculo de fechas y horas civiles locales respeta el huso horario chileno con sus transiciones horarias estivales sin desfases ni dobles despachos.
  - **N-05 (Aislamiento de contexto y navegación idempotente):** Al pulsar la notificación, QuimioCare abre directamente la pantalla objetivo (`/vitales/registrar` o `/perfil/medicacion`). Al cambiar al Paciente B, todos los trabajos nativos de Paciente A son cancelados de AlarmManager (dejando 0 alarmas activas para B). Al volver a Paciente A, sus preferencias y reglas se conservan y reconcilian limpiamente.
  - **N-06 (Recuperación tras cierre forzado / reinicio):** `adb shell am force-stop cl.ubiobio.quimiocare` y reapertura en frío: la agenda se reconcilia deterministamente, las 26 ocurrencias en SQLite coinciden con los 26 registros en AlarmManager y la bandeja de avisos (`/avisos`) muestra el estado auditado de cada aviso.

  - **Escenario 2 (Primer guardado de infografía empaquetada PNG offline en Release limpia):** Extracción nativa desde drawable empaquetado (`AssetModule.downloadAsync`), verificación de hash SHA-256 (`fd226d6bbe1227d7...`), registro atómico en SQLite v7 y visualización fluida de `<Image>` (1281 KB). (Aprobado en Android).
  - **Escenario 3 (Lectura y visualización tras reinicio en frío):** Tras cierre forzado con `am force-stop` y reapertura en Modo Avión, la infografía guardada permanece intacta en «Mis copias guardadas» y se visualiza offline desde disco sin dependencias externas. (Aprobado en Android).
  - **Escenario 4 (Catálogo vacío / desacoplado):** Sustitución y retiro explícito del catálogo en memoria (0 contenidos). Consulta de copias locales en SQLite y lectura del archivo PNG desde disco funcionando con metadatos de contingencia (`Material guardado`, `Categoría: Material local`). (Aprobado en prueba nativa y de interfaz).
  - **Escenario 5 (Reversión transaccional y compensación pre-commit ante fallo):** Simulación de fallo en inserción SQLite previa al commit: transacción revertida y archivo `.tmp` eliminado del disco sin dejar residuos huérfanos. (Aprobado en prueba unitaria y en modal de diagnóstico nativo).
  - **Escenario 6 (Robustez de contratos de almacenamiento y entorno):**
    - `form-draft-storage.ts`: `recoverOrphanDraftBackups()` y `listPatientDrafts()` usan `directoryExists()` con compatibilidad estricta para adaptadores nativos (`ExpoFileStorageAdapter`).
    - `resource-storage.ts` & `reconciliation.ts`: `checkDiskExists` propaga errores de acceso en lugar de convertirlos en falsas ausencias, conservando el estado previo de las copias.
    - `EducationScreens.tsx`: «Reintentar visualización» actualiza la key asociada a un contador de reintentos, provocando el remontaje y nueva carga real de `<Image>`.
    - `environment.ts`: `isDemoMode()` requiere activación explícita (`process.env.EXPO_PUBLIC_DEMO_MODE === 'true'`) en builds Release para no filtrar accidentalmente el modo demo en versiones estándar.

- **Medición RNF-06 en hardware físico:** Pendiente de acreditación formal sobre dispositivo físico de referencia conectado por USB / modo autónomo. El protocolo metodológico queda fijado y listo para registrar las 5 mediciones individuales (1 fría y 4 calientes) cuando se disponga de dicho hardware.
- **Validación funcional en Android:** Totalmente verificada con pruebas automáticas unitarias (171 pruebas en 14 suites) y de interfaz (10 pruebas en Jest/RNTL), con Expo Doctor (21/21) y compilación/empaquetado en CI 100% aprobados.

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
  - `reminders/`: configuración de recordatorios locales (`RemindersListScreen.tsx`), edición y vinculación de reglas (`ReminderEditScreen.tsx`) y bandeja de avisos auditables (`NoticesTrayScreen.tsx`).
  - `assistant/`: prototipo visual del asistente oncológico.
- `src/services/`: servicios y coordinación desacoplada del sistema operativo:
  - `notifications/`: adaptador de notificaciones de Expo (`expo-notification-adapter.ts`) y contratos de permisos/programación.
  - `reminders/`: coordinador determinista con mutex y resolución de cancelaciones (`notification-coordinator.ts`) y planificador puro de ocurrencias con ventana móvil y DST (`occurrence-scheduler.ts`).
- `src/data/local/`: persistencia local modularizada por dominio:
  - `core/`: base de datos SQLite (`database.ts`, adaptadores Expo/Node), sembrador de datos sintéticos (`seeder.ts`) y tipos base (`types.ts`, `sql.ts`).
  - `migrations/`: migraciones versionadas de esquema SQL (001 a 008, `migrator.ts`).
  - `forms/`: persistencia, ingestión y validación de formularios médicos y borradores.
  - `clinical-context/`: repositorio e ingestión de contexto clínico (diagnósticos, esquema de quimioterapia, medicamentos, citas).
  - `consents/`: registro inmutable de consentimientos, verificación de términos y firmas criptográficas.
  - `reports/`: repositorio de reportes (`report-repository.ts`), tipos y snapshot inmutable `ReportData` (`report-types.ts`).
  - `reminders/`: repositorio de reglas y ocurrencias (`reminder-repository.ts`), tipos y generación v4 de UUIDs (`reminder-types.ts`).
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
