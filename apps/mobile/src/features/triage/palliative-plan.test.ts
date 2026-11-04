import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonical } from '../../data/sync/clinical-command';
import { assessIndividualPlan, type IndividualPlan, type SignedPlan } from './palliative-plan';

// Real Ed25519 primitives in Node verify the integration boundary. No native issuer is enabled.
const keys = generateKeyPairSync('ed25519');
const plan: IndividualPlan = {
  id: 'plan-test',
  version: 1,
  patientId: 'patient-a',
  environment: 'synthetic',
  issuerId: 'issuer-test',
  approvedAt: '2026-11-01T12:00:00Z',
  reviewAt: null,
  instructions: 'Instrucción individual sintética de prueba.',
  coveredSignals: ['A1-RESP'],
  contact: 'canal sintético',
  hours: 'horario sintético',
  contingency: 'Contingencia individual sintética.',
};
const content = canonical(plan);
const envelope: SignedPlan = {
  plan,
  keyId: 'key-test',
  contentHash: createHash('sha256').update(content).digest('hex'),
  signature: sign(null, Buffer.from(content), keys.privateKey).toString('base64'),
};
const context = {
  patientId: 'patient-a',
  environment: 'synthetic',
  signal: 'A1-RESP',
  now: '2026-11-02T12:00:00Z',
  meansAvailable: true,
  careFailed: false,
};
const trust = {
  issuerKeys: {
    'key-test': {
      issuerId: 'issuer-test',
      publicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    },
  },
  revoked: [] as string[],
  lastCheckedAt: '2026-11-02T10:00:00Z',
};
const cryptography = {
  hash: async (value: string) => createHash('sha256').update(value).digest('hex'),
  verify: async (value: string, signature: string, publicKey: string) =>
    verify(null, Buffer.from(value), publicKey, Buffer.from(signature, 'base64')),
};
describe('procedencia e integridad del plan individual, integración nativa pendiente', () => {
  it('sin emisor/adaptador habilitados permanece declarado, aunque el archivo tenga una firma', async () => {
    expect(await assessIndividualPlan(envelope, context)).toMatchObject({
      state: 'DECLARADO_NO_VERIFICADO',
      applicable: false,
    });
    expect(await assessIndividualPlan(null, context)).toMatchObject({
      state: 'SIN_PLAN_REGISTRADO',
      applicable: false,
    });
  });
  it('comprueba firma, emisor, hash, destinatario y entorno sin confiar en una clave del QR', async () => {
    expect(await assessIndividualPlan(envelope, context, trust, cryptography)).toMatchObject({
      state: 'VERIFICADO_LOCAL',
      applicable: true,
    });
    expect(
      (
        await assessIndividualPlan(
          { ...envelope, plan: { ...plan, instructions: 'Contenido alterado' } },
          context,
          trust,
          cryptography,
        )
      ).applicable,
    ).toBe(false);
    expect(
      (
        await assessIndividualPlan(
          envelope,
          { ...context, patientId: 'patient-b' },
          trust,
          cryptography,
        )
      ).applicable,
    ).toBe(false);
    expect(
      (
        await assessIndividualPlan(
          envelope,
          { ...context, environment: 'real' },
          trust,
          cryptography,
        )
      ).applicable,
    ).toBe(false);
    expect(
      (
        await assessIndividualPlan(
          { ...envelope, keyId: 'supplied-by-qr' },
          context,
          trust,
          cryptography,
        )
      ).applicable,
    ).toBe(false);
  });
  it('una verificación de procedencia no acredita cobertura, medios ni éxito del manejo', async () => {
    for (const value of [
      { ...context, signal: 'A2-INGESTA' },
      { ...context, meansAvailable: false },
      { ...context, careFailed: true },
    ])
      expect(await assessIndividualPlan(envelope, value, trust, cryptography)).toMatchObject({
        state: 'VERIFICADO_LOCAL',
        applicable: false,
        reason: 'contingency-required',
      });
  });
  it('respeta las revocaciones conocidas y conserva explícita la última comprobación offline', async () => {
    expect(
      await assessIndividualPlan(
        envelope,
        context,
        { ...trust, revoked: ['plan-test:1'] },
        cryptography,
      ),
    ).toMatchObject({
      state: 'SUSTITUIDO_O_REVOCADO',
      applicable: false,
      trustCheckedAt: trust.lastCheckedAt,
    });
  });
});
