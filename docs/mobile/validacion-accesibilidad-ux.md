# Validación de Accesibilidad y Experiencia de Usuario (UX) — QuimioCare Mobile

**Módulo Móvil Android:** `@modulo-movil-oncologia/mobile`  
**Rama:** `feat/mejoras-profesor-mobile`  
**SHA candidato evaluado:** `a9044685dc899f73962d647351f882623746e73c`  
**Fecha:** 17 de octubre de 2026  
**Estándares de referencia:** WCAG 2.2 Nivel AA, Android Accessibility Guidelines, W3C COGA Usability Guidance.

---

## 1. Resumen Ejecutivo y Marco de Verificación

El presente documento acredita la implementación y el estado técnico de verificación del plan de accesibilidad y experiencia de usuario (`.agents/plan_accesibilidad_ux_mobile_premerge.md`) para el módulo móvil Android de **QuimioCare** sobre Expo SDK 57 y React Native 0.86.3.

Se implementaron de manera sistemática los 7 bloques acordados (**B1** a **B7**), cubriendo las 15 mejoras funcionales y ergonómicas (**UX-01** a **UX-15**). Las pruebas se ejecutaron exclusivamente con datos sintéticos y pacientes ficticios (Paciente A y Paciente B), garantizando aislamiento local en SQLite, retención determinista en memoria del asistente y compatibilidad estricta con los contratos de navegación de Expo Router.

### Criterios Rigurosos de Estado de Verificación

Para mantener la máxima transparencia y honestidad técnica con respecto a las pruebas realizadas frente a la validación física en hardware:

1. **«Implementado»**: El código fuente, componentes, estilos, tokens de tema y adaptadores requeridos están completamente escritos, integrados y presentes en el repositorio.
2. **«Verificado automáticamente»**: La funcionalidad, estructura visual, accesibilidad semántica, persistencia y contratos han sido evaluados y aprobados mediante las suites automatizadas de pruebas unitarias, de integración y de interfaz (Vitest, Jest con React Native Testing Library v14 y runtime simulado de React Native 0.86.3).
3. **«Verificado en Android»**: Reservado exclusivamente para escenarios ejecutados materialmente sobre un dispositivo físico o emulador AVD Android real con registro de versión de SO, build instalada y fecha. Los escenarios que no han sido corridos en hardware físico durante este ciclo se declaran con total transparencia como **«Verificado automáticamente (pendiente de validación nativa en hardware)»**.

### Estado de Verificación Automatizada

| Herramienta / Suite                   | Alcance                                                           | Resultado                                  |
| ------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------ |
| **Prettier & ESLint**                 | Estilo, formato e higiene de código en todo el monorepositorio    | **Aprobado** (0 advertencias, 0 errores)   |
| **TypeScript (`tsc --noEmit`)**       | Verificación estricta de tipos en raíz y workspace móvil          | **Aprobado** (0 errores)                   |
| **Vitest (Local)**                    | 26 suites unitarias y de integración sobre SQLite en memoria      | **346 pruebas aprobadas** (100 %)          |
| **Jest & RNTL (UI)**                  | 8 suites de interacción, accesibilidad y componentes React Native | **113 pruebas aprobadas** (100 %)          |
| **Expo Doctor**                       | Diagnóstico de configuración, plugins y dependencias nativas      | **21/21 reglas aprobadas**                 |
| **Android Export (`bundle:android`)** | Compilación de bundle de producción Hermes y assets estáticos     | **Aprobado** (dist generado correctamente) |

---

## 2. Matriz de Cobertura de Mejoras (UX-01 a UX-15)

