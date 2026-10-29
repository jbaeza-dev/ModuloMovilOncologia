# Simulador independiente QuimioCare

Servicios de demostración con PostgreSQL real y datos exclusivamente sintéticos. Implementa las16operaciones clínicas RC3.2, IA-01 y los6helpers originales. No es el gateway, OAuth Google, RAG clínico ni un sustituto de la prueba PowerSync/Android.

## Preparación

Desde la raíz, instalar el lockfile aprobado y compilar contratos antes del simulador:

```powershell
pnpm --filter @quimiocare/contracts build
pnpm --filter @quimiocare/simulator build
```

Definir variables de servidor por el mecanismo del entorno:

| Variable                  | Uso                                                         |
| ------------------------- | ----------------------------------------------------------- |
| APP_ENV                   | Debe ser demo; otro modo se rechaza                         |
| DATABASE_URL              | PostgreSQL propio del entorno sintético                     |
| DEMO_SIGNING_KEY          | Clave HS256 de al menos32caracteres, solo servidor          |
| DEMO_CONTROL_KEY          | Clave de controles de al menos32caracteres, nunca APK       |
| AUTH_EXPECTED_ISSUER      | Por defecto quimiocare-demo                                 |
| AUTH_EXPECTED_AUDIENCE    | Por defecto authenticated                                   |
| SIMULATOR_SERVICE         | clinical o ai                                               |
| SIMULATOR_PORT            | Por defecto3002clínica /3003IA                              |
| SIMULATOR_HOST            | Por defecto0.0.0.0                                          |
| SIMULATOR_PUBLIC_BASE_URL | Base accesible del servicio clínico para URL de la imagen   |
| TEST_DATABASE_URL         | Base sintética desechable usada por la suite de integración |

Ejecutar migración y seed de forma explícita; start no reinicia datos:

```powershell
pnpm --filter @quimiocare/simulator migrate
pnpm --filter @quimiocare/simulator seed
pnpm --filter @quimiocare/simulator education:publish
pnpm --filter @quimiocare/simulator start
```

Ejecutar la misma build con SIMULATOR_SERVICE=ai y su puerto para el stubIA. Cada modo publica GET/health operativo con comprobaciónDB; no se contabiliza como operación clínica ni implementa G-01 del gateway.

## Identidades y autenticación

- A:964d32f1-6941-579f-9f08-b60342194da9.
- B:2dcb04f2-a2ad-5ea4-b711-9acd7e570002.

Estos IDs Auth son distintos de perfil/tratamiento. D-01selecciona A/B y emite JWT firmado con iss/aud/exp/role/cohort. D-02rota refresh opaco con hash en DB; la rotación no extiende su máximo absoluto24h. Un refresh ya consumido se rechaza incluso entre procesos concurrentes.

Los pacientes comienzan sin consentimiento aceptado. Leer C-14/C-15 y enviar C-16 antes de C-06/C-10. Replay de consentimiento se resuelve antes de controlar vigencia y refleja revocación actual. Controles D-03/D-04/D-05 exigen X-Demo-Control. Bearer no reemplaza esa clave.

## Escenarios y persistencia

Un escenario por paciente, persistido con contador/generación. ACK_SIGNOS_PERDIDO y ACK_EPRO_PERDIDO guardan primero en transacción y destruyen la respuesta después del COMMIT. Reactivar reinicia el contador sin borrar mediciones/respuestas. El siguiente intento usa el mismoUUID/contenido y devuelve el original: signos200, ePRO201.

EDUCACION_RETIRADA retira la imagen de publicación en la tabla origen real para que REST y CDC observen la misma retirada. El catálogo educativo es global: ese cambio se observa por todas las cuentas autorizadas, sin exponer datos clínicos ajenos. Volver a NORMAL no resucita el recurso; un reset sintético explícito restaura el seed.

La definición base de términos es 3.0, con el contenido de uso, privacidad y consentimiento aprobado para QuimioCare. Se conservan las definiciones técnicas 1.0/2.0 y sus aceptaciones anteriores; esas aceptaciones no habilitan automáticamente la edición nueva. Reutilizar una identidad de definición con contenido diferente detiene el seed. TERMINOS_NUEVOS selecciona una edición técnica 4.0 para el paciente de prueba. Consultar C-14 con bearer para obtener la que aplica a su escenario; sin bearer devuelve la definición base pública. No se altera el consentimiento del otro paciente. Las cuentas A/B continúan admitiendo únicamente datos ficticios.

