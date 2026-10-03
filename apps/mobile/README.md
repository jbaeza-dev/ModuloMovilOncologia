# @modulo-movil-oncologia/mobile

Aplicación Android **QuimioCare** para acompañamiento de pacientes en quimioterapia, desarrollada con React Native, Expo, TypeScript y Expo Router.

## Estado actual

La aplicación contiene la base Expo (PR5/SCRUM-26), la navegación principal (PR9/SCRUM-25), las pantallas visuales de PR10–PR13 y la persistencia local de SCRUM-19 y SCRUM-20. Tiene cuatro pestañas: Inicio, Vitales, Formulario y Educación. Inicio, Vitales, Formulario y Educación muestran registros, contexto y descargas locales del paciente de prueba activo; Asistente y Reportes continúan como demostración técnica.

Durante desarrollo se selecciona explícitamente el paciente sintético A o B. Signos vitales, síntomas, contexto del paciente (perfil, tratamiento, código de vinculación) y descargas educativas se guardan en `quimiocare_local.db` y en el sistema de archivos del dispositivo (`expo-file-system`), sobreviven al reinicio y se aíslan físicamente por paciente en `recursos_educativos/{paciente_id}/{contenido_id}.md`. Cada alta clínica crea una operación `pendiente` en la misma transacción. No hay autenticación con servidor, envío REST, sincronización remota ni evaluación clínica. La galería conserva las variantes visuales antiguas con datos ficticios.

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
4. Guardar recursos educativos sin red, verificar su lectura en Markdown, cerrar la aplicación forzosamente (`adb shell am force-stop cl.ubiobio.quimiocare`) y reabrirla para comprobar que la persistencia en SQLite y el aislamiento físico por paciente se mantienen intactos.

## Comprobaciones

Desde la raíz:

```bash
pnpm check
pnpm run test:local
pnpm --filter @modulo-movil-oncologia/mobile run doctor
pnpm --filter @modulo-movil-oncologia/mobile bundle:android
```

La exportación `bundle:android` comprueba el empaquetado JavaScript de Expo Router sin requerir emulador; la ejecución nativa con la Development Build (`android` / `run:android:demo`) valida el runtime nativo en Android (SQLite, sistema de archivos y aislamiento). QuimioCare utiliza su propia Development Build en lugar de Expo Go para dar soporte completo a módulos nativos presentes y futuros (como PowerSync).

## Organización

- `src/app/`: rutas y layouts de Expo Router.
- `src/components/`: pantalla base, acciones de navegación y destinos mínimos.
- `src/features/`: pantallas por funcionalidad.
- `src/data/local/`: migración versionada, validación, repositorios y adaptador de `expo-sqlite`.
- `src/theme.ts`: paletas, tokens semánticos, espacios y radios compartidos.
- `src/providers/ThemeProvider.tsx`: selección de paleta, modo claro/oscuro del dispositivo y persistencia local de la preferencia.
- `src/providers/LocalDataProvider.tsx`: apertura de SQLite y selección de paciente sintético en desarrollo.

Cada pestaña tiene una pila. Perfil y Asistente pertenecen a Inicio; el registro de
signos vitales pertenece a Vitales. `router.navigate` evita apilar reiteradamente el
mismo destino y `withAnchor` conserva la raíz de la pila al entrar en una ruta interna.
La barra inferior permanece visible; Atrás recorre la pila y luego vuelve a Inicio.
La navegación desconocida permite reemplazar la ruta por Inicio.

Los iconos son Feather mediante `@expo/vector-icons`; `expo-font` carga su fuente
local antes de mostrar la interfaz. No necesitan descargar recursos al abrir la app.

## Arquitectura prevista

La app usa su propio SQLite para registros y cola local; PowerSync administrará otra base para el catálogo educativo cuando se implemente. El contrato v0 sigue en revisión y esta rama no incluye cliente HTTP ni worker de envío. Las pruebas con Vitest ejercitan migraciones y repositorios sobre SQLite real en Node; el recorrido en Android valida el adaptador nativo por separado.

Las futuras pruebas de componentes nativos usarán herramientas compatibles con
Expo y React Native.
