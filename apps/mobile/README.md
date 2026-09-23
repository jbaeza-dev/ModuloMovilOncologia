# @modulo-movil-oncologia/mobile

Base Android de **QuimioCare**, nombre provisional del módulo de acompañamiento para pacientes en quimioterapia. React Native + Expo + TypeScript + Expo Router.

## Estado actual

El PR lógico 9 (SCRUM-25) incorpora navegación sobre la base Expo del PR5 (SCRUM-26).
Hay cuatro pestañas: Inicio, Vitales, Formulario y Educación. Inicio ofrece accesos a
registro de signos vitales, síntomas, perfil y asistente. Perfil contiene los accesos
a información clínica, vinculación y preferencias.

Los destinos marcados **Próximamente** son pantallas mínimas de navegación. No se
recogen ni almacenan datos de pacientes. La apertura directa en Inicio es temporal:
no demuestra autenticación ni constituye una sesión de paciente.

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
- `src/theme.ts`: colores monocromáticos, espacios y radios compartidos.

Cada pestaña tiene una pila. Perfil y Asistente pertenecen a Inicio; el registro de
signos vitales pertenece a Vitales. `router.navigate` evita apilar reiteradamente el
mismo destino y `withAnchor` conserva la raíz de la pila al entrar en una ruta interna.
La barra inferior permanece visible; Atrás recorre la pila y luego vuelve a Inicio.
La navegación desconocida permite reemplazar la ruta por Inicio.

Los iconos son Feather mediante `@expo/vector-icons`; `expo-font` carga su fuente
local antes de mostrar la interfaz. No necesitan descargar recursos al abrir la app.

## Arquitectura prevista

Las pantallas clínicas completas se incorporan desde PR10. Consumirán hooks y
repositorios; SQLite integrada con PowerSync será la fuente de datos replicados.
`uploadData()` enviará escrituras a la API clínica o su simulador directamente.
El gateway se reserva para chat y sesiones/dispositivos. No hay clientes HTTP,
bases de datos ni contratos clínicos en esta navegación.

Las futuras pruebas de componentes nativos usarán herramientas compatibles con
Expo y React Native. La skill Vitest queda para contratos y lógica TypeScript
independiente; instalarla como dependencia no es necesario para este PR.
