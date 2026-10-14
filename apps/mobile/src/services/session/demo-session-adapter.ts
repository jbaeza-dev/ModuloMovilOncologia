import type { SessionAdapter } from './session-adapter';
import type { SessionCredentials, SessionResult, SessionState, SessionUser } from './session-types';

export const DEMO_USERS: readonly SessionUser[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Paciente de prueba A',
    isDemo: true,
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Paciente de prueba B',
    isDemo: true,
  },
];

export class DemoSessionAdapter implements SessionAdapter {
  private currentUser: SessionUser | null = null;
  private state: SessionState = 'no_identity';

  getState(): SessionState {
    return this.state;
  }

  getCurrentUser(): SessionUser | null {
    return this.currentUser;
  }

  async selectDemoPatient(patientId: string): Promise<SessionResult> {
    const user = DEMO_USERS.find((u) => u.id === patientId);
    if (!user) {
      return {
        success: false,
        state: this.state,
        error: `Paciente de prueba '${patientId}' no reconocido.`,
      };
    }
    this.currentUser = user;
    this.state = 'context_ready';
    return {
      success: true,
      state: this.state,
      user,
    };
  }

  async login(_credentials: SessionCredentials): Promise<SessionResult> {
    void _credentials;
    return {
      success: false,
      state: this.state,
      error:
        'El inicio de sesión con credenciales requiere conexión al servidor central, disponible en una etapa posterior. Utiliza la selección de paciente de demostración.',
    };
  }

  async logout(): Promise<void> {
    this.currentUser = null;
    this.state = 'no_identity';
  }
}
