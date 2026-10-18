# Registro de Decisiones y Ambigüedades del Instrumento ePRO

**Documento fuente revisado:** `Cuestionario de Seguimiento Domiciliario en Quimioterapia.docx`  
**Estado:** Fixtures técnicos demostrativos v1.1.0 alineados al 100% con el Word (v1.0.0 preservada para inmutabilidad y entregas históricas en SQLite).  
**Fecha:** 18 de octubre de 2026.

---

## 1. Registro de Decisiones Clínicas y Técnicas (CL-01 a CL-09)

| ID        | Hallazgo en el documento fuente                                                                                                        | Tratamiento técnico implementado en esta rama                                                                                                                                                                                | Estado de Aprobación           |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **CL-01** | La instrucción de salto del Módulo 7 menciona P7.1 y P7.2, pero solo está redactada la pregunta P7.1 en la fuente.                     | Se implementan con estricta fidelidad las 41 preguntas definidas. No se inventa la definición ni alternativas de P7.2.                                                                                                       | Provisional de prueba técnica  |
| **CL-02** | La instrucción de P2 indica habilitar P2.1 a P2.4 si P2 = 'Sí', pero P2.4 formula «Si vomitaste, ¿notaste algo extraño en el vómito?». | Se modela una condición positiva estricta: `P2 = 'si'` Y `P2.2 in ['vomito_1_2', 'vomito_3_5', 'vomito_6_mas']`. Si P2.2 es 'no_vomito' o no está respondida, P2.4 permanece oculta.                                         | Provisional de prueba técnica  |
| **CL-03** | P1.2 mide temperatura corporal con termómetro axilar o bucal y provee 5 alternativas cerradas.                                         | Se respetan con fidelidad las 5 alternativas del Word: `< 37.5 (Normal)`, `37.5-37.9 (Febrícula)`, `38-38.2 mantenida > 1h`, `38.3 o más` y `No me he tomado la temperatura`.                                                | Fiel al instrumento            |
| **CL-04** | P5.2 menciona sensibilidad al frío propia de quimioterapia con Oxaliplatino.                                                           | Se muestra de forma condicional a `P5 = 'si'` para cualquier paciente asignado al cuestionario, sin inferir reglas a partir del esquema oncológico.                                                                          | Provisional de prueba técnica  |
| **CL-05** | P5.3 compara con un ciclo previo («¿peor que en el ciclo anterior?»).                                                                  | Se presenta como alternativa dentro de P5 sin auto-selección ni descarte automático en pacientes de primer ciclo.                                                                                                            | Pendiente de criterio clínico  |
| **CL-06** | P6.2 formula «En la vena del brazo donde te pasaron la quimioterapia (si no usas catéter central), ¿notaste algo?».                    | Se modela la condición provisional positiva `{ op: 'all', conditions: [{ op: 'eq', questionId: 'P6', value: 'si' }, { op: 'eq', questionId: 'P0.1', value: 'no' }] }` para evaluar la ausencia de catéter reportada en P0.1. | Provisional de prueba técnica  |
| **CL-07** | P2.3 y P9.B.2 presuponen medicamentos indicados por el médico tratante.                                                                | Se conservan exactamente las alternativas del Word: P2.3 incluye «No los puedo tomar porque los vomito apenas los trago» y P9.B.2 incluye «El dolor no se pasa con nada o apareció de forma súbita y muy violenta».          | Fiel al instrumento            |
| **CL-08** | Preguntas de selección múltiple (como P0.1.1, P1.4 y P3.A.3) contienen opciones de normalidad junto a síntomas molestos.               | Se tipa `esExcluyente: true` en las opciones de normalidad aprobadas (ej. «Ninguna de las anteriores»), desmarcando automáticamente las demás alternativas al seleccionarla.                                                 | Comportamiento técnico probado |
| **CL-09** | El Word contiene instrucciones de semáforo clínico (verde, amarillo, rojo) y sugerencias de notificación al equipo de salud.           | La aplicación registra y persiste las respuestas localmente como seguimiento del paciente; **no se calcula gravedad, triaje automatizado ni alerta remota** en esta fase móvil.                                              | Fuera del alcance actual       |

---

## 2. Garantía de Aislamiento Dinámico

El motor de formularios interpreta definiciones versionadas de forma dinámica. Toda decisión técnica documentada se encuentra encapsulada dentro del fixture de demostración (`seguimiento-domiciliario.ts`) y nunca como reglas cableadas en la lógica del motor o los componentes visuales.