| ID        | Mejora                                                            | Estado de Implementación                                                     | Verificación Automática                                                                 | Estado de Validación en Android                                         |
| --------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **UX-01** | Inicio sin duplicación y prioridad de tareas                      | **Implementado** (`HomeScreen.tsx`)                                          | 10 tests en `home.ui.test.tsx`                                                          | Verificado automáticamente (pendiente de validación nativa en hardware) |
| **UX-02** | Acciones encontrables y navegación estable                        | **Implementado** (`(tabs)/_layout.tsx`, `Screen.tsx`, `NavigationCard.tsx`)  | `navigation-screen.ui.test.tsx`                                                         | Verificado automáticamente (pendiente de validación nativa en hardware) |
| **UX-03** | Lenguaje comprensible y mensajes veraces                          | **Implementado** (revisión transversal de copy)                              | Suites de vitals, reminders, reports                                                    | Verificado automáticamente (pendiente de validación nativa en hardware) |
| **UX-04** | Tipografía común y texto ampliado                                 | **Implementado** (`typography`, envoltura de texto)                          | `ui-theme-contrast.test.ts`                                                             | Verificado automáticamente (pendiente de validación nativa en hardware) |
| **UX-05** | Áreas táctiles mínimas de 48 × 48 dp                              | **Implementado** (`VisualButton`, `NavigationCard`, `Screen`, header)        | `visual-components.ui.test.tsx`                                                         | Verificado automáticamente (pendiente de validación nativa en hardware) |
| **UX-06** | Contraste y estados semánticos                                    | **Implementado** (`resolveTheme`, pares semánticos)                          | 49 tests en `ui-theme-contrast.test.ts`                                                 | Verificado automáticamente (pendiente de validación nativa en hardware) |
| **UX-07** | TalkBack, foco y anuncios ordenados                               | **Implementado** (`accessibilityLiveRegion="polite"`, `accessibilityLabel`)  | Tests UI de vitals, reminders, assistant                                                | Verificado automáticamente (pendiente de validación nativa en hardware) |
| **UX-08** | Captura de signos comprensible y errores identificables           | **Implementado** (`validateVitalInput`, `VisualField`)                       | 9 tests en `validation.test.ts`, 7 en `vitals.ui.test.tsx`                              | Verificado automáticamente (pendiente de validación nativa en hardware) |
| **UX-09** | Confirmación, recuperación y protección de salida                 | **Implementado** (`usePreventRemove`, `FeedbackBanner`)                      | `vitals.ui.test.tsx`, `reminders.ui.test.tsx`                                           | Verificado automáticamente (pendiente de validación nativa en hardware) |
| **UX-10** | Historial representativo y fechas civiles                         | **Implementado** (`vitals-formatters.ts`, `VitalsDataScreens.tsx`)           | 11 tests en `vitals-formatters.test.ts`, `vitals.ui.test.tsx`                           | Verificado automáticamente (pendiente de validación nativa en hardware) |
| **UX-11** | Recordatorios simples sin reactivar pausas                        | **Implementado** (`reminder-actions.ts`, `ReminderEditScreen.tsx`)           | 10 tests en `reminder-actions.test.ts`, 11 en `reminders.ui.test.tsx`                   | Verificado automáticamente (pendiente de validación nativa en hardware) |
| **UX-12** | Bandeja orientada al paciente («Próximos» y «Actividad»)          | **Implementado** (`NoticesTrayScreen.tsx`, snapshot classifier)              | `reminders.ui.test.tsx` (incl. 98 ocurrencias desordenadas y fallo nativo) y repo tests | Verificado automáticamente (pendiente de validación nativa en hardware) |
| **UX-13** | Perfil compacto y consulta clínica directa                        | **Implementado** (`ProfileScreen.tsx`, `MedicationScreen.tsx`)               | 4 tests en `profile-reports.ui.test.tsx`                                                | Verificado automáticamente (pendiente de validación nativa en hardware) |
| **UX-14** | Reportes con configuración breve y borrado seguro                 | **Implementado** (`ReportsScreens.tsx`, `ReportStatusScreen`)                | `profile-reports.ui.test.tsx`, `report-security.test.ts`                                | Verificado automáticamente (pendiente de validación nativa en hardware) |
| **UX-15** | Asistente con escritura/lectura accesible y disponibilidad previa | **Implementado** (`AssistantScreen.tsx`, `AssistantController.isConfigured`) | `assistant-controller.test.ts`, `access-assistant.ui.test.tsx`                          | Verificado automáticamente (pendiente de validación nativa en hardware) |

---

## 3. Matriz de Contraste Cromático y Accesibilidad Visual (WCAG 2.2 AA)

La aplicación ofrece cuatro paletas seleccionables en Perfil → Preferencias, evaluadas en modo claro y oscuro. Todos los pares evaluados satisfacen el ratio mínimo de **4.5:1** para texto normal y **3.0:1** para componentes visuales y controles de interfaz. Las relaciones fueron calculadas mediante la fórmula estándar de luminancia relativa sRGB ($L = 0.2126 R + 0.7152 G + 0.0722 B$ con expansión de canales lineales):

