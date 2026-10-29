export interface FileCipher {
  protect(path: string, plaintext: Uint8Array): Promise<Uint8Array>;
  unprotect(path: string, ciphertext: Uint8Array): Promise<Uint8Array>;
  owns(path: string): boolean;
  directory?(
    root: 'reportes_locales' | 'formularios_locales' | 'recursos_educativos',
    patientId: string,
  ): string;
}
let active: { cipher: FileCipher; generation: symbol } | null = null;
export function activateFileCipher(cipher: FileCipher) {
  const generation = Symbol('file-context');
  active = { cipher, generation };
  return () => {
    if (active?.generation === generation) active = null;
  };
}
export function isClinicalFile(path: string) {
  return /\/(reportes_locales|formularios_locales|borradores_formularios|formularios_medicos)\//.test(
    path.replace(/\\/g, '/'),
  );
}
export function assertClinicalFileContext(path: string) {
  if (isClinicalFile(path) && (!active || !active.cipher.owns(path)))
    throw new Error('El archivo no pertenece al contexto activo.');
}

export function clinicalFileLease(path: string): () => void {
  assertClinicalFileContext(path);
  if (!isClinicalFile(path)) return () => undefined;
  const generation = active!.generation;
  return () => {
    if (active?.generation !== generation)
      throw new Error('El contexto cambió durante la operación de archivo.');
  };
}
export function scopedClinicalDirectory(
  root: 'reportes_locales' | 'formularios_locales' | 'recursos_educativos',
  patientId: string,
): string | null {
  return active?.cipher.directory?.(root, patientId) ?? null;
}
export async function protectClinicalFile(path: string, bytes: Uint8Array): Promise<Uint8Array> {
  if (!isClinicalFile(path)) return bytes;
  const context = active;
  if (!context || !context.cipher.owns(path))
    throw new Error('El archivo no pertenece al contexto activo.');
  const result = await context.cipher.protect(path, bytes);
  if (active?.generation !== context.generation)
    throw new Error('El contexto cambió durante el cifrado.');
  return result;
}
export async function readClinicalFile(path: string, bytes: Uint8Array): Promise<Uint8Array> {
  if (!isClinicalFile(path)) return bytes;
  const context = active;
  if (!context || !context.cipher.owns(path))
    throw new Error('El archivo no pertenece al contexto activo.');
  const result = await context.cipher.unprotect(path, bytes);
  if (active?.generation !== context.generation)
    throw new Error('El contexto cambió durante la lectura.');
  return result;
}

/** Captures the file context even for nonclinical educational bytes. */
export function resourceContextLease(): () => void {
  const generation = active?.generation;
  return () => {
    if (active?.generation !== generation)
      throw new Error('El contexto cambió durante la operación de archivo.');
  };
}
