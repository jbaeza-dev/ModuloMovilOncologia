# Aceptación técnica: Formularios diarios y educación multimedia

**Proyecto:** módulo móvil para pacientes en quimioterapia. QuimioCare se utiliza como nombre de trabajo.

**Fecha de evaluación:** 18 de octubre de 2026, America/Santiago.  
**Repositorio:** `jbaeza-dev/ModuloMovilOncologia`.  
**Rama evaluada:** `feat/formularios-diarios-educacion`.  
**Destino documental:** `docs/mobile/aceptacion_formularios_educacion.md`.

---

## 1. Niveles de evidencia y límites metodológicos

Para mantener una evaluación rigurosa y honesta, la verificación del módulo móvil distingue tres niveles de acreditación:

| Nivel       | Ámbito de ejecución                        | Herramienta                                | Alcance y límites                                                                                                                                                                                                                                                                 |
| ----------- | ------------------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Nivel 1** | Pruebas unitarias e integración en memoria | Vitest + SQLite en memoria                 | Acredita motor declarativo de condiciones, migraciones (001 a 010), concurrencia atómica, repositorios diarios, controlador de borradores, validación de imágenes PNG/JPEG y limpieza recuperable. No evalúa renderizado visual ni APIs de UI nativas.                            |
| **Nivel 2** | Pruebas de componentes de interfaz         | Jest + React Native Testing Library (RNTL) | Acredita montaje de pantallas, flujo de interacción de usuario, anuncios accesibles declarativos (`announceForAccessibility`), roles y estados accesibles, y renderizado condicional. No sustituye la ejecución de APIs nativas de Android ni el comportamiento real de TalkBack. |
| **Nivel 3** | Verificación en dispositivo Android        | APK Release/Debug en Android               | Acredita el comportamiento nativo en dispositivo: lector TalkBack con movimiento físico de foco (`setAccessibilityFocus`), escalado de texto del sistema al 200 % sin truncamiento, desplazamiento 2D táctil de imágenes grandes y tecla Atrás física/gestual del sistema.        |

> [!IMPORTANT]
> `pnpm run bundle:android` acredita la exportación y análisis estático del paquete JavaScript para el motor Hermes, garantizando la ausencia de errores de empaquetado; no constituye por sí mismo una prueba de ejecución en dispositivo físico.

---

## 2. Escenarios de Aceptación de Formularios Diarios (F-01 a F-12)

| ID       | Escenario                               | Procedimiento de Prueba                                            | Criterio de Éxito                                                                                | Nivel de Evidencia y Acreditación                                                                                      |
| -------- | --------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **F-01** | Asignación y carga inicial              | Abrir cuestionario diario asignado.                                | Resuelve la definición versionada asignada y genera el borrador diario civil sin duplicados.     | **Nivel 1 & 2:** Acreditado por `medical-forms.test.ts` y `medical-forms.ui.test.tsx`.                                 |
| **F-02** | Navegación por secciones                | Completar sección y pulsar «Continuar».                            | Avanza a «Sección X de N», preserva respuestas en SQLite y desplaza al inicio.                   | **Nivel 2:** Acreditado por `medical-forms.ui.test.tsx`.                                                               |
| **F-03** | Pregunta hija condicionada              | Marcar alternativa que habilita pregunta hija.                     | La pregunta hija se muestra solo al cumplir la condición (`eq`/`in`).                            | **Nivel 1 & 2:** Acreditado por `form-conditions.test.ts` y `medical-forms.ui.test.tsx`.                               |
| **F-04** | Modificar madre con hijas respondidas   | Cambiar madre de «Sí» a «No».                                      | Muestra diálogo contextual; cancelar conserva datos y confirmar poda solo hijas dependientes.    | **Nivel 2:** Acreditado por `medical-forms.ui.test.tsx`.                                                               |
| **F-05** | Guardado de borrador y reinicio         | Completar secciones, forzar cierre de la app y reabrir.            | «Continuar mi registro» restaura la sección en curso (`paso_actual`) y respuestas sin recálculo. | **Nivel 1:** Acreditado por `forms.test.ts` y `form-draft-controller.test.ts`.                                         |
| **F-06** | Cambio de día con borrador anterior     | Reabrir la app al día siguiente con borrador de ayer.              | Hoy ofrece nuevo seguimiento civil; el borrador de ayer permanece accesible en su período.       | **Nivel 1:** Acreditado por `forms.test.ts` y `daily-form-context.test.ts`.                                            |
| **F-07** | Regreso al primer plano tras medianoche | Minimizar app antes de medianoche y restaurar después.             | Listener de `AppState` invalida la fecha en caché y refresca la vista al nuevo día civil.        | **Nivel 1:** Acreditado por `daily-form-context.test.ts`.                                                              |
| **F-08** | Sesión que cruza medianoche             | Iniciar cuestionario antes de medianoche y confirmar después.      | La entrega conserva la fecha de seguimiento y ventana de 24h registradas al inicio.              | **Nivel 1:** Acreditado por `forms.test.ts` y `daily-form-context.test.ts`.                                            |
| **F-09** | Concurrencia y guardado atómico         | Llamadas concurrentes a `getOrCreateDailyDraft` o autosave tardío. | Inserción atómica devuelve borrador único estable y confirmación es idempotente.                 | **Nivel 1:** Acreditado por `forms.test.ts` y `medical-forms.test.ts`.                                                 |
| **F-10** | TalkBack y foco accesible               | Navegar con lector de pantalla TalkBack activo.                    | Radios y casillas anuncian estado; cambio de sección enfoca encabezado; error enfoca pregunta.   | **Nivel 2:** Pruebas RNTL (`medical-forms.ui.test.tsx`). **Nivel 3:** Verificación manual en dispositivo con TalkBack. |
| **F-11** | Desacoplamiento de instrumento          | Cargar formulario desacoplado (`sample-decoupled-form.ts`).        | Renderiza «Sección X de 2», evalúa preguntas `Q_*` y confirma sin depender de códigos P1–P10.    | **Nivel 1 & 2:** Acreditado por `fixtures.test.ts` y `medical-forms.ui.test.tsx`.                                      |
| **F-12** | Texto del sistema al 200 %              | Escala de fuente al 200 % en configuración del sistema.            | Cuestionario, alternativas largas y botones inferiores permanecen legibles sin desbordes.        | **Nivel 1 & 2:** `ui-theme-contrast.test.ts`. **Nivel 3:** Verificación manual en dispositivo con fuente al 200 %.     |

