# @modulo-movil-oncologia/mobile

Aplicación Android **QuimioCare** para acompañamiento de pacientes en quimioterapia, desarrollada con React Native, Expo, TypeScript y Expo Router.

## Estado actual

La aplicación contiene la base Expo, la navegación principal y la consolidación de la experiencia demostrativa local para Sprint 1 mediante datos sintéticos. Se organiza en cuatro pestañas principales con navegación por pilas independientes:

- **Inicio:** saludo personalizado con el primer nombre del paciente activo, botón accesible «Mi perfil» en el encabezado con área táctil de 48 dp, tarjeta de estado del próximo recordatorio (`useReminderStatus`), un único acceso principal destacado «Registrar signos vitales» disponible independientemente del estado de las notificaciones, seguido del registro de síntomas diarios (`/(tabs)/(inicio)/registrar-sintomas`), accesos secundarios reordenados («Mis medicamentos», «Recordatorios», «Avisos», «Asistente»), cambio confirmado de paciente o cierre de sesión (`ConfirmLogoutButton`), y distintivo de demostración sintética (`DemoBadge`). Ante permisos bloqueados o avisos deshabilitados, presenta una tarjeta interactiva con la acción «Permitir notificaciones», la cual activa inmediatamente las preferencias locales, limpia el caché de preparación, reconcilia los avisos y sincroniza el coordinador nativo, descartando la alerta al instante.
- **Mediciones (pestaña `vitales`):** registro estructurado de constantes vitales en SQLite local con validación tipada campo a campo (`validateVitalInput`), enfoque automático al primer error (`autoFocus`), área de acción inferior accesible (`Screen.bottomAction`), protección frente a navegación involuntaria con cambios sin guardar (`usePreventRemove`), e historial cronológico agrupado por día civil («Hoy», «Ayer», fechas completas) con resumen dinámico que refleja únicamente los valores registrados. Incluye la configuración simplificada y generación/exportación de reportes clínicos locales en dos formatos independientes (PDF con `expo-print` y Excel `.xlsx` real con SheetJS Community Edition 0.20.3, compartidos vía `expo-sharing`) con resumen calculado de mediciones (7, 30 y 90 días), confirmación de eliminación segura de archivos sin alteración de datos clínicos, y pantalla de estado estable.
- **Formulario:** catálogo de cuestionarios médicos asignados de demostración (modelos sintéticos neutros QLQ-C30 y ESAS: 2 para Paciente A, 1 para Paciente B) con validación de respuestas requeridas y rangos, guardado de borradores locales en almacenamiento persistente con respaldo seguro (`.tmp` → `.bak` → `.json`) y confirmación de guardado local, diferenciado de la ruta dedicada de síntomas diarios libres. Al vincular un nuevo tratamiento y profesional de salud mediante código, el catálogo de formularios se sincroniza y refresca de forma inmediata en segundo plano.
- **Educación:** catálogo multimedia de recursos educativos (videos de YouTube online con advertencia de consumo de datos y guías Markdown e infografías PNG descargables en almacenamiento seguro con verificación criptográfica SHA-256 en SQLite v7), con nombres únicos inmutables, prevención de path traversal con validadores de dominio, compensación en fallo de SQLite, protección de escrituras en curso (`activeWrites`), limpieza de temporales huérfanos y reconciliación automática bidireccional que marca archivos ausentes en SQLite para permitir su reintento desde la app. La vinculación con un equipo tratante gatilla la actualización inmediata del catálogo educativo asignado.
- **Perfil:** estructurado en tres secciones compactas con tarjetas de navegación de 48 dp mínimas («Mi tratamiento», «Mis datos», «Configuración y privacidad»). En «Mi tratamiento» se expone el protocolo formal mFOLFOX6 con medicamentos activos, dosis y referencias eviQ 637. En «Mis medicamentos» se visualizan fármacos activos con sus indicaciones y acceso directo «Configurar aviso». Incluye datos personales, código de vinculación médica y preferencias de apariencia con cuatro paletas accesibles (Turquesa, Azul, Violeta, Ámbar) y soporte claro/oscuro guardado localmente con AsyncStorage.
- **Recordatorios locales y Agenda compartida:** sistema de avisos offline basado en `expo-notifications` y Android AlarmManager, junto con soporte para notificaciones push automáticas del dispositivo vinculadas a la cuenta (con identificador estable RFC4122 UUIDv4 en `SecureStore` que previene errores de registro). La configuración de avisos se respeta estrictamente en toda la app (con revocación manual o al cerrar sesión). La pantalla de creación y edición (`ReminderEditScreen` y `SharedAgendaEditScreen`) incorpora un selector de horarios `DateTimePickerField` estabilizado para teclado y un rediseño completo de la selección de días de la semana: chips horizontales accesibles de 44×50 dp con días inequívocos (`Lu, Ma, Mi, Ju, Vi, Sá, Do`), punto indicador de selección activa, resumen dinámico en lenguaje natural («Todos los días», «Lunes a viernes (días hábiles)», «Fin de semana») y accesos rápidos (presets) de 1 toque.
- **Asistente:** controlador de solicitudes (`AssistantController`) con comprobación previa de disponibilidad (`isConfigured`) que informa honestamente si el servicio no está configurado antes de escribir, aislamiento de intentos, temporizador de timeout a los 15 segundos con invalidación y descarte de respuestas tardías, reintento manual que preserva `requestId` únicamente con entrada idéntica, prevención de doble pulsación durante el envío, disclaimer permanente RNF-08 visible en todo momento («El asistente no sustituye el criterio médico...»), buffer FIFO de 50 mensajes en memoria (sin persistencia en SQLite ni `cola_envio`), límite de captura de 2.000 caracteres con alerta al aproximarse al límite (`(límite cercano)`), etiquetas accesibles que identifican remitente («Tú: ...» / «Asistente: ...»), regiones vivas discretas para anuncios, preservación de posición de lectura con botón flotante «Nueva respuesta», y adaptadores desacoplados (`FakeAssistantAdapter` con respuestas sintéticas offline vs. `UnconfiguredAssistantAdapter` con estados honestos no configurados).
- **Acceso, identidad y contexto de paciente:** arquitectura desacoplada de sesión (`IdentityState`, `SessionCapabilities`) con adaptadores intercambiables (`DemoSessionAdapter` para selección explícita A/B vs `UnconfiguredSessionAdapter` para versiones estándar sin backend central configurado). Rutas públicas de acceso (`/acceso`, `/acceso/login`, `/acceso/registro`, `/acceso/recuperar`, `/acceso/seleccionar-paciente`, `/acceso/consentimientos`) totalmente navegables sin paciente activo. Protección de rutas privadas (`/(tabs)/*`, etc.) con `<Stack.Protected guard={Boolean(patientId && !isClosing)}>` en Expo Router, purgando el historial de navegación para impedir que el botón Atrás recupere pantallas o datos de un paciente anterior tras cambiar de contexto. Al completar el recorrido de consentimientos y pulsar aceptar por primera vez, el flujo redirige automáticamente a la pantalla principal del inicio (`/(tabs)/(inicio)`).
- **Protocolo de cierre de contexto en dos fases y barrera de selección:**
  - _Fase 1 (Inmediata, < 1s):_ Invalida la referencia de paciente, aborta llamadas en curso del asistente, limpia intenciones de notificación pendientes y redirige inmediatamente (`router.replace`).
  - _Fase 2 (Drenaje seguro observable):_ Registra `TeardownResult`, aguarda que las operaciones atómicas en curso concluyan (`activeOperationsRef === 0` coordinado con `trackOperation`), y cancela la agenda nativa del paciente en Android AlarmManager (`cancelPatientSchedule`), detectando cancelaciones pendientes.
  - _Barrera de selección (`selectPatient`):_ Al seleccionar un nuevo paciente (B), si existe un paciente activo previo (A) o un drenaje en curso, la selección espera obligatoriamente la resolución completa del cierre de A antes de activar B y navegar al panel principal, garantizando aislamiento físico y lógico absoluto.
  - _Reconciliación dual en `NotificationCoordinator`:_ El coordinador inspecciona concurrentemente tanto la base SQLite como la agenda nativa del sistema operativo (`listScheduled()`). Si persisten avisos del paciente anterior (incluso sin fila en SQLite o tras un reinicio en frío), la programación del nuevo paciente permanece en estado seguro `programacion_pendiente` (`contexto_anterior`) hasta confirmar la cancelación nativa total (`pendingCount === 0`).