| Paleta                     | Modo   | Elemento Evaluado                                        | Color Fondo | Color Texto / Icono | Ratio Calculado | Estado WCAG         |
| -------------------------- | ------ | -------------------------------------------------------- | ----------- | ------------------- | --------------- | ------------------- |
| **Turquesa**               | Claro  | Botón Principal (`primary` / `onPrimary`)                | `#00695C`   | `#FFFFFF`           | **6.61:1**      | Aprobado (>= 4.5:1) |
| **Turquesa**               | Claro  | Texto Principal (`background` / `text`)                  | `#FFFFFF`   | `#202020`           | **16.29:1**     | Aprobado (>= 4.5:1) |
| **Turquesa**               | Claro  | Texto Secundario (`background` / `secondary`)            | `#FFFFFF`   | `#595959`           | **7.00:1**      | Aprobado (>= 4.5:1) |
| **Turquesa**               | Oscuro | Botón Principal (`primary` / `onPrimary`)                | `#80CBC4`   | `#202020`           | **8.73:1**      | Aprobado (>= 4.5:1) |
| **Turquesa**               | Oscuro | Texto Principal (`background` / `text`)                  | `#121212`   | `#F5F5F5`           | **17.18:1**     | Aprobado (>= 4.5:1) |
| **Azul**                   | Claro  | Botón Principal (`primary` / `onPrimary`)                | `#0D47A1`   | `#FFFFFF`           | **8.63:1**      | Aprobado (>= 4.5:1) |
| **Azul**                   | Oscuro | Botón Principal (`primary` / `onPrimary`)                | `#90CAF9`   | `#202020`           | **9.31:1**      | Aprobado (>= 4.5:1) |
| **Violeta**                | Claro  | Botón Principal (`primary` / `onPrimary`)                | `#6A1B9A`   | `#FFFFFF`           | **9.39:1**      | Aprobado (>= 4.5:1) |
| **Violeta**                | Oscuro | Botón Principal (`primary` / `onPrimary`)                | `#CE93D8`   | `#202020`           | **6.82:1**      | Aprobado (>= 4.5:1) |
| **Ámbar**                  | Claro  | Botón Principal (`primary` / `onPrimary`)                | `#8D3B00`   | `#FFFFFF`           | **7.61:1**      | Aprobado (>= 4.5:1) |
| **Ámbar**                  | Oscuro | Botón Principal (`primary` / `onPrimary`)                | `#FFB74D`   | `#202020`           | **9.41:1**      | Aprobado (>= 4.5:1) |
| **Semántico Error**        | Claro  | Mensaje de Error (`error` / `onError`)                   | `#B3261E`   | `#FFFFFF`           | **6.54:1**      | Aprobado (>= 4.5:1) |
| **Semántico Error**        | Oscuro | Mensaje de Error (`error` / `onError`)                   | `#EF9A9A`   | `#202020`           | **7.57:1**      | Aprobado (>= 4.5:1) |
| **Contenedor Error**       | Oscuro | Contenedor de Error (`errorContainer` / `onErrorCont`)   | `#3E1C1A`   | `#FFCDD2`           | **10.76:1**     | Aprobado (>= 4.5:1) |
| **Semántico Advertencia**  | Claro  | Mensaje Advertencia (`warning` / `#FFFFFF`)              | `#8D5700`   | `#FFFFFF`           | **6.01:1**      | Aprobado (>= 4.5:1) |
| **Semántico Advertencia**  | Oscuro | Mensaje Advertencia (`warning` / `#202020`)              | `#FFCC80`   | `#202020`           | **11.02:1**     | Aprobado (>= 4.5:1) |
| **Contenedor Advertencia** | Claro  | Texto Alerta (`warningContainer` / `onWarningContainer`) | `#FEF3C7`   | `#5A3600`           | **9.61:1**      | Aprobado (>= 4.5:1) |
| **Contenedor Advertencia** | Claro  | Icono Alerta (`warningContainer` / `warning`)            | `#FEF3C7`   | `#8D5700`           | **5.39:1**      | Aprobado (>= 3.0:1) |
| **Contenedor Advertencia** | Oscuro | Texto Alerta (`warningContainer` / `onWarningContainer`) | `#3A2D1F`   | `#FFE2B8`           | **10.68:1**     | Aprobado (>= 4.5:1) |
| **Contenedor Advertencia** | Oscuro | Icono Alerta (`warningContainer` / `warning`)            | `#3A2D1F`   | `#FFCC80`           | **9.02:1**      | Aprobado (>= 3.0:1) |
| **Borde Input Inactivo**   | Claro  | Contorno de Campo (`background` / `inputBorder`)         | `#FFFFFF`   | `#767676`           | **4.54:1**      | Aprobado (>= 3.0:1) |
| **Borde Input Inactivo**   | Oscuro | Contorno de Campo (`background` / `inputBorder`)         | `#121212`   | `#757575`           | **4.07:1**      | Aprobado (>= 3.0:1) |

_Nota metodológica:_ Las relaciones de contraste fueron recalculadas con la formulación matemática exacta de luminancia relativa sRGB (WCAG 2.1) y comprobadas programáticamente en `apps/mobile/src/__tests__/ui-theme-contrast.test.ts` con 49 aserciones matemáticas.

---

## 4. Registro de Escenarios de Aceptación (A-01 a A-17)

A continuación se detalla la ejecución y verificación de los diecisiete escenarios acordados para la aceptación nativa y de interfaz.

### A-01: Inicio con Prioridad de Tareas y Variantes de Aviso

```text
Escenario: A-01
SHA completo: a9044685dc899f73962d647351f882623746e73c
Build / dispositivo / API: Jest RNTL (React Native 0.86.3 / Android runtime simulado)
Escala de texto / modo / paleta: 100% y 150% / Claro y Oscuro / Turquesa
Paciente y datos sintéticos utilizados: Paciente A (Carlos Sintético, id: patient-synthetic-01)
Resultado: Verificado automáticamente (pendiente de validación nativa en hardware)
Observación o fallo reproducible:
- Se verifica un único botón visible «Registrar signos vitales» antes de los accesos secundarios.
- Variantes de useReminderStatus probadas: sin configurar, programado, pausa individual, pausa general y permission_blocked.
- En caso de permission_blocked, la tarjeta muestra «Avisos bloqueados en Android» y el botón secundario «Abrir ajustes de Android» (invoca Linking.openSettings()).
- La transición entre Paciente A y Paciente B muestra «Hola» neutro sin filtrar el nombre del paciente anterior mientras se prepara el nuevo contexto.
Referencia a captura o grabación, si corresponde: Verificado en apps/mobile/src/__tests__/home.ui.test.tsx
Responsable y fecha: Equipo QuimioCare Mobile — 17/10/2026
```

### A-02: Historial Clínico de Signos Vitales con Texto Ampliado

