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

describe('validación de formato y contexto del plan individual', () => {
  const firmado = (cambios: Partial<IndividualPlan>, sobre: Record<string, unknown> = {}) =>
    ({ ...envelope, plan: { ...plan, ...cambios }, ...sobre }) as SignedPlan;

  it.each([
    ['un arreglo', []],
    ['un texto', 'plan'],
    ['un sobre sin plan', { ...envelope, plan: null }],
    ['un plan arreglo', { ...envelope, plan: [] }],
    ['sin firma', { ...envelope, signature: ' ' }],
    ['sin clave', { ...envelope, keyId: 5 }],
    ['instrucciones vacías', firmado({ instructions: '  ' })],
    ['versión no entera', firmado({ version: 1.5 })],
    ['versión cero', firmado({ version: 0 })],
    ['revisión inválida', firmado({ reviewAt: 5 as unknown as string })],
    ['señales que no son lista', firmado({ coveredSignals: 'A1' as unknown as string[] })],
    ['señal vacía', firmado({ coveredSignals: [' '] })],
  ])('rechaza el formato con %s', async (_caso, valor) => {
    const r = await assessIndividualPlan(
      valor as unknown as SignedPlan,
      context,
      trust,
      cryptography,
    );
    expect(r.reason).toBe('invalid-format');
    expect(r.applicable).toBe(false);
  });

  it.each([
    ['fecha de aprobación inválida', firmado({ approvedAt: 'no-fecha' }), context],
    ['aprobación futura', firmado({ approvedAt: '2027-01-01T00:00:00Z' }), context],
    ['fecha de revisión inválida', firmado({ reviewAt: 'no-fecha' }), context],
    ['otro paciente', firmado({ patientId: 'patient-b' }), context],
    ['otro entorno', firmado({ environment: 'prod' }), context],
    ['hora actual inválida', envelope, { ...context, now: 'no-fecha' }],
  ])('rechaza el contexto con %s', async (_caso, sobre, ctx) => {
    const r = await assessIndividualPlan(sobre, ctx, trust, cryptography);
    expect(r.reason).toBe('invalid-or-different-context');
  });

  it('sin confianza o sin criptografía queda declarado sin verificar', async () => {
    expect((await assessIndividualPlan(envelope, context, trust, null)).reason).toBe(
      'issuer-not-configured',
    );
    expect((await assessIndividualPlan(envelope, context, null, cryptography)).state).toBe(
      'DECLARADO_NO_VERIFICADO',
    );
  });

  it.each([
    ['clave desconocida', { ...trust, issuerKeys: {} }],
    [
      'emisor distinto',
      {
        ...trust,
        issuerKeys: { 'key-test': { ...trust.issuerKeys['key-test'], issuerId: 'otro' } },
      },
    ],
    ['comprobación inválida', { ...trust, lastCheckedAt: 'no-fecha' }],
    ['comprobación futura', { ...trust, lastCheckedAt: '2027-01-01T00:00:00Z' }],
  ])('rechaza un emisor no confiable por %s', async (_caso, confianza) => {
    expect((await assessIndividualPlan(envelope, context, confianza, cryptography)).reason).toBe(
      'untrusted-issuer',
    );
  });

  it('rechaza un hash con formato inválido o que no coincide', async () => {
    expect(
      (
        await assessIndividualPlan(
          { ...envelope, contentHash: 'abc' },
          context,
          trust,
          cryptography,
        )
      ).reason,
    ).toBe('invalid-provenance');
    expect(
      (
        await assessIndividualPlan(
          { ...envelope, contentHash: 'a'.repeat(64) },
          context,
          trust,
          cryptography,
        )
      ).reason,
    ).toBe('invalid-provenance');
  });

  it('informa verificación no disponible si la criptografía falla', async () => {
    const rota = { ...cryptography, hash: async () => Promise.reject(new Error('sin motor')) };
    expect((await assessIndividualPlan(envelope, context, trust, rota)).reason).toBe(
      'verification-unavailable',
    );
  });

  it('exige contingencia cuando la señal no está cubierta, faltan medios o falló el manejo', async () => {
    for (const ctx of [
      { ...context, signal: 'OTRA' },
      { ...context, meansAvailable: false },
      { ...context, careFailed: true },
    ]) {
      const r = await assessIndividualPlan(envelope, ctx, trust, cryptography);
      expect(r).toMatchObject({
        state: 'VERIFICADO_LOCAL',
        applicable: false,
        reason: 'contingency-required',
      });
    }
  });
});