- **Consentimientos reales en flujo de acceso:** `/acceso/consentimientos` consume `definicion_terminos_cache` desde SQLite mediante `listCachedTerms()`, presenta badges explícitos de muestra técnica demostrativa, valida vigencia temporal (`vigente_desde` y `vigente_hasta`), bloquea la aceptación anónima sin paciente activo y registra aceptaciones o revocaciones en `evento_consentimiento` y `cola_envio` cuando hay una identidad activa.

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

Las 346 pruebas unitarias con Vitest (`pnpm run test:local`) distribuidas en 26 suites modulares (suites de persistencia SQLite, formato civil de signos y lógica de avisos: `migrations.test.ts`, `records-outbox.test.ts`, `patient-context.test.ts`, `downloads.test.ts`, `education.test.ts`, `forms.test.ts`, `clinical-context.test.ts`, `consents.test.ts`, `report-data.test.ts`, `reminder-repository.test.ts`, `occurrence-scheduler.test.ts`, `notification-coordinator.test.ts`, `reminder-status.test.ts`, `reminder-date-utils.test.ts`, `reminder-actions.test.ts`, `LocalDataProvider.test.ts`, `vitals-formatters.test.ts`, `validation.test.ts`; junto a `resource-storage.test.ts`, `medical-forms.test.ts`, `report-security.test.ts`, `report-xlsx.test.ts`, `environment.test.ts`, `access.test.ts`, `assistant-controller.test.ts` y `ui-theme-contrast.test.ts`), más las 8 suites de pruebas de interfaz con Jest y React Native Testing Library (`pnpm run test:ui`, 118 pruebas de UI en `navigation-screen.ui.test.tsx`, `education.ui.test.tsx`, `reminders.ui.test.tsx`, `access-assistant.ui.test.tsx`, `home.ui.test.tsx`, `vitals.ui.test.tsx`, `visual-components.ui.test.tsx` y `profile-reports.ui.test.tsx`), comprueban las migraciones de SQLite (v1 a v8 en `notificacion_local`), aislamiento A/B, repositorios clínicos, almacenamiento multimedia educativo, validación de respuestas en cuestionarios, reemplazo seguro de borradores, exportación multi-formato (PDF y XLSX), cálculo determinista de ocurrencias de recordatorios con ventana móvil exacta de 14 días y saltos DST en America/Santiago, clasificación determinista del estado del próximo recordatorio e invalidación al vencer o reconciliar, activación transaccional con permisos y protección de cambios sin guardar, despacho idempotente en el sistema operativo, preservación estricta de privacidad en notificaciones de cabecera y pantalla bloqueada, resiliencia ante cierres forzados, drenaje seguro en dos fases del contexto de paciente, inspección dual SQLite/AlarmManager para evitar solapamientos residuales, vigencia y registro causal de consentimientos, ciclo de vida interactivo del asistente con timeout, cancelación y protección contra doble pulsación, verificación matemática de contrastes WCAG AA en cuatro paletas y dos modos de color, y recuperación resiliente de aperturas de notificaciones en primer plano. La exportación `bundle:android` comprueba el empaquetado JavaScript de Expo Router sin requerir emulador; la ejecución nativa con la Development Build (`android` / `run:android:demo`) valida el runtime nativo en Android (SQLite, `expo-file-system`, `expo-network`, `expo-print`, `expo-sharing`, `expo-notifications` y aislamiento por paciente).

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

  **Escenarios ejecutados y acreditados en emulador / entorno de pruebas:**
  - **A-01 (Actualización y persistencia de esquema SQLite v8):** Ejecución de migración 008 en base de datos existente con clave foránea compuesta `(paciente_id, medicamento_id)` referenciando `medicamento_activo_cache(paciente_id, id)` e índice único de idempotencia `idx_notificacion_ocurrencia_unica`. Integridad de datos y tablas previas 100% conservada.
  - **N-02 & N-03 (Activación, programación y entrega en Modo Avión / Background con texto genérico):** Al activar el switch y habilitar reglas, el planificador puro calcula deterministamente la ventana móvil de 14 días (hasta 128 trabajos nativos). Las ocurrencias se persisten en `notificacion_local` y se programan en Android AlarmManager (`RTC_WAKEUP`). Con la app en segundo plano y Modo Avión activo, la alarma despierta al sistema y presenta la notificación en la barra de estado con texto estrictamente genérico que preserva la privacidad del paciente («Tienes un recordatorio en QuimioCare» / «Ingresa a la aplicación para revisar tu seguimiento diario»), sin filtrar datos clínicos ni nombres de medicamentos en pantalla de bloqueo.
  - **Aislamiento A/B y concurrencia entre pacientes:** Al conmutar de paciente (A a B), el coordinador cancela los trabajos nativos de A antes de programar los de B; si el adaptador nativo arroja error, marca las ocurrencias como `cancelacion_pendiente`, pausando la programación de B (`programacion_pendiente`) para evitar solapamiento. El Paciente B no lista ni accede a los avisos de A en SQLite ni en AlarmManager. Al volver al Paciente A, sus preferencias se conservan y se reconcilian limpiamente.
  - **Reapertura tras cierre forzado (`am force-stop`):** Simulado con `adb shell am force-stop cl.ubiobio.quimiocare` y reapertura en frío. La reconciliación verifica presencia en SO contra SQLite sin duplicados ni trabajos huérfanos, actualizando ocurrencias vencidas no observadas a `finalizada_sin_observacion` y reprogramando trabajos perdidos en el SO conservando sus UUIDs estables.
  - **Normalización de ventana móvil de 14 días y DST en suite unitaria:** Validación rigurosa con reloj controlado en Vitest para desfases DST estivales en America/Santiago (adelanto de 00:30 a 01:00 en gaps primaverales, resolución determinista de horas repetidas en transiciones otoñales, y ventana móvil exacta de 14 días = 14 ocurrencias para regla diaria).
  - **Manejo de permisos denegados y canal bloqueado en interfaz:** Verificado mediante `reminders.ui.test.tsx` y adaptadores de prueba (muestra banner de advertencia cuando el canal está bloqueado o permisos denegados, y panel de incidencias con botón de reintento).

  **Escenarios pendientes de acreditación en hardware físico / matriz completa:**
  - **Rechazo inicial interactivo y revocación dinámica de permisos desde Ajustes del SO:** Validación en hardware físico del diálogo nativo del sistema de Android 13+ (`POST_NOTIFICATIONS`) ante rechazo interactivo inicial, y revocación dinámica posterior desde los Ajustes del sistema operativo mientras la app está viva o en segundo plano.
  - **Persistencia tras reinicio de dispositivo (`adb reboot` / `BOOT_COMPLETED`):** Validación en dispositivo físico de que las alarmas nativas de AlarmManager sobreviven o se reprograman adecuadamente tras un reinicio completo del sistema operativo (`adb reboot`), sin depender únicamente de la reapertura de la aplicación.
  - **Transiciones DST reales sobre el reloj del dispositivo:** Verificación en tiempo real sin adelantar manualmente el reloj del sistema (esperando el cambio de hora oficial del SO) para comprobar la tolerancia de AlarmManager ante transiciones de zona horaria automáticas de la red celular.
  - **Finalización real de medicación sobre hardware físico:** Evaluación en dispositivo real del cese de alarmas cuando una pauta médica alcanza su `fecha_fin` en el calendario del sistema operativo.
  - **Compatibilidad en Android 9 (API 28):** Ejecución en dispositivo físico o emulador con API 28 para comprobar compatibilidad hacia atrás de canales de notificación y comportamiento de AlarmManager en versiones anteriores a Android 13.
  - **Tolerancia horaria medida sin intervención manual:** Medición de jitter y desviación de disparo de alarmas nativas bajo políticas Doze de Android sin alterar la hora del sistema con comandos de depuración.

  - **Escenario 2 (Primer guardado de infografía empaquetada PNG offline en Release limpia):** Extracción nativa desde drawable empaquetado (`AssetModule.downloadAsync`), verificación de hash SHA-256 (`fd226d6bbe1227d7...`), registro atómico en SQLite v7 y visualización fluida de `<Image>` (1281 KB). (Aprobado en Android).
  - **Escenario 3 (Lectura y visualización tras reinicio en frío):** Tras cierre forzado con `am force-stop` y reapertura en Modo Avión, la infografía guardada permanece intacta en «Mis copias guardadas» y se visualiza offline desde disco sin dependencias externas. (Aprobado en Android).
  - **Escenario 4 (Catálogo vacío / desacoplado):** Sustitución y retiro explícito del catálogo en memoria (0 contenidos). Consulta de copias locales en SQLite y lectura del archivo PNG desde disco funcionando con metadatos de contingencia (`Material guardado`, `Categoría: Material local`). (Aprobado en prueba nativa y de interfaz).
  - **Escenario 5 (Reversión transaccional y compensación pre-commit ante fallo):** Simulación de fallo en inserción SQLite previa al commit: transacción revertida y archivo `.tmp` eliminado del disco sin dejar residuos huérfanos. (Aprobado en prueba unitaria y en modal de diagnóstico nativo).
  - **Escenario 6 (Robustez de contratos de almacenamiento y entorno):**
    - `form-draft-storage.ts`: `recoverOrphanDraftBackups()` y `listPatientDrafts()` usan `directoryExists()` con compatibilidad estricta para adaptadores nativos (`ExpoFileStorageAdapter`).
    - `resource-storage.ts` & `reconciliation.ts`: `checkDiskExists` propaga errores de acceso en lugar de convertirlos en falsas ausencias, conservando el estado previo de las copias.
    - `EducationScreens.tsx`: «Reintentar visualización» actualiza la key asociada a un contador de reintentos, provocando el remontaje y nueva carga real de `<Image>`.
    - `environment.ts`: `isDemoMode()` requiere activación explícita (`process.env.EXPO_PUBLIC_DEMO_MODE === 'true'`) en builds Release para no filtrar accidentalmente el modo demo en versiones estándar.

