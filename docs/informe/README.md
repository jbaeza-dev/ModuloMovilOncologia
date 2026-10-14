# Plantilla de Informe de Memoria de Título (LaTeX)

Este directorio contiene la plantilla oficial en LaTeX entregada para la memoria de título:
**"Aplicación Móvil de Acompañamiento para Pacientes Oncológicos" (QuimioCare)**.

## Estructura de archivos

- `main.tex`: Documento principal que configura paquetes, márgenes, estilos APA (`biblatex` con backend `biber`) e incluye los capítulos.
- `bibliografia.bib`: Archivo BibTeX para citas y referencias bibliográficas en formato APA.
- `preliminares/`:
  - `Portada.tex`: Portada oficial con autores (Javier Baeza Toro y Angel Montecino Flores), profesor guía (Dr. Miguel Esteban Romero Vásquez) e institución (Universidad del Bío-Bío).
  - `Conclusiones.tex`: Conclusiones del proyecto.
  - `Anexos.tex`: Material complementario y anexos técnicos.
- `capitulos/`:
  - `Introduccion.tex`: Introducción y contexto general.
  - `Capitulo2.tex`: Definición de la empresa / contexto institucional.
  - `Capitulo3.tex`: Definición del proyecto (problema, justificación, objetivos).
  - `Capitulo4.tex`: Especificación de requerimientos (funcionales y no funcionales).
  - `Capitulo5.tex`: Factibilidad (técnica, operativa, económica).
  - `Capitulo6.tex`: Análisis (modelado, casos de uso, procesos).
  - `Capitulo7.tex`: Diseño (arquitectura, MER, diseño de interfaz).
  - `Capitulo8.tex`: Pruebas (estrategia de pruebas, resultados, validación).
  - `Capitulo9.tex`: Plan de Capacitación y entrenamiento.
  - `Capitulo10.tex`: Plan de Implantación y Puesta en marcha.
- `imagenes/`: Logos institucionales (incluyendo `EscudoEscuelaICI.pdf`), diagramas y capturas.

## Compilación automática

El repositorio cuenta con un flujo de GitHub Actions (`.github/workflows/informe.yml`) que compila `main.tex` con `biber` cada vez que se suben cambios a `docs/informe/`. El PDF resultante queda disponible para descargar en la pestaña **Actions** de GitHub como artefacto `Informe-QuimioCare-PDF`.
