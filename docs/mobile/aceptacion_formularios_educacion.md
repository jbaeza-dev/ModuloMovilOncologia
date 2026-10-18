# Matriz de Aceptación Nativa: Formularios Diarios y Educación Multimedia

**Rama:** `feat/formularios-diarios-educacion`  
**Dispositivo de prueba sugerido:** Android con API 28 (Android 9) y Android moderno.  
**Estado de aprobación:** Pendiente de ejecución sobre build release/demo nativa.

---

## 1. Escenarios de Aceptación de Formularios (F-01 a F-12)

| ID       | Escenario                               | Procedimiento de Prueba                                              | Criterio de Éxito                                                                                                 | Estado    |
| -------- | --------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------- |
| **F-01** | Sin red, seguimiento de hoy             | Modo avión activado: iniciar seguimiento diario de hoy.              | Se abre la definición local asignada offline y se muestra la ventana de últimas 24 horas.                         | Pendiente |
| **F-02** | Ramas en «No»                           | Responder «No» a todas las preguntas madre.                          | Las preguntas hijas no se muestran y se avanza fluidamente hasta guardar sin P10.                                 | Pendiente |
| **F-03** | Ramas positivas (vómitos)               | En P2 responder «Sí» y en P2.2 seleccionar vómitos.                  | P2.4 se habilita. Si en P2.2 se marca «No he vomitado», P2.4 permanece oculta.                                    | Pendiente |
| **F-04** | Modificar madre con hijas respondidas   | Cambiar madre de «Sí» a «No».                                        | Muestra diálogo contextual; cancelar conserva datos y confirmar limpia solo hijas dependientes.                   | Pendiente |
| **F-05** | Guardado de borrador y reinicio         | Completar secciones, forzar cierre de la app y reabrir.              | «Continuar mi registro» restaura la sección en curso (`paso_actual`) y respuestas guardadas.                      | Pendiente |
| **F-06** | Cambio de día con borrador anterior     | Reabrir la app al día siguiente con borrador de ayer.                | Hoy ofrece «Responder seguimiento de hoy»; el borrador de ayer permanece identificado y accesible sin pisarlo.    | Pendiente |
| **F-07** | Regreso al primer plano tras medianoche | Minimizar app antes de medianoche y restaurar después.               | Invalida la fecha en caché y refresca la vista al nuevo día civil de seguimiento.                                 | Pendiente |
| **F-08** | Sesión que cruza medianoche             | Iniciar cuestionario antes de medianoche y confirmar después.        | La entrega conserva la fecha de seguimiento y ventana originales del inicio.                                      | Pendiente |
| **F-09** | Autosave lento y confirmación           | Simular lentitud en guardado de borrador y confirmar inmediatamente. | La entrega se confirma y el borrador consumido no es recreado por una escritura tardía.                           | Pendiente |
| **F-10** | TalkBack en secciones                   | Navegar con lector de pantalla TalkBack activo.                      | Radios y casillas anuncian estado; avanzar mueve el foco al encabezado; error mueve foco a la pregunta requerida. | Pendiente |
| **F-11** | Segundo formulario de prueba            | Cargar formulario desacoplado (`sample-decoupled-form`).             | Renderiza «Sección X de 2», evalúa preguntas `Q_*` y confirma sin depender de P1–P10.                             | Pendiente |
| **F-12** | Texto del sistema al 200 %              | Escala de fuente al 200 % en el sistema.                             | Cuestionario, alternativas largas, revisión y acciones inferiores permanecen legibles sin recortes ni desbordes.  | Pendiente |

---

## 2. Escenarios de Aceptación de Educación (E-01 a E-08)

| ID       | Escenario                            | Procedimiento de Prueba                                   | Criterio de Éxito                                                                                                                     | Estado    |
| -------- | ------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **E-01** | 9 Categorías y recuentos             | Abrir Educación y recorrer lista de categorías.           | Nueve grupos completos, iconos correctos, recuentos calculados y vacíos honestos (0 contenidos).                                      | Pendiente |
| **E-02** | Filtros Todos/Videos/Infografías     | Alternar selector superior de filtro.                     | Actualiza tarjetas y recuentos de inmediato, manteniéndose al navegar entre pantallas.                                                | Pendiente |
| **E-03** | Guardado offline con texto accesible | Guardar infografía, activar modo avión y abrir copias.    | Imagen y botón «Leer contenido en texto» funcionan completamente offline desde almacenamiento local.                                  | Pendiente |
| **E-04** | Visor ampliado y zoom                | Probar zoom al 100%, 150%, 200% y 300%.                   | Imagen conserva proporción, se desplaza con scroll táctil hacia todos los bordes sin deformarse.                                      | Pendiente |
| **E-05** | Modal de texto accesible             | Abrir «Leer contenido en texto».                          | Foco inicial en título; botón Atrás cierra el modal y devuelve foco al botón que lo abrió.                                            | Pendiente |
| **E-06** | Apertura de YouTube                  | Pulsar video en dispositivo sin app de YouTube instalada. | Abre enlace externo en el navegador web del sistema sin fallos ni descargas no autorizadas.                                           | Pendiente |
| **E-07** | Limpieza recuperable de Markdown     | Instalar sobre base anterior con archivos `.md`.          | No se muestran en catálogo y la limpieza en segundo plano los retira de disco. Ante fallo, persiste error y reintenta tras reiniciar. | Pendiente |
| **E-08** | Límite de imagen (8 MP)              | Intentar cargar o guardar imagen superior a 8 MP o 5 MiB. | Comprueba dimensiones antes de decodificar completamente y muestra mensaje explicativo sin cerrar la app.                             | Pendiente |

---

## 3. Escenarios de Aceptación de Reportes y Navegación (R-01, N-01)

| ID       | Escenario                        | Procedimiento de Prueba                                        | Criterio de Éxito                                                                                  | Estado    |
| -------- | -------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------- |
| **R-01** | Regresión de reportes existentes | Generar PDF y Excel de signos vitales e historial de síntomas. | Exportaciones idénticas a las existentes (Excel con 3 hojas), confirmando ausencia de regresiones. | Pendiente |
| **N-01** | Aislamiento y cambio de paciente | Cambiar entre Paciente A y Paciente B.                         | Drenaje seguro de operaciones y aislamiento estricto de borradores, entregas y copias locales.     | Pendiente |