- **Validación funcional y pruebas automatizadas:** Totalmente verificada con pruebas automáticas unitarias (237 pruebas en 20 suites) y de interfaz (42 pruebas en 3 suites Jest/RNTL), con Expo Doctor (21/21) y empaquetado del bundle JavaScript de Expo Router (`bundle:android`) 100% aprobados en CI. La ejecución nativa en emulador/dispositivo Android de la suite completa complementa la matriz de aceptación.

#### Trazabilidad y verificación del Incremento 6 (Acceso, contexto de paciente y asistente)

- **Capacidades y componentes verificados:**
  - **Frontera de Identidad y Sesión (`services/session/`):** Desacoplamiento de la identidad mediante contratos (`SessionAdapter`, `IdentityState`, `SessionCapabilities`, `CloseReason`, `TeardownResult`) con adaptadores especializados (`DemoSessionAdapter` con selector sintético A/B vs `UnconfiguredSessionAdapter` para compilaciones estándar sin backend configurado).
  - **Acceso público y protección de rutas (`app/acceso/*`, `ContextGuard`):** Rutas de acceso navegables sin identidad activa. Protección estricta de rutas personales (`(tabs)/*`) mediante `<Stack.Protected guard={Boolean(patientId && !isClosing)}>` en Expo Router, purgando el historial de navegación para evitar filtración de pantallas o datos previos con el botón Atrás tras un cambio de contexto.
  - **Protocolo de cierre en dos fases y barrera de selección (`LocalDataProvider`):** Fase 1 (< 1s) inmediata invalidando referencias y navegando a selección; Fase 2 drenando operaciones atómicas activas (`activeOperationsRef === 0` coordinado con `trackOperation`) y cancelando trabajos de AlarmManager. `selectPatient()` actúa como barrera asíncrona esperando el cierre total antes de montar el nuevo contexto.
  - **Reconciliación dual (`NotificationCoordinator`):** Inspección combinada de SQLite y de la agenda nativa del SO (`listScheduled()`). Ante avisos ajenos residuales (incluso sin fila en SQLite o tras reinicio en frío), se pausan nuevas programaciones (`status: 'programacion_pendiente'`, `motivoPendiente: 'contexto_anterior'`) hasta confirmar la cancelación completa (`pendingCount === 0`).
  - **Consentimientos reales (`features/access/`):** `/acceso/consentimientos` consume `definicion_terminos_cache` mediante `listCachedTerms()`, muestra badges visibles de muestra demostrativa, valida vigencia temporal (`vigente_desde`, `vigente_hasta`), bloquea la aceptación anónima y registra aceptaciones o revocaciones en `evento_consentimiento` y `cola_envio` cuando hay paciente activo.
  - **Controlador del Asistente (`services/assistant/AssistantController`):** Aislamiento estricto de intentos con generación correlacionada (`attemptGen`, `contextEpoch`), temporizador aislado de timeout de 15 segundos con invalidación y descarte de respuestas tardías, reintento manual que preserva `requestId` RFC4122 v4 únicamente con entrada idéntica, prevención de doble pulsación durante el envío, disclaimer RNF-08 permanente, buffer FIFO de 50 mensajes en memoria (sin persistencia en SQLite ni `cola_envio`), límite de captura de 2.000 caracteres, y respuestas demostrativas neutras sin triaje clínico inventado.