EDICION_CONDICIONAL y EXCLUSIVIDAD_ACTIVA seleccionan definiciones técnicas de códigos/IDs propios distintos del instrumento41preguntas. No se convierten en reglas clínicas ni modifican ediciones publicadas. La aprobación comunicada del instrumento actual debe vincularse a su edición por separado.

La persistencia tiene constraints reales, bloqueo transaccional porUUID y propietarios. Se preservan los datos ante reinicio del proceso. Reset exige literal de confirmación y marcador del dataset; borra únicamente relaciones enumeradas del simulador, sin CASCADE. No limpia gateway, SDK ni almacenamiento de PowerSync.

## Interfaces de lectura y ampliaciones

Las tablas físicas public.formulario, public.pregunta y public.contenido_educativo son el origen de réplica; opciones/configuración sonJSONB. La configuración de PowerSync/roles/publicación se despliega en infraestructura, no se infiere de los guardsREST.

C-11/C-12/C-13 exponen el subconjunto RC3.2 imagen/video elegible, con descripción nula normalizada, orden fechaDESC/idASC y total previo a paginar. D-06sirve los77bytes originales; metadatos usan su hash/revisión declarados, con base pública configurable.

El publicador `education:publish` verifica los archivos de `assets/education/` antes de actualizar el catálogo en una transacción. La edición `cuidaquimio-1.1.0` publica las 42 imágenes del sitio CUIDAQUIMIO revisado el 28-10-2026 (una conversión WebP a PNG previamente autorizada conserva sus píxeles) y sus mismos 44 enlaces YouTube. Ocho imágenes tienen una revisión nueva; el inventario identifica las dos entradas anteriores que ya no aparecen independientemente en el sitio. Solo retira esos UUID del mismo publicador y la muestra técnica; conserva otros contenidos, los datos clínicos y las fechas existentes al repetir la operación. Las fechas iniciales son marcas técnicas para conservar el orden del PPT; no son fechas de autoría. Los cuatro podcasts del sitio son enlaces online en el módulo móvil y no se etiquetan como videos ni se agregan al contrato clínico imagen/video.

Las imágenes se sirven en `/__demo/archivos/educacion/{id}/{revision}.{png|jpg}`. Esta ruta entrega solo archivos educativos autorizados; no admite archivos de pacientes ni permite listar directorios. Comprueba publicación vigente, MIME, longitud y SHA-256; una retirada produce 404 y bytes inconsistentes, 503. Los enlaces originales de Drive permanecen en el catálogo como procedencia, sin cambiar sus permisos ni descargar videos.

Los PDF educativos están fuera del alcance activo. Su schema propio histórico se conserva como antecedente y no habilita publicación, descarga ni visor PDF. Los reportes clínicos PDF/XLSX pertenecen a la app y no a esta biblioteca.

El stubIA recibe un solo mensaje y no guarda conversaciones. NORMAL da respuesta sintética; saludo simple da cortesia; el mensaje técnico literal DEMO_SIN_INFORMACION prueba ese estado. IA_NO_DISPONIBLE e IA_URGENCIA prueban HTTP200sin disponibilidad y urgencia independiente. No demuestra calidad del RAG ni avisa a profesionales.

## Validación

```powershell
pnpm --filter @quimiocare/simulator typecheck
pnpm --filter @quimiocare/simulator test
pnpm --filter @quimiocare/simulator test:integration
```

Integración exige TEST_DATABASE_URL; no hace fallback en memoria ni omite silenciosamente pruebas. La suite migra y restablece su dataset, inicia servidores HTTP reales y prueba PostgreSQL, concurrencia, refresh, consentimiento, ACK perdido, ePRO, catálogo y escenarios. Solo ejecutarla en la DB sintética de prueba. Evidenciar por separado reinicio de contenedor/origen, CDC, development build, recepción push y pruebas nativas; esta suite no los acredita.
