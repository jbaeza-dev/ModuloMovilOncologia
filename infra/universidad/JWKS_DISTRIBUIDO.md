# Autenticación de Parra mediante claves públicas distribuidas

## Qué resuelve y qué conserva

Esta alternativa permite verificar los JWT de Supabase cuando Parra no consigue
conectarse al endpoint HTTPS de claves de ese proyecto. Un runner alojado por GitHub
descarga las claves públicas por HTTPS y el runner de Parra recibe ese artefacto
del mismo workflow. No se copian sesiones, contraseñas ni claves privadas.

Google y Supabase siguen realizando el inicio de sesión. Se conserva el issuer,
la audiencia, el algoritmo, las autorizaciones de operadores y los pacientes.
No hay que cambiar las redirecciones OAuth ni recompilar el APK por este cambio.
El teléfono y el navegador siguen necesitando acceso directo a Supabase y Google.
Esto no repara el bloqueo de red de Parra ni garantiza disponibilidad de GitHub.

## Recorrido y límites

1. `refresh-jwks.yml` solicita una ejecución cada seis horas en `main`.
2. El job alojado consulta exclusivamente el endpoint oficial derivado de
   `QC_AUTH_ISSUER`, con TLS verificado, sin redirecciones y con timeout de 10 s.
3. Comprueba claves públicas asimétricas, algoritmo, identificadores y tamaño.
   La copia vence doce horas después de empezar la descarga.
4. El job de Parra descarga el artefacto de esa misma ejecución. El instalador
   desplegado vuelve a validarlo contra el issuer y algoritmo del `.env` del host,
   rechaza retrocesos y realiza un reemplazo atómico en `shared/auth/snapshot.json`.
5. `qc-jwks` sirve ese archivo **solo dentro de la red de contenedores**, en
   `http://qc-jwks:3004/jwks.json`. No publica puertos en el host.
6. Clínica y gateway verifican la firma sin conservar una copia anterior en memoria.
   El proxy consulta además al gateway antes de abrir streams o pedir checkpoints
   de PowerSync. No consulta la base para esta comprobación de firma.
7. Si cambian las claves, se reinician PowerSync y su proxy para cerrar conexiones
   anteriores. Si la copia vence, `qc-jwks` responde 503 y un timer de usuario
   solicita cada 15 s detener PowerSync y su proxy. Una renovación válida los
   recupera si el control de caducidad los había detenido.

Los únicos puertos publicados del despliegue siguen siendo **8018 y 8019**.
El 3004 pertenece al contenedor, igual que los puertos internos de PostgreSQL y
PowerSync. No se añade un endpoint público JWKS ni una excepción a la firma JWT.

### Disponibilidad y revocación

GitHub puede retrasar o descartar ejecuciones programadas. Si no llega una copia
vigente antes del vencimiento, **se bloquean accesos nuevos**, aunque las claves
anteriores fueran auténticas. No se extiende el vencimiento ni se usa una copia
antigua como fallback. Esto es una alternativa con caducidad, no una solución de
alta disponibilidad ni una garantía de renovación en caso de cortes prolongados.

Supabase documenta caché de su endpoint de claves de hasta diez minutos. A ese
tiempo puede sumarse la vigencia de nuestra copia de doce horas. No se promete
revocación instantánea, aunque ante una rotación de emergencia se puede disparar
manualmente el workflow `refresh-jwks.yml` desde Actions en segundos. El cierre de
streams existentes añade el intervalo del timer y el tiempo de bloqueo/operación
de systemd; nuevas verificaciones ya fallan al vencer la copia. Los comandos tienen
límites de tiempo y sus fallos se reportan. Un fallo de systemd o del host debe
tratarse como incidente, no como cierre probado.

La ejecución cada seis horas (4 veces al día) consume aproximadamente 120 minutos
al mes del runner alojado en el repositorio privado, permaneciendo holgadamente
dentro de la cuota gratuita mensual de GitHub Actions (2.000 min). El runner de
Parra debe estar disponible: un despliegue largo puede retrasar el job de renovación.
El timer es independiente de la descarga de imágenes y no espera el bloqueo global de despliegue.

