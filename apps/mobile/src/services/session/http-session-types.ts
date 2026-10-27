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
  revision: number;
}
export class SessionFailure extends Error {
  constructor(
    readonly kind: 'unavailable' | 'expired' | 'denied' | 'changed' | 'invalid' | 'conflict',
    readonly status = 0,
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
