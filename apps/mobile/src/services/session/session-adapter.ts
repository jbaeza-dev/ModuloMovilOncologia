import type { SessionCredentials, SessionResult, SessionState, SessionUser } from './session-types';

export interface SessionAdapter {
  getState(): SessionState;
  getCurrentUser(): SessionUser | null;
  login(credentials: SessionCredentials): Promise<SessionResult>;
  logout(): Promise<void>;
  restore?(): Promise<SessionResult>;
  cancelRequests?(): void;
  selectDemoPatient?(patientId: string): Promise<SessionResult>;
}
