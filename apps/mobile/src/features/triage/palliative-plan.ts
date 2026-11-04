import { canonical } from '../../data/sync/clinical-command';

export type PlanState =
  | 'SIN_PLAN_REGISTRADO'
  | 'DECLARADO_NO_VERIFICADO'
  | 'VERIFICADO_LOCAL'
  | 'REQUIERE_REVISION'
  | 'SUSTITUIDO_O_REVOCADO';
export interface IndividualPlan {
  id: string;
  version: number;
  patientId: string;
  environment: string;
  issuerId: string;
  approvedAt: string;
  reviewAt: string | null;
  instructions: string;
  coveredSignals: string[];
  contact: string;
  hours: string;
  contingency: string;
}
export interface SignedPlan {
  plan: IndividualPlan;
  contentHash: string;
  keyId: string;
  signature: string;
}
export interface PlanTrust {
  /** Provisioned by an authorized operator, never populated from a patient's QR. */
  issuerKeys: Readonly<Record<string, { issuerId: string; publicKey: string }>>;
  revoked: readonly string[];
  lastCheckedAt: string;
}
export interface PlanCryptography {
  hash: (canonicalContent: string) => Promise<string>;
  verify: (
    canonicalContent: string,
    signature: string,
    trustedPublicKey: string,
  ) => Promise<boolean>;
}
export function isSignedPlan(value: unknown): value is SignedPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const envelope = value as Record<string, unknown>;
  const raw = envelope.plan;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const plan = raw as Record<string, unknown>;
  const strings = [
    'id',
    'patientId',
    'environment',
    'issuerId',
    'approvedAt',
    'instructions',
    'contact',
    'hours',
    'contingency',
  ];
  return (
    ['contentHash', 'keyId', 'signature'].every(
      (key) => typeof envelope[key] === 'string' && String(envelope[key]).trim().length > 0,
    ) &&
    strings.every((key) => typeof plan[key] === 'string' && String(plan[key]).trim().length > 0) &&
    Number.isInteger(plan.version) &&
    Number(plan.version) > 0 &&
    (plan.reviewAt === null || typeof plan.reviewAt === 'string') &&
    Array.isArray(plan.coveredSignals) &&
    plan.coveredSignals.every((id) => typeof id === 'string' && id.trim().length > 0)
  );
}

export interface PlanAssessment {
  state: PlanState;
  applicable: boolean;
  reason: string;
  planId: string | null;
  version: number | null;
  contentHash: string | null;
  trustCheckedAt: string | null;
  patientId: string | null;
  environment: string | null;
  coveredSignals: readonly string[];
  instructions: string | null;
  contingency: string | null;
  contact: string | null;
}

/** No clinical issuer or verification adapter is enabled in the current product.
 * This boundary lets an approved integration verify provenance without a mutable boolean. */
export async function assessIndividualPlan(
  envelope: SignedPlan | null,
  context: {
    patientId: string;
    environment: string;
    signal: string;
    now: string;
    meansAvailable: boolean;
    careFailed: boolean;
  },
  trust: PlanTrust | null = null,
  cryptography: PlanCryptography | null = null,
): Promise<PlanAssessment> {
  const result: PlanAssessment = {
    state: envelope ? 'DECLARADO_NO_VERIFICADO' : 'SIN_PLAN_REGISTRADO',
    applicable: false,
    reason: envelope ? 'issuer-not-configured' : 'not-registered',
    planId: envelope?.plan?.id ?? null,
    version: envelope?.plan?.version ?? null,
    contentHash: envelope?.contentHash ?? null,
    trustCheckedAt: trust?.lastCheckedAt ?? null,
    patientId: envelope?.plan?.patientId ?? null,
    environment: envelope?.plan?.environment ?? null,
    coveredSignals: [],
    instructions: null,
    contingency: null,
    contact: null,
  };
  if (!envelope) return result;
  if (!isSignedPlan(envelope)) return { ...result, reason: 'invalid-format' };
  const plan = envelope.plan;
  if (
    !plan.id ||
    !Number.isInteger(plan.version) ||
    plan.version < 1 ||
    !plan.instructions.trim() ||
    !plan.contingency.trim() ||
    !plan.contact.trim() ||
    !plan.hours.trim() ||
    !Number.isFinite(Date.parse(plan.approvedAt)) ||
    !Number.isFinite(Date.parse(context.now)) ||
    Date.parse(plan.approvedAt) > Date.parse(context.now) ||
    (plan.reviewAt !== null && !Number.isFinite(Date.parse(plan.reviewAt))) ||
    plan.patientId !== context.patientId ||
    plan.environment !== context.environment
  )
    return { ...result, reason: 'invalid-or-different-context' };
  if (!trust || !cryptography) return result;
  const key = trust.issuerKeys[envelope.keyId];
  if (
    !key ||
    key.issuerId !== plan.issuerId ||
    !Number.isFinite(Date.parse(trust.lastCheckedAt)) ||
    Date.parse(trust.lastCheckedAt) > Date.parse(context.now)
  )
    return { ...result, reason: 'untrusted-issuer' };
  const identity = `${plan.id}:${plan.version}`;
  if (trust.revoked.includes(identity))
    return { ...result, state: 'SUSTITUIDO_O_REVOCADO', reason: 'known-revocation' };
  try {
    const content = canonical(plan);
    if (
      !/^[a-f0-9]{64}$/.test(envelope.contentHash) ||
      (await cryptography.hash(content)) !== envelope.contentHash ||
      !(await cryptography.verify(content, envelope.signature, key.publicKey))
    )
      return { ...result, reason: 'invalid-provenance' };
  } catch {
    return { ...result, reason: 'verification-unavailable' };
  }
  if (plan.reviewAt !== null && Date.parse(plan.reviewAt) <= Date.parse(context.now))
    return { ...result, state: 'REQUIERE_REVISION', reason: 'review-needed' };
  const applicable =
    plan.coveredSignals.includes(context.signal) && context.meansAvailable && !context.careFailed;
  return {
    ...result,
    state: 'VERIFICADO_LOCAL',
    applicable,
    coveredSignals: [...plan.coveredSignals],
    instructions: plan.instructions,
    contingency: plan.contingency,
    contact: plan.contact,
    reason: applicable ? 'individual-plan-applicable' : 'contingency-required',
  };
}
