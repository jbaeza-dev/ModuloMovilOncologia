import type {
  ClinicalUsuarioPerfilResponse,
  ClinicalPerfilClinicoResponse,
  ClinicalTratamientoActivoResponse,
  ClinicalDefinicionTerminosResponse,
  ClinicalEstadoConsentimientoResponse,
} from '@quimiocare/contracts';
import type { SessionState, SessionUser } from './session-types';
export type Profile = ClinicalUsuarioPerfilResponse;
export type ClinicalProfile = ClinicalPerfilClinicoResponse;
export type Treatment = ClinicalTratamientoActivoResponse;
export type Terms = ClinicalDefinicionTerminosResponse;
export type ConsentState = ClinicalEstadoConsentimientoResponse;
export interface Credentials {
  owner: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}
export interface IdentityCache {
  owner: string;
  scope: string;
  fetchedAt: string;
  user: SessionUser;
  profile: Profile;
  clinicalProfile: ClinicalProfile | null;
  treatment: Treatment | null;
  clinicalStatus: 'available' | 'missing' | 'unavailable';
  treatmentStatus: 'available' | 'missing' | 'unavailable';
}
export interface SessionSnapshot {
  state: SessionState;
  user: SessionUser | null;
  identity: IdentityCache | null;
  stale: boolean;
  consent: ConsentState | null;
  terms: Terms | null;
  uploadAllowed: boolean;
  message: string | null;
  /** Código corto de la última falla «no disponible» (ver `failureCode`); sin datos personales. */
  failureCode?: string | null;
  revision: number;
}
/** Dónde ocurrió la falla: el intercambio con Google/Supabase (`auth`) o QuimioCare (`clinical`). */
export type FailureOrigin = 'auth' | 'clinical';
/** Por qué no hubo respuesta útil, cuando no hay un estado HTTP que lo diga. */
export type FailureReason = 'timeout' | 'network' | 'throttled';
export class SessionFailure extends Error {
  constructor(
    readonly kind: 'unavailable' | 'expired' | 'denied' | 'changed' | 'invalid' | 'conflict',
    readonly status = 0,
    readonly origin: FailureOrigin = 'clinical',
    readonly reason?: FailureReason,
  ) {
    super(
      {
        unavailable: 'Servicio no disponible. Tus datos locales se conservan.',
        expired: 'Vuelve a autenticarte para reanudar los envíos. Tus capturas están guardadas.',
        denied: 'La cuenta no tiene permiso para esta operación.',
        changed: 'La cuenta cambió; se descartó la respuesta anterior.',
        invalid: 'La respuesta del servicio no es compatible.',
        conflict: 'El registro cambió. Actualiza su estado antes de repetir.',
      }[kind],
    );
  }
}
/**
 * Código de diagnóstico para la pantalla «Estado del acceso», por ejemplo `Q-ESPERA` o `G-502`.
 * Prefijo: `G` (Google/Supabase) o `Q` (QuimioCare). Nunca incluye textos de error, correos,
 * tokens ni identificadores; de un error inesperado solo se muestra su tipo (`INTERNO-TypeError`).
 */
export function failureCode(error: unknown): string {
  if (!(error instanceof SessionFailure)) {
    const name = error instanceof Error ? error.name : '';
    return 'INTERNO-' + (/^[A-Za-z]{1,40}$/.test(name) ? name : 'Error');
  }
  const detail =
    error.reason === 'timeout'
      ? 'ESPERA'
      : error.reason === 'network'
        ? 'RED'
        : error.reason === 'throttled'
          ? 'PAUSA'
          : error.kind === 'invalid'
            ? 'INCOMPATIBLE'
            : error.status > 0
              ? String(error.status)
              : 'SIN-ESTADO';
  return (error.origin === 'auth' ? 'G-' : 'Q-') + detail;
}
