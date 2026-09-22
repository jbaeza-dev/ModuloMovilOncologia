# @modulo-movil-oncologia/mobile

Base técnica para la aplicación Android del **Módulo Móvil Oncológico**, diseñada para el acompañamiento de pacientes durante su tratamiento de quimioterapia.

Construida con:

- React Native 0.86
- Expo SDK 57
- TypeScript
- Expo Router

## Estado actual

Esta aplicación corresponde a la inicialización técnica del PR lógico 5 ([SCRUM-26](https://proyecto-movil-oncologico.atlassian.net/browse/SCRUM-26)). Presenta una pantalla inicial neutra de bienvenida que identifica el módulo sin simular datos clínicos ni navegación ficticia.

> [!NOTE]
> Todavía no incluye integración con contratos clínicos, pasarela, clientes HTTP, autenticación JWT, SQLite ni PowerSync. Dichos componentes se incorporarán en sus respectivos PRs lógicos.

## Requisitos y gestión del workspace

- **Node.js**: 22.23.2 LTS recomendado (o Node.js 24 LTS).
- **pnpm**: 11.19.0.

Las dependencias se gestionan de forma centralizada desde la raíz del monorrepositorio con un único `pnpm-lock.yaml`. **No debe ejecutarse `npm` ni generarse un lockfile propio dentro de `apps/mobile/`**.

## Comandos disponibles

Todos los comandos pueden ejecutarse directamente dentro del directorio `apps/mobile/` o desde la raíz utilizando el filtro `--filter @modulo-movil-oncologia/mobile`.

### Iniciar servidor de desarrollo (Metro)

```bash
# Desde apps/mobile:
pnpm run start

# Desde la raíz:
pnpm --filter @modulo-movil-oncologia/mobile start
```

### Iniciar con destino Android

```bash
# Desde apps/mobile:
pnpm run android

# Desde la raíz:
pnpm --filter @modulo-movil-oncologia/mobile android
```

### Comprobación de tipos (TypeScript)

```bash
# Desde apps/mobile:
pnpm run typecheck

# Desde la raíz (recursivo en todos los paquetes):
pnpm run typecheck
```

### Comprobación de salud y dependencias Expo

Valida que las dependencias instaladas sean compatibles con Expo SDK 57:

```bash
# Desde apps/mobile:
pnpm run doctor

# Desde la raíz:
pnpm --filter @modulo-movil-oncologia/mobile doctor
```

### Exportación del bundle JavaScript para Android

Compila y valida la resolución de módulos y assets con Metro sin requerir un emulador o dispositivo conectado:

```bash
# Desde apps/mobile:
pnpm run bundle:android

# Desde la raíz:
pnpm --filter @modulo-movil-oncologia/mobile bundle:android
```
