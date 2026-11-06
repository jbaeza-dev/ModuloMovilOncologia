# Aplicaciones

Este directorio agrupa las aplicaciones del monorrepositorio QuimioCare:

- `mobile/`: aplicación móvil Android con React Native, Expo, TypeScript y Expo Router. Incluye seguimiento de quimioterapia, registro de signos vitales y síntomas ePRO, catálogo educativo offline con descargas verificadas, recordatorios y agenda compartida, exportación clínica local (PDF/XLSX) y sincronización reactiva PowerSync.
- `gateway/`: pasarela operativa para autenticación de dispositivos, gestión de tokens push, agenda compartida y coordinación con servicios de backend.
- `simulator/`: simulador de servicios clínicos e IA con persistencia real en PostgreSQL, soporte de protocolos oncológicos demostrativos (mFOLFOX6), gestión de pacientes, material educativo y documentación OpenAPI / Swagger interactiva.

Los servicios de gateway y simulador se encuentran plenamente integrados y operativos tanto en entorno de desarrollo local como en el despliegue de demostración académica.