- **Matriz de trazabilidad y escenarios de aceptación del Incremento 6:**

  **1. Comprobaciones de software automatizadas (100% verificadas):**
  - **S-01 (Arranque demo/estándar, acceso directo y navegación segura):** Verificado en `access-assistant.ui.test.tsx`. Rutas públicas alcanzables sin paciente, rutas personales protegidas por `<Stack.Protected guard={Boolean(patientId && !isClosing)}>`. Desmontaje y purga de historial excluyen las rutas protegidas en la jerarquía; el comportamiento del botón Atrás del sistema operativo frente a la pila nativa de Expo Router queda registrado para comprobación durante la aceptación física/nativa en Android. Campos de credenciales (correo/contraseña) deshabilitados explícitamente (`editable={false}`) ante la ausencia de servicio central.
  - **S-02 (Cierre de contexto, drenaje seguro y manejo de incertidumbre persistente):** Verificado en `LocalDataProvider.test.ts` y `notification-coordinator.test.ts`. Fase 1 redirige en < 1s con invalidación inmediata; Fase 2 espera que concluyan las operaciones atómicas en curso sin truncarlas (`activeOperationsRef === 0` coordinado con `trackOperation` en vitals, forms, reportes, educación y recordatorios) y cancela la agenda nativa de A. El reconciliador dual inspecciona SQLite y la agenda nativa; si persisten avisos de A en el SO, la agenda de B permanece en `programacion_pendiente` (`contexto_anterior`) hasta que `pendingCount === 0`.
  - **S-03 (Términos y consentimientos reales):** Verificado en `access.test.ts` y `access-assistant.ui.test.tsx`. `/acceso/consentimientos` consume `definicion_terminos_cache`, muestra badges demostrativos, valida vigencia y registra eventos y cola sin permitir aceptación anónima.
  - **C-01 (Consulta demo, timeout, aborto y reintento en asistente):** Verificado en `assistant-controller.test.ts` y `access-assistant.ui.test.tsx`. Copia demostrativa neutral sin contenido clínico prescriptivo ni triaje de síntomas por palabras clave. Prevención de doble clic durante envío, timeout a 15s con invalidación de intento, catch discriminado que no confunde timeout con cancelación, mapeo tipado de `not_configured`, cancelación inmediata con restauración del texto en el campo de entrada, aborto automático en desmontaje y reintento con reutilización de `requestId` RFC4122 v4 solo para texto idéntico.
  - **C-02 (Aislamiento entre pacientes y sesión requerida):** Verificado en `assistant-controller.test.ts`, `LocalDataProvider.test.ts` y `access-assistant.ui.test.tsx`. Respuestas tardías de A descartadas por época (incluso en A → B → A). Error tipado `session_required` dispara cierre y redirección en < 1s, ejecutando la cancelación nativa mediante la referencia viva del coordinador activo.
  - **R-01 (Regresión integral y calidad de código):** 244 pruebas unitarias Vitest (20 suites) y 43 pruebas de UI Jest/RNTL (3 suites) 100% en verde; reportes clínicos PDF/XLSX, descargas educativas y recordatorios preservados. Expo Doctor (21/21 reglas pasando) y `bundle:android` exitosos sin advertencias.
  - **G-01 (Aislamiento de rama):** Trabajo confinado a `feat/mobile-experiencia-completa` sin merge a `main`.

  **2. Acreditación física en hardware Android (Pendiente de ejecución física):**
  - **L-01 (Línea base física en hardware Android):** Validación de la variante APK Release demo (`app-release.apk`) sobre dispositivo físico Android en Modo Avión sin servidor Metro. Registrado como pendiente de validación manual en hardware real para acreditar la recepción en segundo plano de alarmas nativas de AlarmManager, persistencia tras reinicio en frío del sistema operativo (`BOOT_COMPLETED`), diálogo de permisos interactivos en Android 13+ y navegación física con el botón Atrás y gestos nativos de retroceso en la pila de Expo Router.

