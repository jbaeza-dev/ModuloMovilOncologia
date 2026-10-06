import * as fs from 'node:fs';
import * as path from 'node:path';

import type { FileStorageAdapter } from './file-storage-adapter';

/**
 * Adaptador para pruebas unitarias ejecutadas en entorno Node.js.
 * Se mantiene separado del adaptador de Expo para evitar que Metro
 * intente empaquetar módulos integrados de Node (node:fs, node:path) en Android.
 */
export class NodeFileStorageAdapter implements FileStorageAdapter {
  exists(targetPath: string): boolean {
    return fs.existsSync(targetPath);
  }

  async readText(targetPath: string): Promise<string> {
    return fs.readFileSync(targetPath, 'utf-8');
  }

  async writeText(targetPath: string, content: string): Promise<void> {
    const parent = path.dirname(targetPath);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
    fs.writeFileSync(targetPath, content, 'utf-8');
  }

  async deleteFile(targetPath: string): Promise<boolean> {
    try {
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
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
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Archivo origen no existe: ${sourcePath}`);
    }
    if (fs.existsSync(destinationPath) && !options?.overwrite) {
      throw new Error(`Archivo destino ya existe y overwrite es false: ${destinationPath}`);
    }
    const parent = path.dirname(destinationPath);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
    fs.renameSync(sourcePath, destinationPath);
  }

  async listDirectory(dirPath: string): Promise<string[]> {
    if (!fs.existsSync(dirPath)) return [];
    return fs.readdirSync(dirPath).map((f) => path.join(dirPath, f));
  }

  async ensureDirectory(dirPath: string): Promise<void> {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  getFileSize(targetPath: string): number {
    if (!fs.existsSync(targetPath)) return 0;
    return fs.statSync(targetPath).size;
  }

  async getFileTime(
    targetPath: string,
  ): Promise<{ creationTime: number | null; modificationTime: number | null }> {
    if (!fs.existsSync(targetPath)) return { creationTime: null, modificationTime: null };
    const stat = fs.statSync(targetPath);
    return {
      creationTime: stat.birthtimeMs || null,
      modificationTime: stat.mtimeMs || null,
    };
  }
}
