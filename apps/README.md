# Aplicaciones

Este directorio agrupará las aplicaciones desplegables del monorrepositorio:

- `mobile/`: base de la aplicación Android con React Native, Expo, TypeScript y Expo Router; sin integración clínica todavía.
- `gateway/`: pasarela para chatbot y funciones asociadas al dispositivo.
- `central-api-simulator/`: simulador local de la API clínica con datos ficticios.

La pasarela y el simulador se incorporarán en sus propias ramas y pull requests. El gateway no
intermediará las escrituras clínicas ni la sincronización de PowerSync.
