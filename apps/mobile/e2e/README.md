# Pruebas de extremo a extremo (Android)

Flujos de [Maestro](https://maestro.mobile.dev) que manejan la app real en un teléfono Android:
tocan botones, escriben y comprueban lo que aparece en pantalla, como lo haría una persona.
Complementan a Vitest (lógica y SQLite) y Jest (pantallas aisladas): aquí corre el APK completo,
con su base cifrada, la sincronización y la navegación de Expo Router.

## Flujos

| Archivo                                 | Qué comprueba                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| `flows/01-navegacion.yaml`              | Las cuatro pestañas abren y muestran su contenido principal.                    |
| `flows/02-validacion-signos.yaml`       | Temperatura fuera de rango y dolor ENA vacío muestran sus errores; no guarda.   |
| `flows/03-graficas-signos.yaml`         | Cambio de periodo (7, 30, 90 días) y de gráfica en el historial de signos.      |
| `flows/04-educacion.yaml`               | Filtros del material educativo y apertura de una categoría CUIDAQUIMIO.         |
| `flows/05-recordatorios.yaml`           | Enlace profundo `quimiocare://recordatorios` y regreso al inicio.               |
| `flows/06-perfil-cancelar-cierre.yaml`  | El diálogo «¿Cerrar sesión?» se cancela y la sesión sigue abierta.              |
| `flows/07-guardar-y-enviar-signos.yaml` | Guarda un signo vital sintético y espera «Enviado al Médico» y cero pendientes. |

`subflows/abrir-inicio.yaml` reinicia la app sin borrar sus datos y espera la pestaña Inicio.
Los flujos 01 a 06 no guardan datos clínicos, no cambian permisos ni cierran la sesión, así que se
pueden correr sobre la cuenta de prueba del proyecto sin dejar rastros.

El flujo 07 sí **guarda un registro** de signos vitales en la cuenta en uso (36,7 °C, 118/76 mmHg,
saturación 97 %, dolor 1 y un pulso al azar entre 60 y 89 para reconocerlo en el historial). Son
datos de prueba dentro de los rangos que acepta la app, no umbrales clínicos. Por eso lleva la
etiqueta `guarda-datos`, la suite normal lo excluye (`config.yaml`) y se corre aparte:

```bash
pnpm run test:e2e:envio
```

«Enviado al Médico» solo aparece cuando el servidor confirmó la recepción, así que el flujo
comprueba el guardado local, la subida y el acuse. No revisa la base del servidor.

## Requisitos

1. Java 17 y Maestro CLI (`curl -fsSL "https://get.maestro.mobile.dev" | bash`; en Windows,
   descomprimir la versión publicada y agregar `maestro/bin` al `PATH`).
2. Teléfono con depuración USB y la app instalada (APK `universidad-demo` de CI) con una sesión
   iniciada. El inicio de sesión con Google no se automatiza: lo hace una persona una vez.
3. En Xiaomi/HyperOS, activar «Instalar vía USB» en Opciones de desarrollador (Maestro instala su
   controlador la primera vez).

## Ejecutar

Desde `apps/mobile`:

```bash
pnpm run test:e2e
```

Para guardar evidencia (capturas, jerarquía de pantalla y reporte JUnit):

```bash
maestro test e2e --format junit --output e2e-resultado.xml --test-output-dir e2e-evidencia
```

No se ejecutan en CI porque necesitan un teléfono o emulador con sesión iniciada, y un emulador en
GitHub Actions consume muchos minutos del plan.

## Notas

- La app se abre con `openLink: quimiocare://` y no con `launchApp`: HyperOS bloquea que el
  controlador de Maestro inicie actividades desde segundo plano, y `openLink` usa `am start` por
  adb. Además, `launchApp` concede todos los permisos y alteraría las pruebas de avisos.
- No usar `uiautomator dump` ni otra herramienta de accesibilidad mientras corre Maestro: Android
  permite una sola a la vez y el servidor de Maestro se cae.
- El primer arranque en frío puede quedar varios segundos en «Preparando tu espacio…» mientras
  abre la base cifrada; por eso el subflujo espera hasta 60 s.

## Resultado

17-11-2026, Redmi 13C 5G (Android 14, HyperOS 1.0), APK de `main` b2228f4: **6 de 6 flujos
aprobados** en 3 min 36 s.

26-11-2026, mismo teléfono, APK de `main` 96ef4d0 y cuenta vinculada: **6 de 6 flujos** de la
suite normal en 3 min 5 s, y el flujo 07 aprobado por separado (el signo quedó «Enviado al Médico»
y sin pendientes). En el primer intento el flujo 07 esperaba el historial tras guardar, pero la app
vuelve a Inicio; se corrigió la espera y ese intento dejó un registro sintético más en la cuenta.
