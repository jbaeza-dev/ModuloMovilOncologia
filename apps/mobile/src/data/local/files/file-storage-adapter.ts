import {
  protectClinicalFile,
  readClinicalFile,
  isClinicalFile,
  assertClinicalFileContext,
} from '../../sync/file-protection';
import { Directory, File } from 'expo-file-system';

/**
 * Interfaz de almacenamiento de archivos inyectable.
 * Permite desacoplar las operaciones de archivos para pruebas y producción.
 */
export interface FileStorageAdapter {
  exists(targetPath: string): Promise<boolean> | boolean;
  directoryExists?(dirPath: string): Promise<boolean> | boolean;
  readText(targetPath: string): Promise<string>;
  writeText(targetPath: string, content: string): Promise<void>;
  readBinary?(targetPath: string): Promise<Uint8Array>;
  writeBinary?(targetPath: string, content: Uint8Array): Promise<void>;
  deleteFile(targetPath: string): Promise<boolean>;
  moveFile(
    sourcePath: string,
    destinationPath: string,
    options?: { overwrite?: boolean },
  ): Promise<void>;
  listDirectory(dirPath: string): Promise<string[]>;
  ensureDirectory(dirPath: string): Promise<void>;
  getFileSize?(targetPath: string): Promise<number> | number;
  getFileTime?(
    targetPath: string,
  ): Promise<{ creationTime: number | null; modificationTime: number | null }>;
}

function toAbsoluteFileUri(p: string): string {
  if (p.startsWith('file://') || p.startsWith('content://')) return p;
  if (p.startsWith('/')) return `file://${p}`;
  return p;
}

/**
 * Adaptador de producción que delega en las APIs nativas de Expo FileSystem.
 * Se inicializa dinámicamente para no requerir expo-file-system en pruebas puras de Node.
 */
export class ExpoFileStorageAdapter implements FileStorageAdapter {
  async directoryExists(dirPath: string): Promise<boolean> {
    const dir = new Directory(toAbsoluteFileUri(dirPath));
    return dir.exists;
  }

  async exists(targetPath: string): Promise<boolean> {
    const file = new File(toAbsoluteFileUri(targetPath));
    return file.exists;
  }

  async readText(targetPath: string): Promise<string> {
    const file = new File(toAbsoluteFileUri(targetPath));
    if (!isClinicalFile(targetPath)) return file.text();
    return new TextDecoder().decode(await readClinicalFile(targetPath, await file.bytes()));
  }

  async writeText(targetPath: string, content: string): Promise<void> {
    const file = new File(toAbsoluteFileUri(targetPath));
    await file.write(await protectClinicalFile(targetPath, new TextEncoder().encode(content)));
  }

  async readBinary(targetPath: string): Promise<Uint8Array> {
    const file = new File(toAbsoluteFileUri(targetPath));
    return readClinicalFile(targetPath, await file.bytes());
  }

  async writeBinary(targetPath: string, content: Uint8Array): Promise<void> {
    const file = new File(toAbsoluteFileUri(targetPath));
    await file.write(await protectClinicalFile(targetPath, content));
  }

  async deleteFile(targetPath: string): Promise<boolean> {
    try {
      const file = new File(toAbsoluteFileUri(targetPath));
      if (file.exists) {
        await file.delete();
      }
      return true;
    } catch {
      return false;
    }
  }

  async moveFile(
    sourcePath: string,
    destinationPath: string,
    options?: { overwrite?: boolean },
  ): Promise<void> {
    assertClinicalFileContext(sourcePath);
    assertClinicalFileContext(destinationPath);
    const source = new File(toAbsoluteFileUri(sourcePath));
    const dest = new File(toAbsoluteFileUri(destinationPath));
    await source.move(dest, { overwrite: options?.overwrite ?? false });
  }

  async listDirectory(dirPath: string): Promise<string[]> {
    const dir = new Directory(toAbsoluteFileUri(dirPath));
    if (!dir.exists) return [];
    try {
      const entries = dir.list();
      return entries.map((e: { uri: string }) => e.uri);
    } catch {
      return [];
    }
  }

  async ensureDirectory(dirPath: string): Promise<void> {
    const dir = new Directory(toAbsoluteFileUri(dirPath));
    dir.create({ intermediates: true, idempotent: true });
  }

  async getFileSize(targetPath: string): Promise<number> {
    try {
      const file = new File(toAbsoluteFileUri(targetPath));
      return file.size ?? 0;
    } catch {
      return 0;
    }
  }

  async getFileTime(
    targetPath: string,
  ): Promise<{ creationTime: number | null; modificationTime: number | null }> {
    try {
      const file = new File(targetPath);
      return {
        creationTime: file.creationTime ?? null,
        modificationTime: file.modificationTime ?? null,
      };
    } catch {
      return { creationTime: null, modificationTime: null };
    }
  }
}
