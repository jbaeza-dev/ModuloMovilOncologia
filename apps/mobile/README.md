# @modulo-movil-oncologia/mobile

Aplicación Android **QuimioCare** para acompañamiento de pacientes en quimioterapia, desarrollada con React Native, Expo, TypeScript y Expo Router.

## Estado actual

La aplicación contiene la base Expo, la navegación principal y la consolidación de la experiencia demostrativa local para Sprint 1 mediante datos sintéticos. Se organiza en cuatro pestañas principales con navegación por pilas independientes:

- **Inicio:** resumen del paciente activo, acceso directo al diario de síntomas libres (`/formulario/sintomas-libres`), cambio dinámico entre pacientes de prueba A/B y distintivo de demostración sintética (`DemoBadge`).
- **Vitales:** registro de constantes vitales en SQLite local con operaciones en cola y generación/exportación de reportes PDF locales (`expo-print` y `expo-sharing`) con resumen calculado de mediciones (7, 30 y 90 días) almacenados en `reportes_locales/{paciente_id}/` con nombres auditables `reporte_{dias}d_{timestamp}.pdf`, sanitización HTML de entradas y pantalla de estado con apertura de hoja nativa de compartir.
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

Las 69 pruebas unitarias con Vitest (`pnpm run test:local`) distribuidas en 4 suites (`node-sqlite.test.ts`, `resource-storage.test.ts`, `medical-forms.test.ts`, `report-security.test.ts`) comprueban las migraciones de SQLite, aislamiento A/B, repositorios clínicos, compensación ante fallos de base de datos, validación de respuestas en cuestionarios, reemplazo seguro de borradores, sanitización de reportes locales y lógica de reconciliación bidireccional en Node. La exportación `bundle:android` comprueba el empaquetado JavaScript de Expo Router sin requerir emulador; la ejecución nativa con la Development Build (`android` / `run:android:demo`) valida el runtime nativo en Android (SQLite, `expo-file-system`, `expo-print`, `expo-sharing` y aislamiento por paciente). QuimioCare utiliza su propia Development Build en lugar de Expo Go para dar soporte completo a módulos nativos presentes y futuros (como PowerSync).

## Organización

- `src/app/`: rutas y layouts de Expo Router (incluyendo pestañas, rutas auxiliares y `/formulario/sintomas-libres`).
- `src/components/`: pantalla base, acciones de navegación, cabeceras y distintivos (`DemoBadge.tsx`).
- `src/features/`: pantallas por funcionalidad:
  - `home/`: pantalla de inicio y selector de paciente sintético en demo.
  - `vitals/`: registro e historial de constantes vitales en SQLite.
  - `medical-forms/`: catálogo y formulario de cuestionarios asignados sintéticos (`MedicalFormsScreens.tsx`), persistencia segura de borradores locales (`form-draft-storage.ts`), validación de respuestas (`medical-form-validation.ts`) y asignaciones por paciente (`medical-form-service.ts`).
  - `form/`: pantalla dedicada al registro diario de síntomas libres (`SymptomDataScreen.tsx`, ruta `/formulario/sintomas-libres`).
  - `reports/`: resumen de vitales, plantilla médica HTML con sanitización, generación/exportación de reportes PDF locales (`report-pdf.ts`, `report-template.ts`) y pantalla de estado (`ReportStatusScreen`).
  - `education/`: catálogo educativo, lector de copias locales en Markdown, compensación ante errores y reconciliación bidireccional (`EducationScreens.tsx`).
  - `profile/`: perfil clínico, esquema de quimioterapia, código de vinculación y preferencias de apariencia.
  - `assistant/`: prototipo visual del asistente oncológico.
- `src/data/local/`: migraciones versionadas de SQLite, repositorios, almacenamiento de recursos y módulo de reconciliación de archivos (`reconciliation.ts`).
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