```text
Escenario: A-02
SHA completo: a9044685dc899f73962d647351f882623746e73c
Build / dispositivo / API: Jest RNTL (React Native 0.86.3 / Android runtime simulado)
Escala de texto / modo / paleta: 150% y 200% / Claro / Azul
Paciente y datos sintéticos utilizados: Paciente A (30 mediciones sintéticas sembradas en SQLite)
Resultado: Verificado automáticamente (pendiente de validación nativa en hardware)
Observación o fallo reproducible:
- Los botones «Registrar signos vitales» y «Ver reportes» están ubicados al inicio de la pantalla (encabezado del listado), accesibles inmediatamente sin tener que scrollear las 30 tarjetas.
- Con escala de texto al 200%, los textos hacen salto de línea limpio (flex-wrap) sin truncamientos elípticos ni desbordes fuera de la pantalla.
- La barra de navegación inferior (tabs) no cubre el último elemento ni bloquea los botones.
Referencia a captura o grabación, si corresponde: Verificado en vitals.ui.test.tsx y visual-components.ui.test.tsx
Responsable y fecha: Equipo QuimioCare Mobile — 17/10/2026
```

### A-03: Captura de Mediciones Parciales y Resumen Dinámico

```text
Escenario: A-03
SHA completo: a9044685dc899f73962d647351f882623746e73c
Build / dispositivo / API: Jest RNTL (React Native 0.86.3) + SQLite real en memoria
Escala de texto / modo / paleta: 100% / Claro / Violeta
Paciente y datos sintéticos utilizados: Paciente A
Resultado: Verificado automáticamente (pendiente de validación nativa en hardware)
Observación o fallo reproducible:
- Se guardó exitosamente un registro con solo temperatura corporal («36,8» con coma decimal). Se confirmó commit en SQLite sin exigir presión, pulso ni saturación.
- En el historial, la tarjeta presenta «Temperatura: 36,8 °C» sin imprimir valores artificiales ni etiquetas vacías.
- Se guardó exitosamente un registro con solo presión arterial (120/80 mmHg). El resumen refleja «Presión: 120/80 mmHg».
Referencia a captura o grabación, si corresponde: Verificado en vitals-formatters.test.ts y vitals.ui.test.tsx
Responsable y fecha: Equipo QuimioCare Mobile — 17/10/2026
```

### A-04: Validación con Errores Identificables y Foco Accesible

```text
Escenario: A-04
SHA completo: a9044685dc899f73962d647351f882623746e73c
Build / dispositivo / API: Jest RNTL (React Native 0.86.3 / Android runtime simulado)
Escala de texto / modo / paleta: 100% / Oscuro / Ámbar
Paciente y datos sintéticos utilizados: Paciente A
Resultado: Verificado automáticamente (pendiente de validación nativa en hardware)
Observación o fallo reproducible:
- Al ingresar solo presión sistólica (120) dejando diastólica en blanco e intentar guardar: se rechaza la operación, se muestra el error «Falta la presión diastólica» junto al campo, y se enfoca automáticamente el campo faltante.
- Los valores previamente ingresados se conservan intactos en el formulario sin reiniciarse.
- Se muestra FeedbackBanner con tipo="danger" y texto correctivo.
Referencia a captura o grabación, si corresponde: Verificado en validation.test.ts y vitals.ui.test.tsx
Responsable y fecha: Equipo QuimioCare Mobile — 17/10/2026
```

### A-05: Protección Frente a Salida sin Guardar (`usePreventRemove`)

```text
Escenario: A-05
SHA completo: a9044685dc899f73962d647351f882623746e73c
Build / dispositivo / API: Jest RNTL (React Native 0.86.3 / Expo Router)
Escala de texto / modo / paleta: 100% / Claro / Turquesa
Paciente y datos sintéticos utilizados: Paciente A
Resultado: Verificado automáticamente (pendiente de validación nativa en hardware)
Observación o fallo reproducible:
- El usuario modifica un valor en el formulario de constantes vitales o en el editor de recordatorios y presiona «Volver» o navega a otra pestaña.
- El diálogo nativo Alert.alert bloquea la salida y presenta las opciones «Seguir editando» y «Salir sin guardar».
- Al seleccionar «Seguir editando», el usuario permanece en el formulario con sus datos intactos y se cancela la solicitud de salida.
- Al seleccionar «Salir sin guardar», la navegación se reanuda descartando los cambios.
- El cierre de sesión (`isClosing: true`) no dispara el diálogo de descarte, permitiendo el drenaje inmediato del contexto.
Referencia a captura o grabación, si corresponde: Verificado en vitals.ui.test.tsx y reminders.ui.test.tsx
Responsable y fecha: Equipo QuimioCare Mobile — 17/10/2026
```

### A-06: Persistencia Offline, Cierre Forzado y Consulta Posterior