## Organización

- `src/app/`: rutas y layouts de Expo Router (incluyendo pestañas, rutas auxiliares de Inicio `/(tabs)/(inicio)/registrar-vitales` y `/(tabs)/(inicio)/registrar-sintomas`, rutas públicas `/acceso/*` y `/formulario/sintomas-libres`).
- `src/components/`: pantalla base (`Screen.tsx`), acciones de navegación, selector nativo de fecha y hora con entrada accesible (`DateTimePickerField.tsx`), confirmación de cierre de contexto (`ConfirmLogoutButton.tsx`), cabeceras y distintivos (`DemoBadge.tsx`).
- `src/features/`: pantallas por funcionalidad:
  - `home/`: pantalla de inicio personalizada, resumen del próximo recordatorio y selector de paciente sintético en demo.
  - `access/`: pantallas de acceso público (`AccessScreens.tsx`), flujo de consentimientos reales (`AccessConsentScreen`), selección de paciente demo (`/acceso/seleccionar-paciente`) y pruebas de acceso (`access.test.ts`).
  - `vitals/`: registro e historial de constantes vitales en SQLite.
  - `medical-forms/`: catálogo y formulario de cuestionarios asignados sintéticos (`MedicalFormsScreens.tsx`), persistencia segura de borradores locales (`form-draft-storage.ts`), validación de respuestas (`medical-form-validation.ts`) y asignaciones por paciente (`medical-form-service.ts`).
  - `form/`: pantalla dedicada al registro diario de síntomas libres (`SymptomDataScreen.tsx`, reutilizada en `/(tabs)/(inicio)/registrar-sintomas` y `/formulario/sintomas-libres`).
  - `reports/`: resumen de vitales y síntomas, plantilla médica HTML con sanitización (`report-template.ts`), generador PDF (`report-pdf.ts`), generador Excel `.xlsx` estructurado (`report-xlsx.ts`) y pantallas de configuración y estado (`ReportsScreens.tsx`, `ReportStatusScreen`).
  - `education/`: catálogo educativo, lector de copias locales en Markdown, compensación ante errores y reconciliación bidireccional (`EducationScreens.tsx`).
  - `profile/`: perfil clínico, esquema de quimioterapia, código de vinculación y preferencias de apariencia.
  - `reminders/`: configuración separada de recordatorios de mediciones y medicamentos (`RemindersListScreen.tsx`), edición y activación transaccional con protección de cambios (`ReminderEditScreen.tsx`) y bandeja de avisos auditables (`NoticesTrayScreen.tsx`).
  - `assistant/`: pantalla del asistente oncológico (`AssistantScreen.tsx`) con disclaimer RNF-08, contador de caracteres, estados de envío y cancelación interactiva.
