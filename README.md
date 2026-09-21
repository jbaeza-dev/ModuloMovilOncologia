# Módulo Móvil Oncológico

Aplicación Android de acompañamiento para pacientes en tratamiento de **quimioterapia**. Este repositorio corresponde al módulo móvil del proyecto de título y está en su etapa de inicialización.

## Alcance de este PR

Se establece la documentación básica y el `.gitignore`. Todavía no hay aplicación ejecutable, pasarela, API simulada ni servicios desplegados; cada componente se incorporará en una rama y un pull request propios.

## Componentes previstos

Las siguientes rutas describen la estructura que se incorporará progresivamente; **no son carpetas existentes todavía**:

| Ruta prevista | Responsabilidad |
| --- | --- |
| `apps/mobile/` | React Native + Expo + TypeScript + Expo Router para Android. |
| `apps/gateway/` | Pasarela Node.js + Express para chatbot y sesiones/tokens de dispositivo, con autenticación JWT. |
| `apps/central-api-simulator/` | Simulador local de la API clínica del otro módulo, con datos sintéticos. |
| `packages/contracts/` | Contratos y esquemas compartidos cuando se acuerden con el módulo central. |
| `infra/local/` | Entorno de pruebas locales mediante `podman-compose`. |

La app leerá los datos de referencia clínicos desde SQLite replicado por PowerSync. Cuando recupere conectividad, su implementación de `uploadData()` enviará las escrituras clínicas directamente a los endpoints de la API central. **El gateway no transportará esas escrituras** ni incluirá un endpoint `/sync/batch`. El simulador permitirá probar esos flujos sin depender de la disponibilidad del módulo central. Los datos de prueba serán ficticios.

## Requisitos previstos para el desarrollo local

- Node.js en una versión LTS. El gestor de paquetes y sus versiones se fijarán en el PR de workspaces.
- Entorno de desarrollo Android para ejecutar la app una vez inicializada.
- Podman y `podman-compose` para los servicios locales que se agregarán después.

Todavía no se incluyen instrucciones de instalación o ejecución porque este PR no crea software ejecutable. Cada PR de inicialización agregará sus comandos verificados al README.

## Colaboración

Cada tarea parte de `main` en una rama corta, se revisa mediante un pull request por la otra persona del equipo y se integra tras superar las comprobaciones disponibles. Este arranque está asociado con [SCRUM-26](https://proyecto-movil-oncologico.atlassian.net/browse/SCRUM-26). Las ramas posteriores incorporarán workspaces, contratos, Expo, CI, pasarela y simulador de forma independiente.
