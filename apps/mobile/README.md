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

El benchmark automatizado en Node (`report-data.test.ts`) evalúa exclusivamente la extracción de base de datos SQLite y construcción en memoria de `ReportData`. La acreditación formal del requerimiento no funcional **RNF-06** (generación y persistencia de reportes clínicos en menos de 3 segundos sobre hardware móvil de gama media/baja) y la verificación funcional de la experiencia nativa se ejecutan de manera diferenciada siguiendo el protocolo aprobado para el commit inmutable **`0360dfb`**.

#### Precisiones metodológicas del protocolo

1. **Delimitación de la ventana de medición temporal:** El cronómetro inicia en el instante exacto en que el usuario confirma la acción («Generar y compartir» en la interfaz móvil) —abarcando la consulta transaccional SQLite sobre `tx` y el cálculo del snapshot en memoria `ReportData`— hasta recibir el resultado del archivo binario final persistido en almacenamiento privado (`persistReportFile`), **antes** de abrir la hoja de compartir del sistema (`expo-sharing`).
2. **Estructura de muestreo (fría vs. calientes):** Se registran 5 ejecuciones consecutivas por formato (PDF y XLSX), identificando la primera medición como fría (_cold start_ de compilación de plantillas y caches de I/O) y las cuatro siguientes como calientes (_warm_). La medición fría se conserva íntegramente en el informe; el promedio de las calientes se calcula por separado, pero la medición fría no se descarta.
3. **Criterio estricto de acreditación (no solo promedio):** Para acreditar RNF-06 no basta un promedio menor a 3 segundos; se reportan los 5 tiempos individuales y se exige que el **tiempo máximo absoluto** satisfaga `max < 3.000 ms` (< 3,00 s) para un volumen representativo de prueba (500 signos vitales y 500 síntomas en 90 días).
4. **Separación de entornos y trazabilidad de compilación:**
   - **Validación funcional (Escenarios 1 al 6):** Emulador Android AVD `Dispositivo_Liviano` (Android 14 / API 34).
   - **Rendimiento RNF-06:** Teléfono físico de referencia en variante Release (`app-release.apk`, SHA inmutable `0360dfb`), ejecutado en Modo Avión sin servidor Metro ni depuración interactiva.
5. **Expectativas ajustadas del visor y formato:**
   - **PDF:** La plantilla médica HTML contiene un **único pie institucional al final del documento** (no repetido por página). La aplicación no abre automáticamente un visor interno, sino la **hoja de compartir nativa del sistema**, desde la que el usuario selecciona una aplicación compatible. La revisión multipágina comprueba legibilidad tipográfica, integridad de los datos y ausencia de recortes de filas gracias a reglas CSS de salto limpio (`page-break-inside: avoid`).
   - **XLSX:** Apertura vía hoja de compartir en visores de hoja de cálculo del sistema (Microsoft Excel, Google Sheets o LibreOffice). Se valida la presencia de 3 hojas estructuradas (`Resumen`, `Signos vitales`, `Sintomas`), identificadores de registro, fechas locales y ausencia de texto `'—'` en celdas numéricas vacías, garantizando preservación literal sin inyecciones de fórmulas.
6. **Aislamiento A/B verificado en la aplicación:** Al conmutar entre el Paciente A y el Paciente B, la interfaz de usuario aísla estrictamente el catálogo y listado de reportes: **el Paciente B no lista ni accede a los reportes del Paciente A**. La verificación del sistema de archivos privado (`reportes_locales/{paciente_id}/`) aporta evidencia técnica complementaria.
7. **Resiliencia y cancelación:** Si el usuario cancela o descarta la hoja de compartir nativa, el archivo del reporte permanece intacto y confirmado en el almacenamiento local. Tras un cierre forzado (`am force-stop`), los reportes confirmados sobreviven y los archivos temporales huérfanos (`.tmp_reporte_*`) se depuran automáticamente al iniciar operaciones bajo el bloqueo del paciente.

#### Estado de acreditación

- **Medición RNF-06 en hardware físico:** Pendiente de acreditación formal sobre dispositivo físico de referencia conectado por USB / modo autónomo. El protocolo metodológico queda fijado y listo para registrar las 5 mediciones individuales (1 fría y 4 calientes) cuando se disponga de dicho hardware.
- **Validación funcional en Android:** Definida según los escenarios del protocolo y lista para su ejecución y captura de evidencias reales en AVD / dispositivo físico. Las pruebas automáticas unitarias (150 pruebas en 12 suites) y la compilación/empaquetado en CI se mantienen 100% verificadas.

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