Referencias: [claves de Supabase](https://supabase.com/docs/guides/auth/signing-keys)
y [programaciones de GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Activación futura, después de revisar y autorizar el despliegue

Esta rama no activa nada en producción por sí sola. Los siguientes pasos son para
el operador cuando decida integrar y desplegar el cambio.

### 1. GitHub

En **Settings → Secrets and variables → Actions → Variables**, a nivel de repositorio:

| Variable            | Valor                                                    |
| ------------------- | -------------------------------------------------------- |
| `QC_AUTH_ISSUER`    | `https://xthzqcilbfdyeyuxasvl.supabase.co/auth/v1`       |
| `QC_AUTH_ALGORITHM` | `ES256`, confirmado contra la configuración del proyecto |

Son valores públicos. No se necesitan tokens de paciente, `service_role`, un PAT
ni un nuevo secreto. `GITHUB_TOKEN` lo proporciona Actions. No añadir el JSON de
claves a Git, al APK ni a las variables del repositorio.

El runner debe conservar las etiquetas `self-hosted`, `linux`, `x64` y
`quimiocare-deploy`. El environment `universidad` debe admitir el job de renovación
de `main` sin una aprobación manual en cada ejecución. Si actualmente requiere
aprobación, acordar primero cómo autorizar estas renovaciones; no desactivar
protecciones silenciosamente. Los workflows deben estar habilitados y tener cuota.

### 2. Configuración del host

En la terminal SSH de Parra:

```bash
nano "$HOME/quimiocare/shared/universidad.env"
```

Añadir o modificar **una sola** línea:

```ini
AUTH_JWKS_MODE=distributed
```

Conservar `AUTH_EXPECTED_ISSUER`, `AUTH_PUBLIC_KEY`, `AUTH_ALLOWED_ALGORITHM`, claves
de bases de datos y URLs públicas. `AUTH_PUBLIC_KEY` es la clave publicable de
Supabase, no una clave de firma JWT. No editar los `.env` generados por servicio.
No reiniciar servicios manualmente con una versión que todavía no soporte este modo.

### 3. Primer despliegue

Integrar la rama mediante el proceso habitual, **solo con autorización de merge**.
El workflow de despliegue incorpora una copia reciente al release verificado.
Antes de detener escritores comprueba su vigencia. Instala el servicio interno
y el timer; no resetea la base ni vuelve a autorizar usuarios.

Si el artefacto caducó en la cola o durante la descarga de imágenes, la comprobación
previa aborta. Hay que generar otro paquete con claves recientes: repetir únicamente
el job de despliegue con el mismo artefacto caducado no sirve. Una espera larga de
aprobación también puede provocar esto. No ampliar la vigencia para ocultarlo.

Después del primer despliegue correcto, abrir Actions → **Renew university public
signing keys** → **Run workflow** → `main`. Comprobar ambos jobs y al menos dos
renovaciones programadas. El cron solo funciona cuando el workflow está en `main`.

### 4. Comprobaciones en Parra

```bash
systemctl --user is-active qc-jwks.service qc-jwks-expiry.timer
systemctl --user list-timers qc-jwks-expiry.timer
podman exec qc-jwks node -e "fetch('http://localhost:3004/ready').then(async r=>{console.log(r.status,await r.text());process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
podman port qc-jwks
podman ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

`/ready` debe responder 200 con vencimiento futuro. `podman port qc-jwks` no debe
mostrar ningún puerto. Las fechas deben renovarse sin despliegues nuevos. Las
aplicaciones permanecen publicadas únicamente en las rutas/puertos asignados.

Revisar fallos sin imprimir variables ni tokens:

```bash
podman logs --tail 40 qc-jwks
systemctl --user status qc-jwks-expiry.service --no-pager
systemctl --user is-active qc-powersync.service qc-proxy-backend.service
```

Finalmente probar Google en Swagger y en el APK con las cuentas ya autorizadas,
y confirmar recepción de contenido/formularios. Estas pruebas las realiza el usuario.
Un 403 de operador no autorizado seguirá requiriendo una autorización real; este
cambio no convierte pacientes en operadores.

## Incidentes y vuelta al modo directo

- Renovación fallida: leer el job que falló. Corregir conectividad hacia GitHub,
  cola, cuota, variables o reloj; ejecutar manualmente una renovación en `main`.
- Snapshot rechazado por issuer: comparar las dos configuraciones públicas.
  No cambiar el issuer de la copia para forzar su aceptación.
- Rotación/revocación en Supabase: lanzar renovación y comprobar reinicio de
  PowerSync. Considerar la caché oficial; no guardar claves anteriores a mano.
- Timer fallido: revisar systemd y sus logs. No afirmar que se cerraron los streams
  hasta verificar los servicios detenidos. El servicio interno sí rechaza copias vencidas.
- Recuperación de la salida HTTPS de Parra: confirmar desde los contenedores el
  endpoint oficial, cambiar el `.env` a `AUTH_JWKS_MODE=direct` y efectuar un nuevo
  despliegue autorizado. El despliegue deshabilita timer/servicio de distribución.

No usar una versión antigua del código manteniendo `distributed`. No borrar
volúmenes, restaurar bases ni eliminar `shared/auth` para recuperar el acceso.

## Pruebas reproducibles

```bash
node --test infra/universidad/tests/*.test.mjs scripts/university-release.test.mjs
python3 -m unittest discover -s infra/universidad/tests -v
pnpm --filter @quimiocare/simulator run test
pnpm --filter @quimiocare/gateway run test
node scripts/test-proxy-routes.mjs
bash infra/universidad/scripts/validate-quadlet.sh
```

Las pruebas de lifecycle usan un `HOME` temporal y ejecutables simulados, sin
detener servicios reales. Las pruebas de claves utilizan pares sintéticos y HTTP
real en puertos efímeros del entorno de pruebas. El ensayo de proxy requiere Docker
local y no debe ejecutarse en Parra publicando otros puertos. Quadlet solo genera
unidades de comprobación; no instala ni inicia los servicios de producción.
