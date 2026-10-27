import { describe, expect, it } from 'vitest';
import {
  activateFileCipher,
  protectClinicalFile,
  readClinicalFile,
  scopedClinicalDirectory,
  clinicalFileLease,
} from './file-protection';

const path = 'file:///private/formularios_locales/A/draft.json';
describe('P04 clinical file context fencing', () => {
  it('invalidates a read lease after logout and returning to the same account', () => {
    const cipher = {
      owns: () => true,
      protect: async (_p: string, b: Uint8Array) => b,
      unprotect: async (_p: string, b: Uint8Array) => b,
    };
    const stop = activateFileCipher(cipher),
      lease = clinicalFileLease(path);
    stop();
    const stopAgain = activateFileCipher(cipher);
    expect(lease).toThrow('contexto cambió');
    stopAgain();
  });
  it('rejects reads without an owner context; public education remains readable', async () => {
    await expect(readClinicalFile(path, new Uint8Array([1]))).rejects.toThrow('contexto');
    expect(
      await readClinicalFile(
        'file:///private/recursos_educativos/A/image.png',
        new Uint8Array([1]),
      ),
    ).toEqual(new Uint8Array([1]));
  });
  it('discards a late encryption result after switching accounts', async () => {
    let finish!: (bytes: Uint8Array) => void;
    const stopA = activateFileCipher({
      owns: (p) => p === path,
      unprotect: async (_p, b) => b,
      protect: () =>
        new Promise((r) => {
          finish = r;
        }),
    });
    const pending = protectClinicalFile(path, new Uint8Array([1]));
    const stopB = activateFileCipher({
      owns: () => false,
      protect: async (_p, b) => b,
      unprotect: async (_p, b) => b,
    });
    stopA();
    finish(new Uint8Array([9]));
    await expect(pending).rejects.toThrow('contexto cambió');
    await expect(readClinicalFile(path, new Uint8Array([1]))).rejects.toThrow('contexto');
    stopB();
  });
  it('uses only the active environment directory', () => {
    const stop = activateFileCipher({
      owns: () => true,
      protect: async (_p, b) => b,
      unprotect: async (_p, b) => b,
      directory: (root, owner) => 'file:///private/' + root + '/env1/' + owner + '/',
    });
    expect(scopedClinicalDirectory('reportes_locales', 'A')).toBe(
      'file:///private/reportes_locales/env1/A/',
    );
    stop();
    expect(scopedClinicalDirectory('reportes_locales', 'A')).toBeNull();
  });
});
