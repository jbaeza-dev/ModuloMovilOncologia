# Plan de implementación de formularios diarios y educación multimedia

**Proyecto:** módulo móvil para pacientes en quimioterapia. QuimioCare se utiliza como nombre de trabajo.

**Fecha de revisión:** 17 de octubre de 2026, America/Santiago.  
**Repositorio:** `jbaeza-dev/ModuloMovilOncologia`.  
**Base revisada:** `main`, commit `29fb167f2d2a9773a054dc7311cee7a1b6e22c05`, que integra `feat/mejoras-profesor-mobile`.  
**Rama de trabajo:** `feat/formularios-diarios-educacion`.  
**Destino documental:** `docs/mobile/plan_formularios_diarios_educacion.md`.

---

## 1. Decisión y resultado esperado

Se amplía la infraestructura actual para modernizar dos módulos centrales de interacción del paciente:

1. **Módulo de Formularios (Seguimiento Diario Dinámico):** Sustituir los formularios de muestra planos y el registro libre de síntomas por un motor dinámico declarativo capaz de interpretar cualquier definición versionada recibida. La aplicación se valida con el **fixture técnico provisional del instrumento suministrado** (41 preguntas, 11 módulos ePRO) y con un **segundo formulario de prueba desacoplado** (diferentes IDs, secciones y límites) para garantizar que el motor, la navegación por secciones y la persistencia no dependan de reglas cableadas para códigos específicos. Se implementa persistencia por período diario civil (`America/Santiago`), ventana de recuerdo de 24 horas, control de concurrencia y confirmación transaccional idempotente en SQLite.
2. **Módulo de Educación Multimedia:** Organizar la biblioteca en las **9 categorías clínicas definitivas**, admitiendo exclusivamente **Videos de YouTube** (apertura externa mediante app oficial o navegador web, sin descargas simuladas) e **Infografías PNG/JPEG** (guardado offline privado, texto accesible offline guardado en `metadata_local_json`, límites de 5 MiB y 8 megapíxeles, y visor ampliado accesible con controles táctiles sin depender de gestos nativos de pinza). Retirar el formato Markdown mediante migración de esquema y limpieza física recuperable en segundo plano.
3. **Integración en Inicio y Sustitución de Síntomas Libres:** Reemplazar en la pantalla de Inicio el acceso libre a síntomas por el estado del seguimiento diario («Cómo me siento hoy»), redirigir rutas legacy, descontinuar nuevas altas libres y conservar el historial antiguo de `sintomas`. **Las exportaciones existentes de reportes (PDF y Excel de 3 hojas) se mantienen sin modificaciones de formato**, agregando pruebas de regresión que aseguren su correcto funcionamiento.

---

## 2. Alcance incluido y excluido

### 2.1 Alcance incluido

- Motor declarativo dinámico desacoplado: evaluación segura de condiciones positivas (`eq`, `in`, `all`), rechazo estático de referencias hacia adelante en el orden de presentación, dependencias circulares y profundidades $> 5$.
- Fixture técnico provisional del instrumento ePRO (41 preguntas, 11 módulos según Word).
- Segundo formulario desacoplado (`sample-decoupled-form.ts`) para prueba automática de generalidad.
- Persistencia SQLite: Migración 009 (`borrador_formulario` con clave por período, fecha de seguimiento, zona horaria, ventana 24h y `paso_actual` persistidos sin recálculo) y Migración 010 (retiro de Markdown en `descarga` y fechas ISO 8601 UTC en `retirado_en`).
- Experiencia de seguimiento diario por secciones («Sección X de N»), diálogo contextual de confirmación ante cambios de madre con hijas contestadas y autosave controlado.
- Biblioteca educativa con 9 categorías y filtro (Todos, Videos, Infografías).
- Visor accesible de infografías con zoom táctil escalable (100 %–300 %) y modal de texto accesible offline con control de foco.
- Apertura de YouTube con fallback a navegador web.
- Limpieza recuperable de Markdown bajo bloqueo de paciente y comprobación de fila previa al borrado físico.
- Tarjeta «Cómo me siento hoy» en Inicio y redirecciones legacy.
- Pruebas unitarias, UI y suite de validación completa.

### 2.2 Alcance excluido

- Integración de respuestas del seguimiento en reportes PDF/Excel (pospuesta expresamente; se mantienen las 3 hojas de Excel y pruebas de regresión).
- Radioterapia, PowerSync, autenticación remota, backend pasarela, motor de triaje automatizado o alertas médicas al equipo tratante.
- Reconocimiento OCR de imágenes o generación de texto clínico con IA.

---

## 3. Categorías educativas y reglas de formato

| Orden | ID interno                 | Nombre visible                                   | Formatos admitidos                    |
| ----- | -------------------------- | ------------------------------------------------ | ------------------------------------- |
| 1     | `unidad-oncologica`        | Introducción a la unidad oncológica              | Videos YouTube / Infografías PNG-JPEG |
| 2     | `conociendo-cancer`        | Conociendo el cáncer                             | Videos YouTube / Infografías PNG-JPEG |
| 3     | `conociendo-quimioterapia` | Conociendo la quimioterapia                      | Videos YouTube / Infografías PNG-JPEG |
| 4     | `dispositivos-tratamiento` | Dispositivos de tratamiento                      | Videos YouTube / Infografías PNG-JPEG |
| 5     | `efectos-secundarios`      | Efectos secundarios de la quimioterapia          | Videos YouTube / Infografías PNG-JPEG |
| 6     | `salud-mental`             | Salud mental                                     | Videos YouTube / Infografías PNG-JPEG |
| 7     | `alimentacion`             | Alimentación                                     | Videos YouTube / Infografías PNG-JPEG |
| 8     | `signos-alarma`            | Signos de alarma                                 | Videos YouTube / Infografías PNG-JPEG |
| 9     | `gestoras-procesos`        | Gestoras de oncología y procesos administrativos | Videos YouTube / Infografías PNG-JPEG |

---

## 4. Secuencia de bloques de trabajo

- **B0:** Documentación base, trazabilidad y disciplina de rama (`feat/formularios-diarios-educacion`).
- **B1:** Motor declarativo dinámico, validación de integridad, fixture provisional de 41 preguntas y formulario de desacoplamiento.
- **B2:** Migración 009, repositorios diarios, contexto diario civil en `America/Santiago`, controlador de borrador y saneamiento de joins en SQLite.
- **B3:** Pantallas de seguimiento por secciones, estado de hoy, QuestionInput accesible, revisión e historial.
- **B4:** 9 Categorías educativas, filtro triple, catálogo adaptado y apertura externa de videos.
- **B5:** Visor de infografías con zoom y modal de texto offline, límites de 5 MiB / 8 MP, Migración 010 y limpieza recuperable de Markdown.
- **B6:** Tarjeta en Inicio, redirección de rutas legacy, retiro de altas libres y pruebas de regresión en reportes existentes.
- **B7:** CI final (`check`, `test:local`, `test:ui`, `doctor`, `bundle:android`) y documentación de aceptación Android.
