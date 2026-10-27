export type SessionState =
  | 'preparing_storage'
  | 'no_identity'
  | 'demo_selection'
  | 'context_ready'
  | 'authenticating'
  | 'reauthenticating'
  | 'access_denied'
  | 'unconfigured'
  | 'closing'
  | 'renewing'
  | 'expired'
  | 'service_unavailable'
  | 'profile_incomplete'
  | 'terms_pending'
  | 'clinical_incomplete';

export interface SessionUser {
  readonly id: string;
  readonly name: string;
  readonly isDemo: boolean;
  readonly localPatientId?: string;
}

export interface SessionCredentials {
  readonly email?: string;
  readonly password?: string;
}

export interface SessionResult {
  readonly success: boolean;
  readonly state: SessionState;
  readonly user?: SessionUser;
  readonly error?: string;
}
