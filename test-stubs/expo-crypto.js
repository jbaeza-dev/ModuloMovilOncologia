const crypto = require('node:crypto');

const CryptoDigestAlgorithm = {
  SHA1: 'SHA-1',
  SHA256: 'SHA-256',
  SHA384: 'SHA-384',
  SHA512: 'SHA-512',
  MD5: 'MD5',
};

const CryptoEncoding = {
  HEX: 'hex',
  BASE64: 'base64',
};

async function digestStringAsync(algorithm, data, options = {}) {
  const enc = options.encoding || CryptoEncoding.HEX;
  let algoName = 'sha256';
  if (algorithm === CryptoDigestAlgorithm.SHA1) algoName = 'sha1';
  else if (algorithm === CryptoDigestAlgorithm.SHA384) algoName = 'sha384';
  else if (algorithm === CryptoDigestAlgorithm.SHA512) algoName = 'sha512';
  else if (algorithm === CryptoDigestAlgorithm.MD5) algoName = 'md5';

  const hash = crypto.createHash(algoName).update(data, 'utf8');
  if (enc === CryptoEncoding.BASE64) {
    return hash.digest('base64');
  }
  return hash.digest('hex');
}

async function digest(algorithm, data) {
  let algoName = 'sha256';
  if (algorithm === CryptoDigestAlgorithm.SHA1) algoName = 'sha1';
  else if (algorithm === CryptoDigestAlgorithm.SHA384) algoName = 'sha384';
  else if (algorithm === CryptoDigestAlgorithm.SHA512) algoName = 'sha512';
  else if (algorithm === CryptoDigestAlgorithm.MD5) algoName = 'md5';

  const hash = crypto.createHash(algoName).update(Buffer.from(data));
  const digestBuffer = hash.digest();
  return digestBuffer.buffer.slice(
    digestBuffer.byteOffset,
    digestBuffer.byteOffset + digestBuffer.byteLength,
  );
}

function randomUUID() {
  return crypto.randomUUID();
}

module.exports = {
  CryptoDigestAlgorithm,
  CryptoEncoding,
  digestStringAsync,
  digest,
  randomUUID,
};
