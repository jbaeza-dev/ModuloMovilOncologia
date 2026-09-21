# Paquetes compartidos

Este directorio contendrá paquetes reutilizables por más de una aplicación:

- `contracts/`: contratos y esquemas TypeScript acordados con el módulo central.
- `test-fixtures/`: datos sintéticos reutilizables en pruebas, cuando sean necesarios.

No se publicarán en el registro npm. Cada paquete deberá declarar su propio `package.json` y sus
comandos de validación.