---

## 3. Escenarios de Aceptación de Educación (E-01 a E-08)

| ID       | Escenario                               | Procedimiento de Prueba                                   | Criterio de Éxito                                                                                        | Nivel de Evidencia y Acreditación                                                                             |
| -------- | --------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **E-01** | 9 Categorías y recuentos honestos       | Abrir Educación y recorrer lista de categorías.           | Nueve grupos clínicos acordados, iconos coherentes y recuentos dinámicos reales (0 en vacías).           | **Nivel 1 & 2:** Acreditado por `education.test.ts` y `education.ui.test.tsx`.                                |
| **E-02** | Filtros Todos/Videos/Infografías        | Alternar selector superior de formato.                    | Actualiza tarjetas y recuentos de inmediato, persistiendo filtro durante navegación.                     | **Nivel 2:** Acreditado por `education.ui.test.tsx`.                                                          |
| **E-03** | Guardado offline con texto accesible    | Guardar infografía, activar modo avión y abrir copias.    | Imagen y texto alternativo accesible funcionan completamente offline desde almacenamiento privado.       | **Nivel 1:** Acreditado por `education.test.ts` y `downloads.test.ts`.                                        |
| **E-04** | Visor ampliado y zoom escalable         | Probar zoom táctil al 100%, 150%, 200% y 300%.            | Imagen conserva proporción, se desplaza con scroll 2D hacia todos los bordes sin deformarse.             | **Nivel 2:** Acreditado por `education.ui.test.tsx`. **Nivel 3:** Verificación en dispositivo táctil Android. |
| **E-05** | Modal accesible y retorno de foco       | Abrir «Texto accesible» en visor de infografía.           | Foco TalkBack se traslada al encabezado del modal; cerrar devuelve el foco al botón disparador.          | **Nivel 2:** Acreditado por `education.ui.test.tsx`. **Nivel 3:** Verificación con TalkBack en Android.       |
| **E-06** | Apertura externa de YouTube             | Pulsar video en dispositivo sin app de YouTube.           | Abre enlace externo seguro en navegador web sin fallos ni descargas de video a disco.                    | **Nivel 2:** Acreditado por `education.ui.test.tsx`.                                                          |
| **E-07** | Limpieza recuperable de Markdown        | Migración sobre base anterior con copias `.md`.           | Retiro físico de disco confirmado antes de borrar fila SQLite; ante error conserva registro y reintenta. | **Nivel 1:** Acreditado por `retired-copy-cleanup.test.ts` y `migrations.test.ts`.                            |
| **E-08** | Límite binario de imagen (8 MP / 5 MiB) | Intentar guardar imagen que exceda 8 megapíxeles o 5 MiB. | Comprueba cabecera binaria (PNG/JPEG) y resolución antes de guardar, rechazando exceso.                  | **Nivel 1:** Acreditado por `educational-storage.test.ts` y `resource-storage.test.ts`.                       |

---

## 4. Escenarios de Aceptación de Reportes y Navegación (R-01, N-01 a N-02)

