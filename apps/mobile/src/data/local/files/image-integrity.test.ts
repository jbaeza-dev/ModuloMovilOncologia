import { describe, expect, it } from 'vitest';
import { createMinimalPng } from './educational-storage';
import { verifyStoredImage } from './image-integrity';
import { computeSha256 } from '../../../utils/crypto';
import type { EducationalLocalCopy } from '../education/education-types';
describe('offline image integrity after reopen', () => {
  it('rejects same-size corruption even when the header and metadata look valid', async () => {
    const bytes = createMinimalPng(100, 100);
    const copy = {
      formato: 'png',
      tamanoBytes: bytes.length,
      metadataLocal: { sha256: await computeSha256(bytes) },
    } as EducationalLocalCopy;
    expect(await verifyStoredImage(bytes, copy)).toBe(true);
    const corrupt = new Uint8Array(bytes);
    corrupt[corrupt.length - 1] ^= 1;
    expect(await verifyStoredImage(corrupt, copy)).toBe(false);
    expect(await verifyStoredImage(bytes, { ...copy, metadataLocal: {} })).toBe(false);
    expect(await verifyStoredImage(bytes, { ...copy, tamanoBytes: bytes.length + 1 })).toBe(false);
  });
});
