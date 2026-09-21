# Aplicaciones

Este directorio agrupará las aplicaciones desplegables del monorrepositorio:

- `mobile/`: aplicación Android con React Native, Expo, TypeScript y Expo Router.
- `gateway/`: pasarela para chatbot y funciones asociadas al dispositivo.
- `central-api-simulator/`: simulador local de la API clínica con datos ficticios.

Cada aplicación se incorporará en su propia rama y pull request. El gateway no intermediará las
escrituras clínicas ni la sincronización de PowerSync.
