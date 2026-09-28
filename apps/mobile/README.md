# @modulo-movil-oncologia/mobile

Aplicación Android **QuimioCare** para acompañamiento de pacientes en quimioterapia, desarrollada con React Native, Expo, TypeScript y Expo Router.

## Estado actual

La rama actual contiene la base Expo (PR5/SCRUM-26), la navegación principal (PR9/SCRUM-25) y la implementación visual de las pantallas del Sprint 1 (alcance visual de PR10–PR13). La aplicación ofrece cuatro pestañas: Inicio, Vitales, Formulario y Educación. Desde ellas se puede recorrer Perfil, acceso, vinculación, formularios y resultados de demostración, recursos educativos, Asistente y Reportes.

El contenido clínico que se muestra es ficticio y sirve para revisar la interfaz. No se autentica a usuarios, no se guardan registros clínicos, no se evalúan síntomas ni signos vitales y no se envían datos. Los estados de carga, error y conectividad son presentacionales. Las operaciones reales y los requisitos funcionales de PR10–PR13 siguen pendientes.

En Perfil → Preferencias → Accesibilidad y apariencia, se puede seleccionar Turquesa, Azul, Violeta o Ámbar. El modo claro u oscuro sigue el ajuste del dispositivo y la paleta elegida se guarda localmente con AsyncStorage. Alertas y estados clínicos mantienen colores semánticos independientes de la paleta.

## Desarrollo local

Usar Node.js y pnpm en las versiones fijadas en la raíz. Mantener un único lockfile.

```bash
pnpm install --frozen-lockfile
pnpm --filter @modulo-movil-oncologia/mobile start
pnpm --filter @modulo-movil-oncologia/mobile android
```

## Comprobaciones

Desde la raíz:

```bash
pnpm check
pnpm --filter @modulo-movil-oncologia/mobile run doctor
pnpm --filter @modulo-movil-oncologia/mobile bundle:android
```

La exportación comprueba el empaquetado Android; no sustituye probar la app en un
dispositivo o emulador. Expo Go sirve para esta navegación, pero no acredita la
integración futura de PowerSync.

## Organización

- `src/app/`: rutas y layouts de Expo Router.
- `src/components/`: pantalla base, acciones de navegación y destinos mínimos.
- `src/features/`: pantallas por funcionalidad.
- `src/theme.ts`: paletas, tokens semánticos, espacios y radios compartidos.
- `src/providers/ThemeProvider.tsx`: selección de paleta, modo claro/oscuro del dispositivo y persistencia local de la preferencia.

Cada pestaña tiene una pila. Perfil y Asistente pertenecen a Inicio; el registro de
signos vitales pertenece a Vitales. `router.navigate` evita apilar reiteradamente el
mismo destino y `withAnchor` conserva la raíz de la pila al entrar en una ruta interna.
La barra inferior permanece visible; Atrás recorre la pila y luego vuelve a Inicio.
La navegación desconocida permite reemplazar la ruta por Inicio.

Los iconos son Feather mediante `@expo/vector-icons`; `expo-font` carga su fuente
local antes de mostrar la interfaz. No necesitan descargar recursos al abrir la app.

## Arquitectura prevista

La arquitectura futura contempla hooks y repositorios, SQLite con PowerSync y servicios para las operaciones clínicas. La ruta de escritura y sincronización debe resolverse como decisión explícita del proyecto antes de implementarla. El gateway y el simulador también pertenecen a entregas posteriores. La interfaz actual no incluye clientes HTTP, base de datos ni contratos clínicos.

Las futuras pruebas de componentes nativos usarán herramientas compatibles con
Expo y React Native.