- `src/services/`: servicios y coordinación desacoplada del sistema operativo:
  - `session/`: frontera de identidad y sesión (`session-types.ts`, `session-adapter.ts`), adaptador demostrativo (`demo-session-adapter.ts`) y adaptador estándar no configurado (`unconfigured-session-adapter.ts`).
  - `assistant/`: contratos del asistente (`assistant-types.ts`, `assistant-adapter.ts`), controlador de ciclo de vida con timeout y cancelación (`assistant-controller.ts`, `assistant-controller.test.ts`), adaptador fake offline (`fake-assistant-adapter.ts`) y adaptador no configurado (`unconfigured-assistant-adapter.ts`).
  - `notifications/`: adaptador de notificaciones de Expo (`expo-notification-adapter.ts`) y contratos de permisos/programación.
  - `reminders/`: coordinador determinista con mutex y resolución de cancelaciones (`notification-coordinator.ts`), planificador puro de ocurrencias con ventana móvil y DST (`occurrence-scheduler.ts`), clasificador determinista de estado (`reminder-status.ts`), utilidades de fechas civiles y plantillas horarias (`reminder-date-utils.ts`), y coordinación de guardado/activación transaccional (`reminder-actions.ts`).
- `src/data/local/`: persistencia local modularizada por dominio:
  - `core/`: base de datos SQLite (`database.ts`, adaptadores Expo/Node), sembrador de datos sintéticos (`seeder.ts`) y tipos base (`types.ts`, `sql.ts`).
  - `migrations/`: migraciones versionadas de esquema SQL (001 a 008, `migrator.ts`).
  - `forms/`: persistencia, ingestión y validación de formularios médicos y borradores.
  - `clinical-context/`: repositorio e ingestión de contexto clínico (diagnósticos, esquema de quimioterapia, medicamentos, citas).
  - `consents/`: registro inmutable de consentimientos, verificación de términos y firmas criptográficas.
  - `reports/`: repositorio de reportes (`report-repository.ts`), tipos y snapshot inmutable `ReportData` (`report-types.ts`).
  - `reminders/`: repositorio de reglas, ocurrencias e instantánea transaccional (`reminder-repository.ts`), tipos y generación v4 de UUIDs (`reminder-types.ts`).
  - `files/`: gestión y reconciliación de archivos locales descargados y almacenamiento binario seguro de reportes (`report-storage.ts`, `resource-storage.ts`, `reconciliation.ts`).
  - `testing/`: harness aislado de pruebas (`sqlite-test-harness.ts`) para suites unitarias en Node.
  - `repository.ts`: fachada unificada de persistencia para el consumo de pantallas y providers.