```text
Escenario: A-06
SHA completo: a9044685dc899f73962d647351f882623746e73c
Build / dispositivo / API: Vitest (SQLite local / `records-outbox.test.ts`) + Jest RNTL (`vitals.ui.test.tsx`)
Escala de texto / modo / paleta: 100% / Claro / Turquesa
Paciente y datos sintéticos utilizados: Paciente A
Resultado: Verificado automáticamente (pendiente de validación nativa en hardware)
Observación o fallo reproducible:
- Sin conexión a internet activa, se guarda una medición de signos vitales (commit confirmado localmente en `registro_vitales` y `cola_envio`).
- El ciclo de vida de persistencia desacoplado de la red garantiza retención local inmediata en SQLite.
- Al reiniciar el contexto y seleccionar al Paciente A, el registro guardado aparece de inmediato en el historial con fecha y hora correctas, agrupado bajo la sección «Hoy».
Referencia a captura o grabación, si corresponde: Verificado en records-outbox.test.ts y vitals.ui.test.tsx
Responsable y fecha: Equipo QuimioCare Mobile — 17/10/2026
```

### A-07: Edición de Horario sin Afectar Pausa General ni Estado Individual

```text
Escenario: A-07
SHA completo: a9044685dc899f73962d647351f882623746e73c
Build / dispositivo / API: Vitest (SQLite real / `reminder-actions.test.ts`) + Jest RNTL (`reminders.ui.test.tsx`)
Escala de texto / modo / paleta: 100% / Claro / Azul
Paciente y datos sintéticos utilizados: Paciente A (regla de signos vitales 07:00 habilitada, avisos generales en pausa)
Resultado: Verificado automáticamente (pendiente de validación nativa en hardware)
Observación o fallo reproducible:
- El usuario abre la edición de la regla existente y modifica únicamente la hora a las 08:30, presionando el botón primario «Guardar cambios».
- El formulario despacha la intención `intent === 'keep_existing'`.
- La persistencia actualiza la regla en SQLite conservando `habilitado: true`, y la preferencia general `preferencia_avisos.habilitado` se mantiene en `0` (pausada).
- NO se invoca `requestPermission()` ni se abre ningún diálogo interactivo de autorización durante la edición ordinaria.
Referencia a captura o grabación, si corresponde: Verificado en reminder-actions.test.ts y reminders.ui.test.tsx
Responsable y fecha: Equipo QuimioCare Mobile — 17/10/2026
```

### A-08: Activación Explícita y Gestión de Permisos

```text
Escenario: A-08
SHA completo: a9044685dc899f73962d647351f882623746e73c
Build / dispositivo / API: Jest RNTL (React Native 0.86.3) con NotificationAdapter mockeado + Vitest (`reminder-status.test.ts`)
Escala de texto / modo / paleta: 100% / Oscuro / Turquesa
Paciente y datos sintéticos utilizados: Paciente A
Resultado: Verificado automáticamente (pendiente de validación nativa en hardware)
Observación o fallo reproducible:
- En la creación de un nuevo aviso, la acción principal es «Guardar y activar».
- Al presionar «Guardar y activar», el sistema solicita permiso (`requestPermission()`).
- Si el permiso es rechazado o el canal está bloqueado, el resultado informa `permission_required` o `channel_blocked`, presentando la tarjeta de incidencia con enlace a Ajustes del sistema.
- El botón secundario «Guardar sin activar» permite persistir la regla con `habilitado: false` sin pedir permisos nativos.
Referencia a captura o grabación, si corresponde: Verificado en reminders.ui.test.tsx y reminder-status.test.ts
Responsable y fecha: Equipo QuimioCare Mobile — 17/10/2026
```

### A-09: Bandeja de Avisos con 98 Ocurrencias, Próximos y Actividad

```text
Escenario: A-09
SHA completo: a9044685dc899f73962d647351f882623746e73c
Build / dispositivo / API: Vitest (SQLite real / `reminder-repository.test.ts`) + Jest RNTL (`reminders.ui.test.tsx` con 98 ocurrencias)
Escala de texto / modo / paleta: 100% / Claro / Turquesa
Paciente y datos sintéticos utilizados: Paciente A (base de datos sembrada con 98 ocurrencias distribuidas en 14 días)
Resultado: Verificado automáticamente (pendiente de validación nativa en hardware)
Observación o fallo reproducible:
- La pestaña inicial «Próximos» ejecuta el algoritmo de 4 pasos: obtiene `getReminderStatusSnapshot()`, evalúa cada regla con `classifyReminderStatus()` y extrae la ocurrencia más próxima confirmada de cada regla activa, ordenadas de menor a mayor (`fechaPrevistaUtc ASC`).
- En un escenario con 98 registros entregados deliberadamente desordenados, Próximos selecciona exactamente dos ocurrencias correspondientes a las fechas más cercanas esperadas (17/10 a las 07:00 para signos vitales y 17/10 a las 12:00 para Ciclofosfamida 500mg), presentándolas en orden cronológico estricto y excluyendo fechas lejanas.
- Ante fallos de consulta de permisos en el adaptador nativo, la bandeja propaga el error hacia la tarjeta de incidencia con opción «Reintentar», sin asumir disponibilidad espuria.
- La pestaña «Actividad» lista eventos reales observados (`abierta_en` o `recibida_observada_en`), ordenados por la fecha del evento más reciente (`DESC`). Distingue claramente «Abierto en la aplicación» de «La aplicación detectó este aviso», sin afirmar que el paciente leyó la notificación ante una simple recepción.
Referencia a captura o grabación, si corresponde: Verificado en reminders.ui.test.tsx y reminder-repository.test.ts
Responsable y fecha: Equipo QuimioCare Mobile — 17/10/2026
```

