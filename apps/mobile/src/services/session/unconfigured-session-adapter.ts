import type { SessionAdapter } from './session-adapter';
import type { SessionCredentials, SessionResult, SessionState, SessionUser } from './session-types';

export class UnconfiguredSessionAdapter implements SessionAdapter {
  getState(): SessionState {
    return 'unconfigured';
  }

  getCurrentUser(): SessionUser | null {
    return null;
  }

  async login(_credentials: SessionCredentials): Promise<SessionResult> {
    void _credentials;
    return {
      success: false,
      state: 'unconfigured',
      error:
        'Los servicios de autenticación y sincronización con el servidor central no están configurados en esta versión local.',
    };
  }

  async logout(): Promise<void> {
    // Sin estado que limpiar
  }
}
