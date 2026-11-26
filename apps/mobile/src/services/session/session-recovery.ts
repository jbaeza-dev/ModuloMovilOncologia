import type { HttpSessionAdapter } from './http-session-adapter';
import type { SessionSnapshot } from './http-session-types';

type Session = Pick<HttpSessionAdapter, 'getSnapshot' | 'subscribe' | 'refreshIdentity'>;
const retryDelays = [2000, 5000, 15000, 30000, 60000];
/** Sin vincular puede pasar mucho tiempo: la espera sigue creciendo para no consultar cada minuto. */
const unlinkedDelays = [...retryDelays, 120000, 300000];
const blockedStates = new Set([
  'no_identity',
  'closing',
  'unconfigured',
  'authenticating',
  'reauthenticating',
  'renewing',
  'preparing_storage',
  'expired',
  'access_denied',
]);
export function needsSessionRecovery(snapshot: SessionSnapshot): boolean {
  return (
    Boolean(snapshot.user) &&
    (snapshot.state === 'service_unavailable' ||
      snapshot.state === 'clinical_incomplete' ||
      (snapshot.state === 'context_ready' && (snapshot.stale || !snapshot.uploadAllowed)))
  );
}

/** Recupera lecturas y permisos; nunca acepta términos, inicia OAuth ni envía capturas. */
export class SessionRecovery {
  private foreground = false;
  private online: boolean | null = null;
  private disposed = false;
  private running = false;
  private attempt = 0;
  private owner: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly unsubscribe: () => void;
  constructor(
    private readonly session: Session,
    private readonly localTransport = false,
  ) {
    this.owner = session.getSnapshot().user?.id ?? null;
    this.unsubscribe = session.subscribe(() => this.changed());
  }
  setForeground(active: boolean) {
    const changed = this.foreground !== active;
    this.foreground = active;
    if (!active) this.clear();
    else if (changed) {
      this.attempt = 0;
      this.schedule(0, true);
    }
  }
  setOnline(online: boolean) {
    const recovered = online && this.online !== true;
    this.online = online;
    if (!online && !this.localTransport) this.clear();
    else if (recovered) {
      this.attempt = 0;
      this.schedule(0, true);
    }
  }
  dispose() {
    this.disposed = true;
    this.clear();
    this.unsubscribe();
  }
  private clear() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
  private eligible(force: boolean): boolean {
    const snapshot = this.session.getSnapshot();
    return (
      !this.disposed &&
      this.foreground &&
      (this.online !== false || this.localTransport) &&
      Boolean(snapshot.user) &&
      !blockedStates.has(snapshot.state) &&
      (force || needsSessionRecovery(snapshot))
    );
  }
  private changed() {
    const snapshot = this.session.getSnapshot();
    if (this.owner !== (snapshot.user?.id ?? null)) {
      this.owner = snapshot.user?.id ?? null;
      this.attempt = 0;
      this.clear();
    }
    if (!needsSessionRecovery(snapshot)) {
      this.clear();
      if (snapshot.state === 'context_ready' && snapshot.uploadAllowed && !snapshot.stale)
        this.attempt = 0;
      return;
    }
    this.schedule(1000);
  }
  private schedule(delay: number, force = false) {
    if (!this.eligible(force) || this.running || this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.run(force);
    }, delay);
  }
  private async run(force: boolean) {
    if (!this.eligible(force) || this.running) return;
    this.running = true;
    try {
      await this.session.refreshIdentity();
    } catch {
      /* El adaptador conserva la identidad y publica la causa real del fallo. */
    } finally {
      this.running = false;
      if (this.eligible(false)) {
        const delays =
          this.session.getSnapshot().state === 'clinical_incomplete' ? unlinkedDelays : retryDelays;
        const delay = delays[Math.min(this.attempt, delays.length - 1)];
        this.attempt++;
        this.schedule(delay);
      }
    }
  }
}