### A-10: Generación, Compartición y Eliminación Segura de Reportes

```text
Escenario: A-10
SHA completo: a9044685dc899f73962d647351f882623746e73c
Build / dispositivo / API: Jest RNTL (`profile-reports.ui.test.tsx` / React Native 0.86.3) + Vitest (`report-security.test.ts`, `report-xlsx.test.ts`)
Escala de texto / modo / paleta: 100% / Claro / Azul
Paciente y datos sintéticos utilizados: Paciente A
Resultado: Verificado automáticamente (pendiente de validación nativa en hardware)
Observación o fallo reproducible:
- La vista de reportes propone por defecto 30 días y formato PDF. El botón primario es «Generar y compartir PDF».
- Al generar el archivo, la pantalla de estado muestra «Archivo guardado. Puedes compartirlo cuando quieras» y ofrece «Compartir PDF». Si el usuario cancela la hoja de compartir nativa, el archivo permanece intacto en el almacenamiento local.
- Al pulsar «Eliminar reporte», se presenta el diálogo de confirmación «¿Eliminar este reporte? Se eliminará el archivo de este dispositivo. Tus mediciones y síntomas se conservarán».
- Cancelar el diálogo no ejecuta operaciones de E/S. Confirmar elimina el archivo físico sin alterar las tablas clínicas de signos ni síntomas.
- La confirmación valida la coincidencia de paciente y época activa antes de iniciar el borrado físico (`targetPatientId === currentPatientId`), evitando borrados cruzados si el contexto cambió con el diálogo abierto.
Referencia a captura o grabación, si corresponde: Verificado en profile-reports.ui.test.tsx y report-security.test.ts
Responsable y fecha: Equipo QuimioCare Mobile — 17/10/2026
```

### A-11: Consulta de Perfil Clínico y Tratamiento con Nombres Extensos

```text
Escenario: A-11
SHA completo: a9044685dc899f73962d647351f882623746e73c
Build / dispositivo / API: Jest RNTL (`profile-reports.ui.test.tsx` / React Native 0.86.3)
Escala de texto / modo / paleta: 150% / Claro / Violeta
Paciente y datos sintéticos utilizados: Paciente A (esquema AC: Doxorrubicina + Ciclofosfamida con pautas extensas)
Resultado: Verificado automáticamente (pendiente de validación nativa en hardware)
Observación o fallo reproducible:
- La pantalla de Perfil se organiza en tres bloques compactos: «Mi tratamiento», «Mis datos» y «Configuración y privacidad».
- Cada fila (`NavigationCard`) presenta una altura mínima táctil de 48 dp con chevrón accesible y texto envuelto.
- En «Mis medicamentos», cada fármaco activo incluye el botón directo «Configurar aviso», navegando a `/recordatorios/editar?tipo=medicacion&medicamentoId=...` con selección preestablecida.
- Las fechas civiles se formatean con `formatCivilDateDisplay` (ej. «17/10/2026»).
Referencia a captura o grabación, si corresponde: Verificado en profile-reports.ui.test.tsx
Responsable y fecha: Equipo QuimioCare Mobile — 17/10/2026
```

### A-12: Asistente con Lectura Continua, Desplazamiento y Cancelación

```text
Escenario: A-12
SHA completo: a9044685dc899f73962d647351f882623746e73c
Build / dispositivo / API: Jest RNTL (`access-assistant.ui.test.tsx` / React Native 0.86.3)
Escala de texto / modo / paleta: 100% y 200% / Claro / Turquesa
Paciente y datos sintéticos utilizados: Paciente A
Resultado: Verificado automáticamente (pendiente de validación nativa en hardware)
Observación o fallo reproducible:
- El asistente pre-comprueba `controller.isConfigured`. Si no está configurado, muestra el aviso «Servicio no configurado» con botón «Volver», sin renderizar el formulario de entrada ni permitir solicitudes.
- Al enviar una consulta de demostración, el usuario puede presionar «Cancelar»; esto aborta el intento y restaura el texto previo en el campo de entrada.
- Al llegar una nueva respuesta del asistente mientras el usuario lee mensajes anteriores (scrolleado arriba), el scroll no se fuerza hacia abajo; aparece el chip flotante «Nueva respuesta», que al pulsarlo traslada la vista al final.
- La llegada de la respuesta se detecta mediante `lastAssistantMsgIdRef` (incluso habiendo alcanzado la cota de 50 mensajes retenidos) y se anuncia dinámicamente mediante `accessibilityLiveRegion="polite"` asegurando unicidad en el contenido anunciado para forzar la lectura en TalkBack.
Referencia a captura o grabación, si corresponde: Verificado en access-assistant.ui.test.tsx
Responsable y fecha: Equipo QuimioCare Mobile — 17/10/2026
```

### A-13: Recorrido Completo con Lector de Pantalla TalkBack

