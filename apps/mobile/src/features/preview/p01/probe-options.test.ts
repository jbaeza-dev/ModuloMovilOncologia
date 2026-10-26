import { describe, expect, it } from 'vitest';
import { parseProbeSession, parseProbeUrl } from './probe-options';

const owner = '11111111-1111-4111-8111-111111111111';
const session = {
  access_token: 'synthetic',
  token_type: 'bearer',
  expires_in: 3600,
  user: { id: owner },
};

describe('fronteras del diagnóstico P01', () => {
  it('admite bases configurables sin fijar localhost', () => {
    expect(parseProbeUrl('https://example.test/clinical/')).toBe('https://example.test/clinical');
  });
  it.each([
    undefined,
    'file:///tmp/x',
    'https://user:secret@example.test',
    'https://example.test/?token=x',
  ])('rechaza URL incompleta o con credenciales: %s', (value) =>
    expect(() => parseProbeUrl(value)).toThrow(),
  );
  it('mantiene propietario y vencimiento sin exponer el refresh token', () => {
    const result = parseProbeSession(session, owner);
    expect(result.owner).toBe(owner);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(Object.keys(result).sort()).toEqual(['expiresAt', 'owner', 'token']);
  });
  it('rechaza una renovación de otra cuenta', () => {
    expect(() => parseProbeSession(session, '22222222-2222-4222-8222-222222222222')).toThrow(
      'propietario',
    );
  });
  it.each([null, { ...session, expires_in: Number.NaN }, { ...session, user: { id: '../other' } }])(
    'impide una identidad no segura para el archivo local',
    (value) => expect(() => parseProbeSession(value)).toThrow(),
  );
});
