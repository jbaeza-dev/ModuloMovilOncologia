import type {
  Credentials,
  Profile,
  ClinicalProfile,
  Treatment,
  Terms,
  ConsentState,
} from './http-session-types';
import { SessionFailure } from './http-session-types';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
export const isUuid = (v: unknown): v is string => typeof v === 'string' && uuid.test(v);
const invalid = () => new SessionFailure('invalid');
export function credentials(value: unknown, now: number): Credentials {
  if (
    !object(value) ||
    !object(value.user) ||
    !isUuid(value.user.id) ||
    value.token_type !== 'bearer' ||
    typeof value.access_token !== 'string' ||
    !value.access_token ||
    value.access_token.length > 8192 ||
    typeof value.refresh_token !== 'string' ||
    !value.refresh_token ||
    value.refresh_token.length > 4096 ||
    !Number.isInteger(value.expires_in) ||
    Number(value.expires_in) <= 0 ||
    Number(value.expires_in) > 86400
  )
    throw invalid();
  return {
    owner: value.user.id.toLowerCase(),
    accessToken: value.access_token,
    refreshToken: value.refresh_token,
    expiresAt: now + Number(value.expires_in) * 1000,
  };
}
export function profile(value: unknown, owner: string): Profile {
  if (
    !object(value) ||
    value.id !== owner ||
    typeof value.email !== 'string' ||
    typeof value.rol !== 'string' ||
    typeof value.activo !== 'boolean'
  )
    throw invalid();
  for (const key of [
    'nombre',
    'rut',
    'telefono',
    'fecha_nacimiento',
    'sexo',
    'estado_incorporacion',
  ])
    if (value[key] !== undefined && value[key] !== null && typeof value[key] !== 'string')
      throw invalid();
  return value as Profile;
}
export function clinicalProfile(value: unknown): ClinicalProfile {
  if (
    !object(value) ||
    !isUuid(value.id) ||
    typeof value.fecha_actualizacion !== 'string' ||
    !Number.isFinite(Date.parse(value.fecha_actualizacion))
  )
    throw invalid();
  for (const key of ['peso', 'altura'])
    if (
      value[key] !== undefined &&
      value[key] !== null &&
      (typeof value[key] !== 'number' || !Number.isFinite(value[key]))
    )
      throw invalid();
  if (value.medicamentos !== undefined) {
    if (!Array.isArray(value.medicamentos)) throw invalid();
    const ids = new Set<string>();
    for (const medication of value.medicamentos) {
      if (
        !object(medication) ||
        !isUuid(medication.id) ||
        !isUuid(medication.medicamento_id) ||
        ids.has(medication.id)
      )
        throw invalid();
      ids.add(medication.id);
      for (const key of ['nombre', 'dosis', 'frecuencia', 'motivo'])
        if (medication[key] !== undefined && typeof medication[key] !== 'string') throw invalid();
      if (medication.activo !== undefined && typeof medication.activo !== 'boolean')
        throw invalid();
      for (const key of ['fecha_inicio', 'fecha_termino'])
        if (
          medication[key] !== undefined &&
          medication[key] !== null &&
          typeof medication[key] !== 'string'
        )
          throw invalid();
    }
  }
  return value as ClinicalProfile;
}
export function treatment(value: unknown): Treatment {
  if (
    !object(value) ||
    !isUuid(value.id) ||
    !isUuid(value.tipo_tratamiento_id) ||
    typeof value.tipo_tratamiento_codigo !== 'string' ||
    typeof value.tipo_tratamiento_nombre !== 'string'
  )
    throw invalid();
  return value as Treatment;
}
export function terms(value: unknown): Terms {
  if (
    !object(value) ||
    !isUuid(value.id) ||
    value.codigo !== 'TERMINOS_PLATAFORMA' ||
    typeof value.version !== 'string' ||
    typeof value.titulo !== 'string' ||
    typeof value.texto_completo !== 'string' ||
    typeof value.vigente_desde !== 'string'
  )
    throw invalid();
  return value as Terms;
}
export function consentState(value: unknown, owner: string): ConsentState {
  if (!object(value) || typeof value.requiere_aceptacion !== 'boolean') throw invalid();
  for (const c of [
    value.consentimiento_actual,
    ...(Array.isArray(value.historial_previo) ? value.historial_previo : []),
  ]) {
    if (c == null) continue;
    if (
      !object(c) ||
      !isUuid(c.id) ||
      c.paciente_id !== owner ||
      !isUuid(c.definicion_terminos_id) ||
      typeof c.revocado !== 'boolean' ||
      typeof c.otorgado_el !== 'string'
    )
      throw invalid();
  }
  if (value.terminos_vigentes != null) {
    const t = value.terminos_vigentes;
    if (
      !object(t) ||
      !isUuid(t.id) ||
      t.codigo !== 'TERMINOS_PLATAFORMA' ||
      typeof t.version !== 'string' ||
      typeof t.texto_completo !== 'string'
    )
      throw invalid();
  }
  return value as ConsentState;
}
export function canUpload(state: ConsentState | null, definition: Terms | null): boolean {
  const c = state?.consentimiento_actual,
    t = state?.terminos_vigentes;
  return !!(
    state &&
    state.requiere_aceptacion === false &&
    c &&
    !c.revocado &&
    !c.revocado_el &&
    t &&
    definition &&
    c.definicion_terminos_id === t.id &&
    definition.id === t.id &&
    definition.version === t.version &&
    definition.vigente !== false
  );
}