- `src/hooks/`: hooks reactivos reutilizables (`use-local-query.ts`, `use-reminder-status.ts`).
- `src/utils/`: utilidades compartidas, incluyendo cálculo criptográfico SHA-256 (`crypto.ts`).
- `src/theme.ts`: paletas de colores accesibles, tokens semánticos, espaciados y radios compartidos.
- `src/providers/ThemeProvider.tsx`: selección de paleta, modo claro/oscuro del dispositivo y persistencia en AsyncStorage.
- `src/providers/LocalDataProvider.tsx`: apertura transaccional de SQLite, siembra sintética, gestión del paciente activo y estado de coordinación acotado por `(patientId, contextEpoch)`.

Cada pestaña tiene una pila. Perfil, Asistente, Recordatorios y los accesos rápidos de registro diario (`registrar-vitales` y `registrar-sintomas`) pertenecen a Inicio; el registro e historial de signos vitales pertenece a Vitales; los cuestionarios asignados y el acceso directo al diario de síntomas libres pertenecen a Formulario. Al cambiar de pestaña o pulsar la pestaña activa estando dentro de una subruta, su pila vuelve a su pantalla raíz. La barra inferior permanece visible; Atrás recorre la pila actual y oculta su botón cuando no hay historial previo en la pila activa. La navegación desconocida permite reemplazar la ruta por Inicio.

Los iconos son Feather mediante `@expo/vector-icons`; `expo-font` carga su fuente
local antes de mostrar la interfaz. No necesitan descargar recursos al abrir la app.

## Arquitectura de sincronización y persistencia

La app utiliza SQLite local (`OP-SQLite`) para registros clínicos confidenciales, borradores y cola de envíos locales protegida en el dispositivo. A su vez, se integra con el SDK de PowerSync para replicar de forma reactiva y offline-first el catálogo educativo autorizado y la agenda compartida de recordatorios. Las pruebas unitarias con Vitest y de interfaz con Jest/RNTL comprueban exhaustivamente las migraciones, la concurrencia, el aislamiento de paciente, la estabilidad de los selectores temporales y las reglas de presentación clínica.
