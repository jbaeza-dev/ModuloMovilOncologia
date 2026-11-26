import type { SessionAdapter } from '../session-adapter';
import type { SessionResult, SessionState, SessionUser } from '../session-types';

/** Cuentas sintéticas de las pruebas; sus identificadores coinciden con los del arnés SQLite. */
export const TEST_USERS: readonly SessionUser[] = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Paciente de prueba A', isDemo: false },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Paciente de prueba B', isDemo: false },
];

/**
 * Solo para pruebas: simula el acceso con Google. La prueba elige con `useAccount` la cuenta que
 * «vuelve» de Google y la app entra con `login()`, igual que un paciente real.
 */
export class FakeSessionAdapter implements SessionAdapter {
  private nextUser: SessionUser = TEST_USERS[0]!;
  private currentUser: SessionUser | null = null;
  private state: SessionState = 'no_identity';

  useAccount(id: string): this {
    this.nextUser = TEST_USERS.find((u) => u.id === id) ?? { id, name: 'Paciente', isDemo: false };
    return this;
  }

  getState(): SessionState {
    return this.state;
  }

  getCurrentUser(): SessionUser | null {
    return this.currentUser;
  }

  async login(): Promise<SessionResult> {
    this.currentUser = this.nextUser;
    this.state = 'context_ready';
    return { success: true, state: this.state, user: this.currentUser };
  }

  async logout(): Promise<void> {
    this.currentUser = null;
    this.state = 'no_identity';
  }
}

/** Entra con la cuenta indicada a través del flujo normal de acceso del gestor. */
export async function signInAs(
  manager: { authenticate(): Promise<void> },
  session: FakeSessionAdapter,
  id: string,
): Promise<void> {
  session.useAccount(id);
  await manager.authenticate();
}
