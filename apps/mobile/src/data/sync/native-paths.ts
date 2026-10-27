/** expo-sqlite returns an Android filesystem path; Expo File requires a URI. */
export function sqliteDirectoryUri(path: string): string {
  if (path.startsWith('file://')) return path;
  if (!path.startsWith('/')) throw new Error('El directorio SQLite no es absoluto.');
  return 'file://' + path;
}