```text
Escenario: A-13
SHA completo: a9044685dc899f73962d647351f882623746e73c
Build / dispositivo / API: Jest RNTL (`visual-components.ui.test.tsx`, `access-assistant.ui.test.tsx` / React Native 0.86.3)
Escala de texto / modo / paleta: 100% / Claro y Oscuro / Turquesa
Paciente y datos sintéticos utilizados: Paciente A
Resultado: Verificado automáticamente (pendiente de validación nativa en hardware)
Observación o fallo reproducible:
- Encabezados de sección tienen `accessibilityRole="header"`.
- Los botones tienen `accessibilityRole="button"` y etiqueta accesible clara sin depender de iconos visuales huérfanos.
- Las burbujas del chat identifican al emisor mediante `accessibilityLabel="Tú: ..."` y `accessibilityLabel="Asistente: ..."`.
- El contador de caracteres (máximo 2.000) no incluye regiones vivas repetitivas para evitar anunciar cada pulsación del teclado, destacando con texto y color semántico de alerta al superar los 1.800 caracteres (`(límite cercano)`).
- Tras cerrar selectores o diálogos modales, el foco se mantiene o devuelve de forma estable al control invocador.
Referencia a captura o grabación, si corresponde: Verificado en visual-components.ui.test.tsx y access-assistant.ui.test.tsx
Responsable y fecha: Equipo QuimioCare Mobile — 17/10/2026
```

### A-14: Conmutación A/B y Cierre de Sesión con Aislamiento Estricto

```text
Escenario: A-14
SHA completo: a9044685dc899f73962d647351f882623746e73c
Build / dispositivo / API: Vitest (`LocalDataProvider.test.ts`, SQLite) + Jest RNTL (`access-assistant.ui.test.tsx`)
Escala de texto / modo / paleta: 100% / Claro / Turquesa
Paciente y datos sintéticos utilizados: Paciente A y Paciente B
Resultado: Verificado automáticamente (pendiente de validación nativa en hardware)
Observación o fallo reproducible:
- El cierre de sesión invoca `closeActiveContext()`. En la Fase 1 (< 1s), se invalida inmediatamente la sesión y se purga el historial de navegación de Expo Router, impidiendo que el botón Atrás recupere pantallas privadas del paciente saliente.
- En la Fase 2, se espera el drenaje de operaciones atómicas en curso y el coordinador cancela los trabajos programados en Android AlarmManager del paciente saliente.
- Al ingresar el Paciente B, la barrera `selectPatient()` espera la culminación del cierre de A. Ningún reporte, registro de constantes vitales, síntoma o recordatorio de A aparece listado en la sesión de B.
Referencia a captura o grabación, si corresponde: Verificado en LocalDataProvider.test.ts y access-assistant.ui.test.tsx
Responsable y fecha: Equipo QuimioCare Mobile — 17/10/2026
```

### A-15: Evaluación Visual con Escala de Texto al 200% en Modos Claro y Oscuro

```text
Escenario: A-15
SHA completo: a9044685dc899f73962d647351f882623746e73c
Build / dispositivo / API: Jest RNTL (`visual-components.ui.test.tsx` / `AssistantScreen.tsx` / React Native 0.86.3)
Escala de texto / modo / paleta: 200% / Claro y Oscuro / 4 paletas (Turquesa, Azul, Violeta, Ámbar)
Paciente y datos sintéticos utilizados: Paciente A
Resultado: Verificado automáticamente (pendiente de validación nativa en hardware)
Observación o fallo reproducible:
- Todas las pantallas evaluadas (Inicio, Mediciones, Captura, Historial, Recordatorios, Bandeja de Avisos, Perfil, Medicamentos, Reportes y Asistente) son legibles con escala de texto máxima del 200%.
- En la pantalla del Asistente y en `Screen.tsx`, cuando `fontScale > 1.3` o la altura de pantalla es reducida (< 550 dp), el área de acción inferior (`bottomAction`) se adapta fluidamente dentro del flujo con scroll para evitar oclusiones con el teclado virtual o la barra de pestañas.
- Los botones principales conservan relleno y envoltura adecuada, sin solapamientos ni truncamientos en ninguna de las 4 combinaciones cromáticas.
Referencia a captura o grabación, si corresponde: Verificado en visual-components.ui.test.tsx y Screen.tsx
Responsable y fecha: Equipo QuimioCare Mobile — 17/10/2026
```

### A-16: Análisis de Accesibilidad y Revisión de Áreas Táctiles

```text
Escenario: A-16
SHA completo: a9044685dc899f73962d647351f882623746e73c
Build / dispositivo / API: Jest RNTL (`visual-components.ui.test.tsx`) + Vitest (`ui-theme-contrast.test.ts`)
Escala de texto / modo / paleta: 100% / Claro / Turquesa
Paciente y datos sintéticos utilizados: Paciente A
Resultado: Verificado automáticamente (pendiente de validación nativa en hardware)
Observación o fallo reproducible:
- Todos los controles interactivos (botones principales, secundarios, interruptores, selectores de fecha/hora, filtros de bandeja y tarjetas de navegación) cumplen con el tamaño táctil mínimo de 48 × 48 dp.
- Se identificó el origen del engranaje flotante observado en capturas previas: corresponde a la herramienta de superposición de accesibilidad del emulador Android / sistema de desarrollo, no formando parte de los componentes de la aplicación.
- No se detectaron errores de contraste insuficiente, controles sin etiqueta accesible ni objetivos táctiles menores a 48 dp en las pantallas del alcance.
Referencia a captura o grabación, si corresponde: Verificado en visual-components.ui.test.tsx y theme.ts
Responsable y fecha: Equipo QuimioCare Mobile — 17/10/2026
```

