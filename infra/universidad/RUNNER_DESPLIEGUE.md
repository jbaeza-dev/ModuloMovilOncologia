# Despliegue mediante runner de usuario en Parra

GitHub compila las imágenes y prepara el artefacto. Solo el job `deploy` utiliza
el runner `parra-quimiocare`, con etiquetas `self-hosted`, `linux`, `x64` y
`quimiocare-deploy`. La comprobación pública posterior vuelve a ejecutarse en
GitHub. El workflow reutilizable conserva el requisito de CI aprobado en `main`.

## Registro inicial

Requiere autorización institucional para el agente persistente. Usar la cuenta
universitaria que ya posee los contenedores rootless y el bus systemd de usuario.
No usar root, Docker ni otro usuario para el runner.

1. En Settings → Actions → Runners → New self-hosted runner, elegir Linux/x64.
2. Descargar el paquete oficial y verificar el SHA-256 publicado por GitHub.
3. Extraerlo en `$HOME/actions-runner-quimiocare`.
4. Registrar usando un token temporal nuevo, sin guardarlo en Git ni en dotenv:

```bash
cd "$HOME/actions-runner-quimiocare"
read -rsp 'Token temporal: ' RUNNER_REGISTRATION_TOKEN
printf '\n'
./config.sh --url https://github.com/jbaeza-dev/ModuloMovilOncologia \
  --token "$RUNNER_REGISTRATION_TOKEN" --name parra-quimiocare \
  --labels quimiocare-deploy --work _work
unset RUNNER_REGISTRATION_TOKEN
```

5. Instalar el servicio desde un checkout con estos cambios:

```bash
bash infra/universidad/scripts/install-runner-user-service.sh
systemctl --user status quimiocare-actions-runner.service --no-pager
tail -n 50 "$HOME/actions-runner-quimiocare/service.log"
```

El usuario debe tener `Linger=yes`. No ejecutar simultáneamente `./run.sh` y el
servicio. El runner se actualiza automáticamente; debe poder descargar nuevas
versiones. Las dependencias del sistema que falten las instala el administrador.

## Configuración y límites

- Proteger `main`, revisar cambios en workflows y restringir Environment
  `universidad` a `main`. Solo personas de confianza deben modificar workflows:
  una etiqueta no es una autorización. Usar revisión de despliegue si el plan
  de GitHub lo permite. No asignar al runner trabajos de pull requests.
- El runner requiere Git, Python 3.11+, Podman rootless, curl, tar, sha256sum,
  flock y acceso al bus de usuario. El PATH del servicio prioriza `~/.local/bin`.
- Necesita salida HTTPS a GitHub, sus servicios de Actions/artefactos y GHCR,
  además de los registros usados por las imágenes de infraestructura.
- No escucha en nuevos puertos. Solo se publican 8018 y 8019 como antes.
- El dotenv permanece en `~/quimiocare/shared/universidad.env`, modo 600.
- La entrega solo contiene configuración pública: archivos 644 y directorios 755
  permiten leer los montajes a usuarios sin privilegios dentro de los contenedores.
  Los secretos se mantienen fuera de esa entrega, con permisos privados.
- `QC_SSH_*` ya no se utiliza en el workflow nuevo. Conservar temporalmente los
  secretos para contingencia; retirarlos tras verificar la primera entrega.
- `GITHUB_TOKEN` efímero, con `packages: read`, autentica la descarga de imágenes.
  La credencial de Podman se almacena en un directorio temporal del runtime y se
  elimina al salir. Nunca se escribe en dotenv ni dentro de la entrega.

## Entrega y recuperación

La descarga se limita al artefacto del mismo run/intento. Se rechazan rutas que
escapen, enlaces, entradas duplicadas, archivos especiales e identidad de otra
entrega. Se verifican SHA256SUMS y el manifiesto antes de ejecutar `deploy.sh`.
El despliegue conserva bloqueo, respaldo, migraciones, descarga por digest,
readiness, verificación de archivos y protección contra entregas obsoletas.

Una entrega usa `revision-run_id-run_attempt` del job que la empaquetó. Al usar
**Re-run failed jobs**, se descarga el artefacto del intento de empaquetado
original. Un directorio existente solo se reutiliza si todos sus archivos son
idénticos al artefacto; nunca se sobrescribe. Si quedó una extracción incompleta
o una discrepancia, investigar y usar **Re-run all jobs** para generar otra entrega.
No hay rollback automático de base de datos. Revisar logs y respaldos si falla.
Si GitHub cancela un trabajo abruptamente, comprobar el estado de los servicios
antes de reintentar. Si quedan directorios `qc-registry.*` en `/run/user/UID`,
revisar que no haya despliegues activos antes de eliminar sus credenciales.

El script SSH anterior se conserva para contingencia; el workflow ya no lo llama.
Instalar el runner no cambia la aplicación ni inicia un despliegue. El primer
despliegue real ocurre al integrar estos cambios en `main` y superar el CI.

## Comprobación inicial sin desplegar

En Parra, como el usuario del servicio:

```bash
export PATH="$HOME/.local/bin:$PATH"
python3 --version
podman info --format '{{.Host.Security.Rootless}}'
systemctl --user show-environment >/dev/null
test -f "$HOME/quimiocare/shared/universidad.env"
```

Confirmar también `Idle` en GitHub. Esto verifica prerrequisitos; solo un job real
confirma descarga autenticada de artefactos, acceso a GHCR y despliegue completo.