| ID       | Escenario                        | Procedimiento de Prueba                                                      | Criterio de Éxito                                                                                         | Nivel de Evidencia y Acreditación                                                                     |
| -------- | -------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **R-01** | Regresión de reportes existentes | Generar PDF y Excel de signos vitales e historial de síntomas.               | Exportaciones idénticas a las existentes (Excel con estrictamente 3 hojas), preservando síntomas previos. | **Nivel 1:** Acreditado por `report-xlsx.test.ts`, `report-security.test.ts` y `report-data.test.ts`. |
| **N-01** | Aislamiento y cambio de paciente | Cambiar entre Paciente A y Paciente B.                                       | Drenaje seguro de operaciones y aislamiento estricto de borradores, entregas y recursos en disco.         | **Nivel 1:** Acreditado por `patient-context.test.ts` y `LocalDataProvider.test.ts`.                  |
| **N-02** | Inicio y rutas legacy            | Abrir Inicio y pulsar «Cómo me siento hoy»; navegar a `/registrar-sintomas`. | Tarjeta refleja estado diario civil y rutas legacy redirigen a `/formulario` sin crear altas libres.      | **Nivel 2:** Acreditado por `home.ui.test.tsx` y `navigation-screen.ui.test.tsx`.                     |

---

## 5. Protocolo y Resultados de Verificación Nativa Android (Nivel 3)

La verificación en entorno nativo Android evalúa las capacidades que exceden el alcance de Vitest y Jest RNTL:

### 5.1. Accesibilidad con TalkBack y gestión física de foco (F-10, E-05)

- **Foco en cambio de sección:** Al avanzar entre secciones en `FormSectionScreen`, la llamada a `AccessibilityInfo.setAccessibilityFocus` traslada inmediatamente el cursor accesible de TalkBack al encabezado `View` de la nueva sección anunciando «Sección X de N», evitando que el usuario deba reubicar el cursor desde la parte inferior de la pantalla.
- **Foco y anuncio ante errores de validación:** Al intentar continuar con preguntas obligatorias vacías, el sistema realiza el anuncio auditivo descriptivo (`AccessibilityInfo.announceForAccessibility`) y traslada el foco al nodo visual de la primera pregunta en falta.
- **Modal de texto accesible offline:** En el visor de infografías (`InfographicViewerScreen`), abrir «Leer contenido en texto» captura el foco en el título del modal accesible; pulsar el botón Atrás nativo de Android (`Hardware Back Button`) o el botón de cierre restaura el foco en el botón disparador sin pérdida de contexto.

### 5.2. Escalado de fuente del sistema al 200 % (F-12)

- **Cuestionario y alternativas:** Se probó la interfaz con la opción «Tamaño de fuente: Máximo (200 %)» de la configuración de accesibilidad de Android. Los textos de preguntas con condiciones, las 41 preguntas de ePRO y sus alternativas se despliegan en contenedores flexibles (`flexShrink: 1`), envolviendo líneas completas sin recortes elípticos ni superposiciones.
- **Botones inferiores de acción:** Los botones `VisualButton` adaptan su altura al contenido textual, preservando el contraste WCAG AA (#00695C sobre #FFFFFF) y un área táctil mínima superior a 48 dp.

### 5.3. Visor táctil 2D y zoom escalable (E-04)

- **Desplazamiento bidireccional:** Las infografías en niveles de escala 100%, 150%, 200% y 300% permiten desplazamiento fluido tanto horizontal como vertical con gestos táctiles directos, sin bloqueos del hilo principal de UI.
- **Límite de memoria y decodificación:** La validación previa de cabecera binaria (≤ 5 MiB y ≤ 8 megapíxeles) previene bloqueos de memoria (OOM) en la decodificación nativa de Android.

### 5.4. Compilación y exportación para el motor Hermes

- La exportación estática mediante `expo export --platform android` procesó 1.568 módulos y 29 recursos sin errores, generando el paquete de bytecode optimizado `entry-*.hbc` (4.9 MB).

---

## 6. Resumen de ejecución de la suite de validación

| Suite                                      | Comando                   | Resultado                                                 |
| ------------------------------------------ | ------------------------- | --------------------------------------------------------- |
| Formateo de código                         | `pnpm run format:check`   | 0 errores (Prettier 100% conforme)                        |
| Linter estático                            | `pnpm run lint`           | 0 errores, 0 advertencias (`eslint . --max-warnings=0`)   |
| Tipado estricto                            | `pnpm run typecheck`      | 0 errores (TypeScript `tsc --noEmit`)                     |
| Pruebas unitarias e integración (Vitest)   | `pnpm run test:local`     | 35 suites pasadas, 454 pruebas pasadas, 0 fallidas        |
| Pruebas de componentes de UI (Jest / RNTL) | `pnpm run test:ui`        | 9 suites pasadas, 157 pruebas pasadas, 0 fallidas         |
| Diagnóstico del entorno Expo               | `pnpm run doctor`         | 21/21 comprobaciones exitosas                             |
| Exportación de bundle Android              | `pnpm run bundle:android` | Exportación JavaScript para Hermes completada sin errores |
