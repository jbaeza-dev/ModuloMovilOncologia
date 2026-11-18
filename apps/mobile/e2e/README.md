# Pruebas de extremo a extremo (Android)

Flujos de [Maestro](https://maestro.mobile.dev) que manejan la app real en un teléfono Android:
tocan botones, escriben y comprueban lo que aparece en pantalla, como lo haría una persona.
Complementan a Vitest (lógica y SQLite) y Jest (pantallas aisladas): aquí corre el APK completo,
con su base cifrada, la sincronización y la navegación de Expo Router.

## Flujos

| Archivo                                | Qué comprueba                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `flows/01-navegacion.yaml`             | Las cuatro pestañas abren y muestran su contenido principal.                  |
| `flows/02-validacion-signos.yaml`      | Temperatura fuera de rango y dolor ENA vacío muestran sus errores; no guarda. |
| `flows/03-graficas-signos.yaml`        | Cambio de periodo (7, 30, 90 días) y de gráfica en el historial de signos.    |
| `flows/04-educacion.yaml`              | Filtros del material educativo y apertura de una categoría CUIDAQUIMIO.       |
| `flows/05-recordatorios.yaml`          | Enlace profundo `quimiocare://recordatorios` y regreso al inicio.             |
| `flows/06-perfil-cancelar-cierre.yaml` | El diálogo «¿Cerrar sesión?» se cancela y la sesión sigue abierta.            |

`subflows/abrir-inicio.yaml` reinicia la app sin borrar sus datos y espera la pestaña Inicio.
Ningún flujo guarda datos clínicos, cambia permisos ni cierra la sesión, así que se pueden
correr sobre la cuenta de prueba del proyecto sin dejar rastros.

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
