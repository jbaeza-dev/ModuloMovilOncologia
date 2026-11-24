/**
 * Avisos de diagnóstico solo para desarrollo. En el APK no se escribe nada: el registro de
 * Android se puede leer con `adb logcat` y los errores pueden traer rutas, URL o datos internos.
 */
export function devWarn(message: string, ...details: unknown[]): void {
  // eslint-disable-next-line no-console -- único punto autorizado para escribir en la consola.
  if (__DEV__) console.warn(message, ...details);
}
