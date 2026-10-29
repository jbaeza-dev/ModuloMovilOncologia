import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { SqlConnection } from '../local/core/sql';
import type { FileCipher } from './file-protection';
const { files } = vi.hoisted(() => ({ files: new Map<string, Uint8Array>() }));
vi.mock('expo-file-system', () => ({
  Paths: { document: 'file:///synthetic/' },
  Directory: class {
    uri: string;
    constructor(...parts: ({ uri: string } | string)[]) {
      this.uri =
        parts
          .map((p) => (typeof p === 'string' ? p : p.uri).replace(/\/$/, ''))
          .join('/')
          .replace(/\/$/, '') + '/';
    }
    create() {}
  },
  File: class {
    uri: string;
    constructor(...parts: ({ uri: string } | string)[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri.replace(/\/$/, ''))).join('/');
    }
    get exists() {
      return files.has(this.uri);
    }
    async bytes() {
      const bytes = files.get(this.uri);
      if (!bytes) throw new Error('missing ' + this.uri);
      return bytes;
    }
    async write(bytes: Uint8Array) {
      files.set(this.uri, bytes.slice());
    }
    async move(destination: { uri: string }) {
      files.set(destination.uri, await this.bytes());
      files.delete(this.uri);
      this.uri = destination.uri;
    }
    async delete() {
      files.delete(this.uri);
    }
  },
}));
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  randomUUID: () => 'synthetic-operation',
  digest: async (_algorithm: string, bytes: Uint8Array) =>
    new Uint8Array(createHash('sha256').update(bytes).digest()).buffer,
}));
import { scopeEducationalCopies } from './native-education-files';
const patient = 'synthetic-patient',
  name = 'content.1792793887079.png';
const original = 'file:///synthetic/recursos_educativos/' + patient + '/' + name;
const destination = 'file:///synthetic/recursos_educativos/environment/' + patient + '/' + name;
const cipher = {
  directory: () => destination.slice(0, destination.lastIndexOf('/') + 1),
  owns: () => true,
  protect: async (_path: string, bytes: Uint8Array) => bytes,
  unprotect: async (_path: string, bytes: Uint8Array) => bytes,
} satisfies FileCipher;
const db = () => ({
  all: vi
    .fn()
    .mockResolvedValue([{ contenido_id: 'content', ruta_local: original, formato: 'png' }]),
  run: vi.fn().mockResolvedValue({}),
});
beforeEach(() => {
  files.clear();
  files.set(original, new Uint8Array([1, 2, 3]));
});
describe('native educational copy migration', () => {
  it('preserves the promoted file when the native move changes its source object URI', async () => {
    const connection = db();
    await scopeEducationalCopies(patient, cipher, connection as unknown as SqlConnection);
    expect(files.get(original)).toEqual(new Uint8Array([1, 2, 3]));
    expect(files.get(destination)).toEqual(new Uint8Array([1, 2, 3]));
    expect([...files.keys()].some((key) => key.endsWith('.tmp'))).toBe(false);
    expect(connection.run).toHaveBeenCalledWith(expect.any(String), [
      destination,
      patient,
      'content',
      original,
    ]);
  });
  it('never overwrites an existing different copy or changes the database reference', async () => {
    const connection = db();
    files.set(destination, new Uint8Array([9]));
    await expect(
      scopeEducationalCopies(patient, cipher, connection as unknown as SqlConnection),
    ).rejects.toThrow('diferentes');
    expect(files.get(original)).toEqual(new Uint8Array([1, 2, 3]));
    expect(files.get(destination)).toEqual(new Uint8Array([9]));
    expect(connection.run).not.toHaveBeenCalled();
  });
});