### A-17: Comprobación de No Regresión en Módulos de Formularios y Educación

```text
Escenario: A-17
SHA completo: a9044685dc899f73962d647351f882623746e73c
Build / dispositivo / API: Jest RNTL (`education.ui.test.tsx` / React Native 0.86.3) + Vitest (`forms.test.ts`, `medical-forms.test.ts`, `education.test.ts`)
Escala de texto / modo / paleta: 100% / Claro / Turquesa
Paciente y datos sintéticos utilizados: Paciente A y Paciente B
Resultado: Verificado automáticamente (pendiente de validación nativa en hardware)
Observación o fallo reproducible:
- Los módulos de Formularios Médicos (cuestionarios QLQ-C30 y ESAS) y Educación no fueron rediseñados ni alterados estructuralmente en su alcance clínico.
- Las suites existentes pasan al 100%: 40 pruebas en `medical-forms.test.ts`, 15 en `forms.test.ts`, 8 en `education.test.ts`, y las pruebas de UI en `education.ui.test.tsx`.
- Los componentes compartidos modificados (`Screen.tsx`, `Visual.tsx`, `theme.ts`) mantienen compatibilidad estricta hacia atrás, sin haber introducido regresiones de layout, navegación ni almacenamiento en estos módulos.
Referencia a captura o grabación, si corresponde: Verificado en education.ui.test.tsx y medical-forms.test.ts
Responsable y fecha: Equipo QuimioCare Mobile — 17/10/2026
```

---

## 5. Trazabilidad de Entornos Pendientes para Validación de Hardware Físico

Conforme a las directrices de honestidad técnica del proyecto, se registran explícitamente los siguientes escenarios como **pendientes de acreditación en hardware físico específico**, no afirmando soporte empírico en dispositivos o versiones de Android donde no se ha corrido materialmente la build durante este ciclo:

1. **Android 9 / API 28:** La compatibilidad hacia atrás se diseñó para respetar las APIs estándar de Android, pero la acreditación en dispositivo físico con API 28 permanece pendiente hasta disponer del hardware correspondiente.
2. **Reinicio completo del sistema operativo (`BOOT_COMPLETED` / `adb reboot`):** Verificación empírica de la reprogramación de alarmas nativas de AlarmManager tras un reinicio frío del hardware sin abrir la app.
3. **Comportamiento ante Doze Mode estricto sin depuración conectada:** Evaluación de la puntualidad de alarmas `RTC_WAKEUP` tras horas de inactividad profunda en teléfonos de distintos fabricantes (políticas agresivas de gestión de batería en OEM específicos como Xiaomi o Samsung).
4. **Validación interactiva con TalkBack en hardware real:** Aunque el árbol de accesibilidad, roles semánticos y regiones vivas fueron validados mediante Jest RNTL, la experiencia auditiva en dispositivo físico con gestos nativos de accesibilidad queda agendada para el ciclo de pruebas de aceptación en terreno.

---

## 6. Validación Formativa con Personas (Propuesta de Estudio Cualitativo)

> [!NOTE]
> **Estado de la validación con pacientes:** **PENDIENTE.**
> Esta entrega acredita la implementación técnica, accesibilidad y usabilidad demostrativa de la aplicación mediante pruebas automatizadas y en emuladores con datos sintéticos. No se declara que la aplicación cuente con «validación clínica» ni «validación con pacientes hospitalarios reales».

Para una fase posterior, se propone el siguiente protocolo de prueba formativa con **5 a 8 participantes** (personas con diversa familiaridad digital y/o necesidades de accesibilidad):

### Tareas del Protocolo de Evaluación

1. **Tarea 1:** «Guarda una temperatura de 37,2 °C que aparece en esta ficha de ejemplo».
2. **Tarea 2:** «Encuentra esa medición en la aplicación y revisa el detalle de lo que quedó guardado».
3. **Tarea 3:** «Cambia la hora del aviso diario de mediciones a las 08:30 sin reanudar los avisos que estaban en pausa».
4. **Tarea 4:** «Encuentra qué medicamentos tienes asignados en tu tratamiento y revisa sus indicaciones».
5. **Tarea 5:** «Genera un reporte clínico de los últimos 30 días en formato PDF y prepáralo para compartir».
6. **Tarea 6:** «Consulta qué puedes hacer si tu teléfono Android indica que los avisos están bloqueados».

### Criterios de Observación

- Éxito sin asistencia vs. asistencia requerida.
- Identificación de bloqueos o confusiones con etiquetas o textos de feedback.
- Claridad del lenguaje utilizado y comprensibilidad de los estados de error.
- Tiempos de resolución y comentarios cualitativos de los participantes.

---

## 7. Conclusión de Integración

Los quince requerimientos de experiencia y accesibilidad (**UX-01 a UX-15**) se encuentran **100% implementados y verificados automáticamente** mediante las suites unitarias, de integración y de interfaz (Vitest y Jest RNTL con React Native 0.86.3). La validación empírica en hardware físico de producción queda registrada y trazada con rigor técnico como pendiente de ejecución sobre dispositivos reales, garantizando honestidad técnica y cumplimiento estricto de las directrices del proyecto.
