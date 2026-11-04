# Disponibilidad de autenticación en Parra

La cuenta Google se autentica en Supabase. Clínica, gateway y PowerSync obtienen
sus claves públicas por HTTPS para verificar las sesiones. La autorización de
operador se conserva por issuer/UUID en PostgreSQL; no depende de guardar el
token utilizado al concederla.

## Comprobación antes y después de desplegar

`deploy.sh` verifica la dependencia de claves después de descargar las imágenes
y **antes** de respaldar con pausa de escritores, detener servicios o migrar:

- Genera la configuración propuesta en un directorio temporal privado.
- Prueba HTTPS con la imagen clínica desde la red del host, sin abrir listeners.
- Si existe `qc-net`, repite con las imágenes de clínica, gateway y PowerSync.
- Exige HTTP 200, JSON acotado a 64 KiB y claves públicas importables compatibles.
- Rechaza redirecciones, HTTP sin TLS, claves privadas/simétricas y conjuntos ambiguos.
- Si falla, aborta y elimina los archivos de entorno temporales. No modifica los
  servicios ni los archivos de entorno activos.

Los contenedores temporales usan como máximo 128 MiB cada uno y se ejecutan en
serie. No se usa `--cpus`: el controlador CPU no está delegado para esos procesos
temporales en Parra. Las cuotas de los servicios Quadlet se conservan.

Después del arranque, `smoke.sh` repite la consulta desde los tres contenedores
activos antes de declarar la entrega saludable. Estas pruebas no acreditan el
recorrido completo Google ni sustituyen la aceptación manual del teléfono.

Una vez integrados estos scripts, se puede comprobar sin desplegar:

```bash
podman exec -i qc-clinical node --input-type=module \
  < "$HOME/quimiocare/current/infra/universidad/scripts/auth-ready.mjs"
```

El script no requiere tokens de usuarios, API keys ni secretos de Supabase.
No imprime claves ni respuestas de error remotas completas.

## Incidencia del 4 de noviembre de 2026

Durante el diagnóstico, el host y las imágenes anterior y actual dieron timeout
al abrir TCP 443 hacia las dos IP resueltas del proyecto, antes de TLS/HTTP. Desde
el PC se obtuvieron las claves mediante HTTPS. La configuración del issuer y
ES256 coincide, y el operador previo sigue activo.

Direcciones observadas (no son una lista permanente para fijar en DNS):

- Destino: `xthzqcilbfdyeyuxasvl.supabase.co`, TCP 443.
- DNS: `104.18.38.10` y `172.64.149.246`.
- Salida pública de Parra observada: `146.83.196.220`, distinta de su dirección
  pública de entrada. La observación no prueba que el NAT haya cambiado.
- La ruta local sale por `10.10.6.1`, interfaz `bond0`.
- Parra conecta con otros servicios HTTPS, incluidos GitHub y supabase.com.

No se ha identificado el equipo o proveedor que descarta esas conexiones. Un
timeout TCP no puede repararse rotando credenciales ni cambiando permisos en la
base. Las URLs públicas 8018/8019 son entradas y no constituyen un proxy saliente.

Para recuperar el acceso se necesita una ruta HTTPS funcional al proyecto. El
administrador y/o Supabase deben investigar el origen público de salida y los
destinos anteriores, con hora UTC de la prueba. Si la institución dispone de un
proxy de salida autorizado, se debe comprobar y adaptar cada cliente antes de
utilizarlo; una variable de entorno no garantiza compatibilidad de todos los SDK.

## Mensajes de acceso

- 401: sesión inválida o vencida; volver a entrar con Google.
- 403: cuenta sin autorización de operador.
- 503: servicio de acceso temporalmente no disponible; no implica pérdida de permiso.

## Criterio de recuperación

1. Obtener HTTP 200 del JWKS desde Parra y desde cada contenedor.
2. Superar la comprobación previa y posterior del despliegue.
3. Iniciar una sesión Google nueva y abrir Swagger con el operador ya autorizado.
4. Confirmar manualmente el acceso y la sincronización del móvil con la misma identidad.

Mantener la verificación de firma, issuer, audiencia, algoritmo y vencimiento.
No mantener claves copiadas sin caducidad, desactivar TLS ni aceptar sesiones
decodificando el JWT sin verificarlo. La rama de corrección puede probarse en CI;
el login no se considera recuperado mientras los pasos anteriores fallen.
