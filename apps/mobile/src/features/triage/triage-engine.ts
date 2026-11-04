import type { PlanAssessment } from './palliative-plan';
import {
  proposal,
  questions,
  type Answer,
  type Informant,
  type Orientation,
  type OrientationDefinition,
  type QuestionId,
  type TemperatureSite,
} from './triage-definition';

export interface ResponseOrigin {
  role: Informant | null;
  source: 'self' | 'relayed' | 'observed' | 'unknown';
  at: string;
}
export interface OrientationInput {
  answers: Partial<Record<QuestionId, Answer>>;
  positiveSignals?: QuestionId[];
  measurementOrigins?: { pain: ResponseOrigin | null; temperature: ResponseOrigin | null };
  palliativePlanDeclared?: Answer;
  informant: Informant | null;
  assisted?: boolean;
  origins?: Partial<Record<QuestionId, ResponseOrigin>>;
  pain: number | null;
  /** Retained only as unconfirmed draft text, never interpreted as a valid measurement. */
  unconfirmedReadings?: { pain?: string; temperature?: string; lastAdministration?: string };
  painSource?: 'self' | 'relayed' | 'unavailable';
  temperature?: { value: number; site: TemperatureSite; measuredAt: string; device?: string };
  treatment?: {
    lastAdministration: string | null;
    precision: 'exact' | 'approximate' | 'unknown';
    source: 'patient' | 'caregiver' | 'document' | 'unknown';
  };
  contradictions?: string[];
  unresolvedVitals?: boolean;
  clarification?: { attempted: boolean; question: string; answer: Answer };
}
export interface OrientationResult {
  availability: 'disabled' | 'evaluated';
  outcome: Orientation | null;
  definitionVersion: string;
  definitionStatus: 'draft' | 'approved';
  mode: 'synthetic' | 'clinical';
  route: 'general' | 'individual-plan' | 'not-determined';
  planApplied?: { id: string; version: number; hash: string; trustCheckedAt: string | null };
  planNotAppliedReason?: string;
  matchedRules: string[];
  missing: string[];
  pendingResolutions: string[];
  complete: boolean;
  message: string;
  clarificationOffered: boolean;
}

export function validateOrientationDefinition(definition: OrientationDefinition): void {
  if (!definition.id || !definition.version || !/^[a-f0-9]{64}$/.test(definition.sourceHash))
    throw new Error('La definición de orientación es inválida.');
  if (
    !['draft', 'approved'].includes(definition.status) ||
    ['A1', 'A2', 'B', 'C', 'D', 'individualPlan'].some((key) => {
      const value = definition.messages[key as keyof typeof definition.messages];
      return typeof value !== 'string' || !value.trim();
    })
  )
    throw new Error('La definición no contiene mensajes utilizables.');
  if (definition.status === 'approved') {
    const approval = definition.approval;
    if (
      !approval?.reviewer.trim() ||
      !approval.actReference.trim() ||
      !Number.isFinite(Date.parse(approval.reviewedAt)) ||
      Array.from({ length: 18 }, (_, n) => 'R' + String(n + 1).padStart(2, '0')).some(
        (id) => !approval.resolutions.includes(id),
      )
    )
      throw new Error('La edición no tiene aprobación operativa completa.');
  }
  const sites = new Set<string>();
  for (const policy of definition.temperaturePolicies) {
    if (
      !['axillary', 'oral', 'tympanic', 'other', 'unknown'].includes(policy.site) ||
      sites.has(policy.site) ||
      !Number.isFinite(policy.high) ||
      !Number.isFinite(policy.low) ||
      policy.low >= policy.high ||
      typeof policy.highInclusive !== 'boolean' ||
      typeof policy.lowInclusive !== 'boolean'
    )
      throw new Error('La política de temperatura es inválida.');
    sites.add(policy.site);
  }
}

/** Pure, local evaluator. Draft rules can only produce explicitly synthetic results.
 * No network, language model, inferred missing responses or hospital category. */
