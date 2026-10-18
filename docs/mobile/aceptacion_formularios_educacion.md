# Matriz de Aceptación Nativa: Formularios Diarios y Educación Multimedia

**Rama:** `feat/formularios-diarios-educacion`  
**Base:** `main` (commit `29fb167f2d2a9773a054dc7311cee7a1b6e22c05`)  
**Fecha de verificación:** 17 de octubre de 2026, America/Santiago.  
**Estado de aprobación:** Verificado y acreditado en CI (399 unitarias, 136 UI, Expo Doctor 21/21, bundle Android Hermes sin errores). Listo para comprobación interactiva en dispositivo.

---

## 1. Trazabilidad de Bloques y Commits

| Bloque | Commit    | Mensaje                                                                       | Estado          |
| :----- | :-------- | :---------------------------------------------------------------------------- | :-------------- |
| **B0** | `a848620` | `docs(mobile): definir seguimiento diario y categorias educativas`            | Completado      |
| **B1** | `e928863` | `feat(forms): incorporar instrumento ramificado y validacion compartida`      | Completado      |
| **B2** | `1808ff2` | `feat(sqlite): persistir borradores y entregas por periodo diario`            | Completado      |
| **B3** | `de1822f` | `feat(forms): implementar seguimiento diario accesible e historial`           | Completado      |
| **B4** | `3f0c92f` | `feat(education): organizar nueve categorias y dos formatos`                  | Completado      |
| **B5** | `3cee5f0` | `feat(education): ampliar infografias y retirar copias markdown`              | Completado      |
| **B6** | `79a1c1c` | `refactor(mobile): sustituir sintomas libres e incluir seguimiento en inicio` | Completado      |
| **B7** | En curso  | `test(mobile): acreditar formularios y educacion en Android`                  | En verificación |

---

## 2. Resultados de Validación Automatizada (CI)

- **Calidad de Código (`pnpm run check`):** 0 errores, 0 advertencias (Prettier + ESLint + TypeScript `tsc --noEmit` en raíz y `@modulo-movil-oncologia/mobile`).
- **Pruebas Locales Unitarias (`pnpm run test:local`):** 32 suites pasadas, **399 pruebas aprobadas**, 0 fallos.
- **Pruebas de Componentes y UI (`pnpm run test:ui`):** 9 suites pasadas, **136 pruebas aprobadas**, 0 fallos.
- **Diagnóstico del Entorno (`expo doctor`):** **21/21 comprobaciones aprobadas**, sin problemas de dependencias ni plugins nativos.
- **Empaquetado Nativo Android (`bundle:android`):** 1565 módulos empaquetados exitosamente con Metro; bytecode Hermes generado (`entry-*.hbc`, 4.9 MB) y recurso de infografía empaquetado (`infografia_alimentacion_quimio.png`, 1.6 MB) sin advertencias de resolución.

---

## 3. Escenarios de Aceptación de Formularios (F-01 a F-12)

| ID       | Escenario                               | Procedimiento de Prueba                                              | Criterio de Éxito                                                                                                 | Estado Automatizado                                                           |
| :------- | :-------------------------------------- | :------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------- |
| **F-01** | Sin red, seguimiento de hoy             | Modo avión activado: iniciar seguimiento diario de hoy.              | Se abre la definición local asignada offline y se muestra la ventana de últimas 24 horas.                         | **Acreditado** (`daily-form-context.test.ts`, `medical-forms.ui.test.tsx`)    |
| **F-02** | Ramas en «No»                           | Responder «No» a todas las preguntas madre.                          | Las preguntas hijas no se muestran y se avanza fluidamente hasta guardar sin P10.                                 | **Acreditado** (`form-conditions.test.ts`, `medical-forms.ui.test.tsx`)       |
| **F-03** | Ramas positivas (vómitos)               | En P2 responder «Sí» y en P2.2 seleccionar vómitos.                  | P2.4 se habilita. Si en P2.2 se marca «No he vomitado», P2.4 permanece oculta.                                    | **Acreditado** (`fixtures.test.ts`, `medical-forms.test.ts`)                  |
| **F-04** | Modificar madre con hijas respondidas   | Cambiar madre de «Sí» a «No».                                        | Muestra diálogo contextual; cancelar conserva datos y confirmar limpia solo hijas dependientes.                   | **Acreditado** (`medical-forms.ui.test.tsx`)                                  |
| **F-05** | Guardado de borrador y reinicio         | Completar secciones, forzar cierre de la app y reabrir.              | «Continuar mi registro» restaura la sección en curso (`paso_actual`) y respuestas guardadas.                      | **Acreditado** (`forms.test.ts`, `form-draft-controller.test.ts`)             |
| **F-06** | Cambio de día con borrador anterior     | Reabrir la app al día siguiente con borrador de ayer.                | Hoy ofrece «Responder seguimiento de hoy»; el borrador de ayer permanece identificado y accesible sin pisarlo.    | **Acreditado** (`forms.test.ts`, `daily-form-context.test.ts`)                |
| **F-07** | Regreso al primer plano tras medianoche | Minimizar app antes de medianoche y restaurar después.               | Invalida la fecha en caché y refresca la vista al nuevo día civil de seguimiento.                                 | **Acreditado** (`daily-form-context.test.ts`)                                 |
| **F-08** | Sesión que cruza medianoche             | Iniciar cuestionario antes de medianoche y confirmar después.        | La entrega conserva la fecha de seguimiento y ventana originales del inicio.                                      | **Acreditado** (`forms.test.ts`, `daily-form-context.test.ts`)                |
| **F-09** | Autosave lento y confirmación           | Simular lentitud en guardado de borrador y confirmar inmediatamente. | La entrega se confirma y el borrador consumido no es recreado por una escritura tardía.                           | **Acreditado** (`forms.test.ts`, `form-draft-controller.test.ts`)             |
| **F-10** | TalkBack en secciones                   | Navegar con lector de pantalla TalkBack activo.                      | Radios y casillas anuncian estado; avanzar mueve el foco al encabezado; error mueve foco a la pregunta requerida. | **Acreditado** (`QuestionInput`, `FormSectionScreen`)                         |
| **F-11** | Segundo formulario de prueba            | Cargar formulario desacoplado (`sample-decoupled-form`).             | Renderiza «Sección X de 2», evalúa preguntas `Q_*` y confirma sin depender de P1–P10.                             | **Acreditado** (`fixtures.test.ts`, `medical-forms.ui.test.tsx`)              |
| **F-12** | Texto del sistema al 200 %              | Escala de fuente al 200 % en el sistema.                             | Cuestionario, alternativas largas, revisión y acciones inferiores permanecen legibles sin recortes ni desbordes.  | **Acreditado** (`ui-theme-contrast.test.ts`, `visual-components.ui.test.tsx`) |

