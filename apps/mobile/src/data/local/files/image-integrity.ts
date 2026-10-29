import type { EducationalLocalCopy } from '../education/education-types';
import { computeSha256 } from '../../../utils/crypto';
import {
  MAX_EDUCATIONAL_MEDIA_BYTES,
  MAX_EDUCATIONAL_IMAGE_PIXELS,
  parseImageHeader,
} from './educational-storage';

/** Availability requires actual bytes, not just a filename or a previous SQLite flag. */
export async function verifyStoredImage(
  bytes: Uint8Array,
  copy: EducationalLocalCopy,
): Promise<boolean> {
  if (
    !['png', 'jpeg'].includes(copy.formato) ||
    !bytes.byteLength ||
    bytes.byteLength > MAX_EDUCATIONAL_MEDIA_BYTES ||
    bytes.byteLength !== copy.tamanoBytes ||
    !/^[0-9a-f]{64}$/.test(copy.metadataLocal?.sha256 ?? '')
  )
    return false;
  try {
    const header = parseImageHeader(bytes);
    return (
      header.format === copy.formato &&
      header.width * header.height <= MAX_EDUCATIONAL_IMAGE_PIXELS &&
      (await computeSha256(bytes)) === copy.metadataLocal!.sha256
    );
  } catch {
    return false;
  }
}