export function evaluateOrientation(
  input: OrientationInput,
  mode: 'clinical' | 'synthetic' = 'clinical',
  definition = proposal,
  verifiedContext?: { scope: { patientId: string; environment: string }; plan: PlanAssessment },
): OrientationResult {
  validateOrientationDefinition(definition);
  const result: OrientationResult = {
    availability: 'disabled',
    outcome: null,
    definitionVersion: definition.version,
    definitionStatus: definition.status,
    mode,
    route: 'not-determined',
    matchedRules: [],
    missing: [],
    pendingResolutions: [],
    complete: false,
    message:
      'La orientación está pendiente de revisión clínica. Puedes consultar a tu equipo tratante por sus canales habituales.',
    clarificationOffered: false,
  };
  if (mode === 'clinical' && definition.status !== 'approved') return result;
  result.availability = 'evaluated';
  for (const [key, value] of Object.entries(input.answers))
    if (!questions.some((q) => q.id === key) || !['yes', 'no', 'unknown'].includes(String(value)))
      throw new Error('Respuesta ajena a la edición de orientación.');
  if (input.informant !== null && !['PACIENTE', 'CUIDADOR_FAMILIAR'].includes(input.informant))
    throw new Error('Rol de informante inválido.');
  const usablePain =
    input.pain !== null &&
    Number.isInteger(input.pain) &&
    input.pain >= 0 &&
    input.pain <= 10 &&
    input.painSource !== 'unavailable';
  for (const q of questions) {
    if (input.answers[q.id] === 'yes' && (q.group === 'A1' || q.group === 'A2' || q.group === 'B'))
      result.matchedRules.push(q.id);
    if (q.group !== 'C' && (input.answers[q.id] === undefined || input.answers[q.id] === 'unknown'))
      result.missing.push(q.id);
  }
  for (const id of input.positiveSignals ?? []) {
    if (!questions.some((q) => q.id === id && (q.group === 'A1' || q.group === 'A2')))
      throw new Error('Antecedente de señal ajeno a la edición.');
    if (!result.matchedRules.includes(id)) result.matchedRules.push(id);
    if (input.answers[id] !== 'yes') result.missing.push('contradiction:' + id);
  }
  if (!usablePain) result.missing.push('pain');
  if (!input.informant) result.missing.push('informant');
  if (input.contradictions?.length)
    result.missing.push(...input.contradictions.map((id) => 'contradiction:' + id));
  if (input.unresolvedVitals) {
    result.missing.push('uninterpreted-vitals');
    result.pendingResolutions.push('R10');
  }
  if (input.temperature) {
    const { value, site, measuredAt } = input.temperature;
    if (
      !Number.isFinite(value) ||
      value < 30 ||
      value > 45 ||
      Math.abs(value * 10 - Math.round(value * 10)) > 1e-7 ||
      !Number.isFinite(Date.parse(measuredAt))
    )
      result.missing.push('temperature-invalid');
    else {
      const policy = definition.temperaturePolicies.find((p) => p.site === site);
      if (!policy) {
        result.pendingResolutions.push('R06', 'R07');
        result.missing.push('temperature-policy');
      } else if (
        (policy.highInclusive ? value >= policy.high : value > policy.high) ||
        (policy.lowInclusive ? value <= policy.low : value < policy.low)
      )
        result.matchedRules.push('A2-TEMP');
    }
    // Treatment dates never imply neutropenia or authorize waiting by themselves.
  }
  if (
    usablePain &&
    input.pain !== null &&
    (input.pain >= 7 || (input.pain >= 4 && input.answers['B-PAIN-CONTEXT'] === 'yes'))
  )
    result.matchedRules.push('B-PAIN');
  if (result.matchedRules.some((id) => id.startsWith('A1-'))) result.outcome = 'A1';
  else if (result.matchedRules.some((id) => id.startsWith('A2-'))) result.outcome = 'A2';
  else if (result.missing.length) result.outcome = 'D';
  else if (result.matchedRules.some((id) => id.startsWith('B-'))) result.outcome = 'B';
  else {
    const unmet = questions.filter((q) => q.group === 'C' && input.answers[q.id] !== 'yes');
    if (unmet.length || input.pain === null || input.pain > 3) {
      result.outcome = 'D';
      result.missing.push(...unmet.map((q) => q.id));
      if (input.pain !== null && input.pain > 3) result.missing.push('pain-context');
    } else result.outcome = 'C';
  }
  result.route = 'general';
  result.message = definition.messages[result.outcome];
  if ((result.outcome === 'A1' || result.outcome === 'A2') && verifiedContext) {
    const { plan, scope } = verifiedContext;
    if (
      plan.state === 'VERIFICADO_LOCAL' &&
      plan.applicable &&
      plan.planId &&
      plan.version !== null &&
      plan.contentHash &&
      plan.instructions &&
      plan.contingency &&
      plan.patientId === scope.patientId &&
      plan.environment === scope.environment &&
      result.matchedRules.every((id) => plan.coveredSignals.includes(id))
    ) {
      result.route = 'individual-plan';
      result.message =
        definition.messages.individualPlan + '\n\n' + plan.instructions + '\n\n' + plan.contingency;
      result.planApplied = {
        id: plan.planId,
        version: plan.version,
        hash: plan.contentHash,
        trustCheckedAt: plan.trustCheckedAt,
      };
    } else
      result.planNotAppliedReason =
        plan.reason === 'individual-plan-applicable'
          ? 'not-covered-or-context-mismatch'
          : plan.reason;
  }
  result.complete = result.missing.length === 0;
  result.clarificationOffered = result.outcome === 'D' && !input.clarification?.attempted;
  return result;
}