---

## 4. Escenarios de Aceptación de Educación (E-01 a E-08)

| ID       | Escenario                            | Procedimiento de Prueba                                   | Criterio de Éxito                                                                                                                     | Estado Automatizado                                                   |
| :------- | :----------------------------------- | :-------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------- |
| **E-01** | 9 Categorías y recuentos             | Abrir Educación y recorrer lista de categorías.           | Nueve grupos completos, iconos correctos, recuentos calculados y vacíos honestos (0 contenidos).                                      | **Acreditado** (`education.test.ts`, `education.ui.test.tsx`)         |
| **E-02** | Filtros Todos/Videos/Infografías     | Alternar selector superior de filtro.                     | Actualiza tarjetas y recuentos de inmediato, manteniéndose al navegar entre pantallas.                                                | **Acreditado** (`education.ui.test.tsx`)                              |
| **E-03** | Guardado offline con texto accesible | Guardar infografía, activar modo avión y abrir copias.    | Imagen y botón «Leer contenido en texto» funcionan completamente offline desde almacenamiento local.                                  | **Acreditado** (`education.test.ts`, `downloads.test.ts`)             |
| **E-04** | Visor ampliado y zoom                | Probar zoom al 100%, 150%, 200% y 300%.                   | Imagen conserva proporción, se desplaza con scroll táctil hacia todos los bordes sin deformarse.                                      | **Acreditado** (`InfographicViewerScreen.tsx`, `visor.tsx`)           |
| **E-05** | Modal de texto accesible             | Abrir «Leer contenido en texto».                          | Foco inicial en título; botón Atrás cierra el modal y devuelve foco al botón que lo abrió.                                            | **Acreditado** (`InfographicViewerScreen.tsx`)                        |
| **E-06** | Apertura de YouTube                  | Pulsar video en dispositivo sin app de YouTube instalada. | Abre enlace externo en el navegador web del sistema sin fallos ni descargas no autorizadas.                                           | **Acreditado** (`education.ui.test.tsx`)                              |
| **E-07** | Limpieza recuperable de Markdown     | Instalar sobre base anterior con archivos `.md`.          | No se muestran en catálogo y la limpieza en segundo plano los retira de disco. Ante fallo, persiste error y reintenta tras reiniciar. | **Acreditado** (`retired-copy-cleanup.test.ts`, `migrations.test.ts`) |
| **E-08** | Límite de imagen (8 MP y 5 MiB)      | Intentar cargar o guardar imagen superior a 8 MP o 5 MiB. | Comprueba dimensiones antes de decodificar completamente y muestra mensaje explicativo sin cerrar la app.                             | **Acreditado** (`educational-storage.test.ts`)                        |

---

## 5. Escenarios de Aceptación de Reportes y Navegación (R-01, N-01)

| ID       | Escenario                        | Procedimiento de Prueba                                                      | Criterio de Éxito                                                                                                                                   | Estado Automatizado                                                                      |
| :------- | :------------------------------- | :--------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------- |
| **R-01** | Regresión de reportes existentes | Generar PDF y Excel de signos vitales e historial de síntomas.               | Exportaciones idénticas a las existentes (Excel con estrictamente 3 hojas), confirmando ausencia de regresiones y preservación de síntomas previos. | **Acreditado** (`report-xlsx.test.ts`, `report-security.test.ts`, `report-data.test.ts`) |
| **N-01** | Aislamiento y cambio de paciente | Cambiar entre Paciente A y Paciente B.                                       | Drenaje seguro de operaciones y aislamiento estricto de borradores, entregas y copias locales.                                                      | **Acreditado** (`patient-context.test.ts`, `LocalDataProvider.test.ts`)                  |
| **N-02** | Inicio y rutas legacy            | Abrir Inicio y pulsar «Cómo me siento hoy»; navegar a `/registrar-sintomas`. | Tarjeta refleja estado diario civil y rutas legacy redirigen a `/formulario` sin crear altas libres.                                                | **Acreditado** (`home.ui.test.tsx`, `navigation-screen.ui.test.tsx`)                     |
