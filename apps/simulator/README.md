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

TERMINOS_NUEVOS selecciona para el paciente de prueba la definición2.0. Consultar C-14 con bearer para obtener la definición que aplica a su escenario; sin bearer devuelve la definición base pública. No se altera el estado de consentimiento del otro paciente.

EDICION_CONDICIONAL y EXCLUSIVIDAD_ACTIVA seleccionan definiciones técnicas de códigos/IDs propios distintos del instrumento41preguntas. No se convierten en reglas clínicas ni modifican ediciones publicadas. La aprobación comunicada del instrumento actual debe vincularse a su edición por separado.

La persistencia tiene constraints reales, bloqueo transaccional porUUID y propietarios. Se preservan los datos ante reinicio del proceso. Reset exige literal de confirmación y marcador del dataset; borra únicamente relaciones enumeradas del simulador, sin CASCADE. No limpia gateway, SDK ni almacenamiento de PowerSync.

## Interfaces de lectura y ampliaciones

Las tablas físicas public.formulario, public.pregunta y public.contenido_educativo son el origen de réplica; opciones/configuración sonJSONB. La configuración de PowerSync/roles/publicación se despliega en infraestructura, no se infiere de los guardsREST.

C-11/C-12/C-13 exponen el subconjunto RC3.2 imagen/video elegible, con descripción nula normalizada, orden fechaDESC/idASC y total previo a paginar. D-06sirve los77bytes originales; metadatos usan su hash/revisión declarados, con base pública configurable.

El schema propio de PDF educativo se versiona en contratos como ampliación separada. Este simulador no anuncia que C-13RC3.2 acepte documento ni publica un endpointPDF externo ficticio. Su visor/descarga pertenece al flujo posterior de biblioteca.

El stubIA recibe un solo mensaje y no guarda conversaciones. NORMAL da respuesta sintética; saludo simple da cortesia; el mensaje técnico literal DEMO_SIN_INFORMACION prueba ese estado. IA_NO_DISPONIBLE e IA_URGENCIA prueban HTTP200sin disponibilidad y urgencia independiente. No demuestra calidad del RAG ni avisa a profesionales.

## Validación

```powershell
pnpm --filter @quimiocare/simulator typecheck
pnpm --filter @quimiocare/simulator test
pnpm --filter @quimiocare/simulator test:integration
```

Integración exige TEST_DATABASE_URL; no hace fallback en memoria ni omite silenciosamente pruebas. La suite migra y restablece su dataset, inicia servidores HTTP reales y prueba PostgreSQL, concurrencia, refresh, consentimiento, ACK perdido, ePRO, catálogo y escenarios. Solo ejecutarla en la DB sintética de prueba. Evidenciar por separado reinicio de contenedor/origen, CDC, development build, recepción push y pruebas nativas; esta suite no los acredita.
