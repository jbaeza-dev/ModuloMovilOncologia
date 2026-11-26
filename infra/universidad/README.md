# Entrega universitaria de QuimioCare

El despliegue de entregas verificadas en `main` utiliza un runner de usuario en Parra. Su instalación, requisitos y operación se describen en [RUNNER_DESPLIEGUE.md](RUNNER_DESPLIEGUE.md). Las imágenes y el APK se compilan en GitHub; solo la instalación se ejecuta en el servidor. El procedimiento de instalación y recuperación se documenta en las guías operativas locales del equipo. La aceptación con el teléfono corresponde al usuario.

La consulta de claves de autenticación se exige antes de detener servicios y al
final del despliegue. El alcance y la resolución de fallos se describen en
[AUTENTICACION_SUPABASE.md](AUTENTICACION_SUPABASE.md).

Si Parra no puede alcanzar el endpoint de claves, existe el modo optativo
`AUTH_JWKS_MODE=distributed`: [activación, límites y recuperación](JWKS_DISTRIBUIDO.md).
Añade un servicio interno de 96 MiB, sin publicar puertos, y requiere renovaciones
periódicas de GitHub. Una copia vencida bloquea el acceso; no sustituye la reparación
de la conectividad ni garantiza disponibilidad durante retrasos del scheduler.

## Arquitectura

Podman rootless, Quadlet y red privada `qc-net`. Un PostgreSQL 17 con bases y propietarios distintos: `qc_demo`/`qc_admin`, `qc_gateway_demo`/`qc_gateway`, `qc_powersync`/`qc_storage`. `qc_replica` solo lee la fuente y replica. Clínica e IA sintética comparten imagen; gateway y worker comparten otra. No se implementa un segundo módulo médico.

| Servicio     | Destino privado      |      Límite RAM |
| ------------ | -------------------- | --------------: |
| PostgreSQL   | qc-postgres:5432     |         768 MiB |
| PowerSync    | qc-powersync:8080    |         512 MiB |
| Clínica      | qc-clinical:3002     |         384 MiB |
| Gateway      | qc-gateway:3001      |         384 MiB |
| IA sintética | qc-ai:3003           |         256 MiB |
| Worker       | sin puerto público   |         256 MiB |
| Dos proxies  | loopback 8018 y 8019 | 64 MiB cada uno |

Total configurado: 2.688 MiB; esto no constituye una medición de carga. Cada servicio limita CPU a un núcleo. No hay compilaciones en el servidor. Las imágenes se descargan en serie, por digest, antes de detener escritores. Se exige AMD64, aproximadamente 4 GB RAM y 5 GiB libres como mínimo operativo. Un disco de 20 GB requiere supervisión. Cada respaldo confirmado rota los anteriores: se conservan los 7 más recientes (`BACKUP_KEEP`) y solo se borran carpetas de respaldo completas (con `manifest.txt` y `checksums.sha256`); nunca la recién creada, las parciales ni carpetas ajenas. La copia externa de respaldos queda fuera del alcance de este despliegue; si se necesita conservar uno más antiguo, hay que exportarlo antes del siguiente despliegue.

## Rutas públicas

La prueba HTTP en Parra del 01-11-2026 confirmó que el proxy institucional termina TLS y **retira** `/quimiocare` y `/quimiocare-backend` al entregar a los puertos 8018 y 8019, respectivamente. Los proxies locales admiten estas rutas sin prefijo; las URLs públicas conservan los siguientes prefijos:

| Ruta                                     | Destino                               |
| ---------------------------------------- | ------------------------------------- |
| `/quimiocare/docs/preparacion/`          | Swagger principal                     |
| `/quimiocare/admin/api/v1/preparacion/…` | preparación, operador Supabase activo |
| `/quimiocare/api/v1/…`                   | contrato clínico                      |
| `/quimiocare/api/v1/chat`                | IA sintética, ruta exacta             |
| `/quimiocare/archivos/educacion/…`       | bytes educativos                      |
| `/quimiocare-backend/api/gateway/…`      | gateway                               |
| `/quimiocare-backend/sync/stream`        | stream PowerSync                      |
| `/quimiocare-backend/health`             | salud gateway                         |

El SDK recibe como base `https://DOMINIO/quimiocare-backend` y añade `/sync/stream`. Parra entrega `/sync/stream` a Nginx y este conserva esa ruta hacia PowerSync, sin buffering. Las rutas con prefijo también se conservan para diagnóstico directo. Nginx restaura `/quimiocare` internamente para las páginas Swagger y su callback, de modo que sus assets, retornos y redirecciones sigan utilizando URLs públicas. No se publica el API administrativo de PowerSync, `/internal/ready` ni los controles destructivos `__demo`. Solo los proxies publican puertos del host: `127.0.0.1:8018` y `127.0.0.1:8019`.

Adicionalmente, la configuración del proxy Nginx (`gateway.conf`) normaliza el encabezado de autenticación de PowerSync soportando tanto `Token` como `token` (`$http_token`), garantizando interoperabilidad con clientes nativos Android y web sin depender de la capitalización del cliente HTTP.

## Archivos y persistencia

```text
$HOME/quimiocare/
  shared/universidad.env           # privado, estable, 600; única fuente de configuración
  shared/env/*.env                 # derivados por servicio, 600
  shared/successful-deployment.json # última revisión que aprobó readiness
  releases/<sha>-<run>-<attempt>/   # configuración y manifiesto verificados
  current -> releases/…           # activación atómica
  media/educacion/                 # archivos persistentes
  media/temp/                     # mismo filesystem que los archivos definitivos
  backups/                        # dumps custom + imágenes + checksums (los 7 más recientes)
```

Cada despliegue recrea los contenedores y con ellos se borran sus registros (`podman logs`), incluidos los errores 5xx que anota la clínica. Para revisar un problema hay que consultar los registros antes del siguiente despliegue; no se guardan aparte (decisión del 26-11-2026). Durante el despliegue la ruta pública responde 503 unos segundos, porque hay un solo servidor; la app lo resiste porque guarda primero en el teléfono y reintenta.

El bootstrap de PostgreSQL actúa solo en un volumen nuevo. No rota contraseñas al actualizar. Los medios y volúmenes no forman parte de las imágenes ni se eliminan durante una entrega.

Las entregas inmutables son validadas estrictamente con `infra/universidad/scripts/release.py` verificando los hashes SHA-256 de los archivos contra `manifest.json`. Si se actualizan archivos de configuración en el host, su checksum debe sincronizarse en el manifiesto para que tareas automáticas como `renew-university-jwks.sh` ejecuten con éxito.

`versions.json`, Containerfiles y Quadlets fijan versiones y digests. Las imágenes de aplicación se construyen, escanean y publican por CI; el instalador solo acepta manifiesto schema 2, editor esperado y referencias `@sha256`. Los paquetes antiguos generados por `scripts/build-local-release.ps1` son artefactos locales de diagnóstico, **no entradas del instalador CI actual**.

## Validación

La guía de CI/CD distingue pruebas locales, pruebas Linux desechables y prerrequisitos institucionales. `scripts/test-university-stack.mjs` crea recursos Docker propios, migra/siembra una fuente nueva con su rol, comprueba las invitaciones y espera replicación real. En Linux añade respaldo/restauración en destinos nuevos. Nunca reutiliza bases de trabajo ni la instancia activa de PowerSync. La generación Quadlet se prueba con el generador real, sin iniciar servicios systemd en este equipo Windows.
