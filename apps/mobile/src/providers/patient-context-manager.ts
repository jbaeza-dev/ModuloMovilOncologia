import type { SqlConnection } from '../data/local/core/sql';
import {
  ALLOWED_NOTIFICATION_DESTINATIONS,
  type NotificationJobPayload,
} from '../data/local/reminders/reminder-types';
import type { NotificationCoordinator } from '../services/reminders/notification-coordinator';
import type { SessionAdapter } from '../services/session/session-adapter';
import type { AssistantAdapter } from '../services/assistant/assistant-adapter';
import { AssistantController } from '../services/assistant/assistant-controller';

export type CloseReason = 'change_patient' | 'manual_close' | 'session_required';

export type TeardownResult = {
  success: boolean;
  cancelledPatientId: string | null;
  pendingNotificationsCount: number;
  error?: string;
};

export interface PendingNotificationIntent {
  payload: NotificationJobPayload;
  dedupeKey: string;
}

export interface RouterAdapter {
  replace: (route: string) => void;
  push: (route: string) => void;
}

export interface PatientContextManagerOptions {
  database?: SqlConnection | null;
  coordinator?: NotificationCoordinator | null;
  sessionAdapter: SessionAdapter;
  assistantAdapter: AssistantAdapter;
  router: RouterAdapter;
  newId?: () => string;
  onStateChange?: () => void;
}

export class PatientContextManager {
  private database: SqlConnection | null = null;
  private coordinator: NotificationCoordinator | null = null;
  private sessionAdapter: SessionAdapter;
  private assistantAdapter: AssistantAdapter;
  private router: RouterAdapter;
  private newId: () => string;
  private onStateChange?: () => void;

  private patientId: string | null = null;
  private contextEpoch = 0;
  private activeOperations = 0;
  private drainResolvers = new Set<() => void>();
  private activeTeardownPromise: Promise<TeardownResult> | null = null;
  private isClosing = false;

  private inFlightNotifications = new Set<string>();
  private completedNotifications = new Set<string>();
  private pendingNotificationIntent: PendingNotificationIntent | null = null;

  public readonly assistantController: AssistantController;

  constructor(options: PatientContextManagerOptions) {
    this.database = options.database ?? null;
    this.coordinator = options.coordinator ?? null;
    this.sessionAdapter = options.sessionAdapter;
    this.assistantAdapter = options.assistantAdapter;
    this.router = options.router;
    this.newId = options.newId ?? (() => 'uuid-' + Math.random().toString(36).slice(2, 9));
    this.onStateChange = options.onStateChange;

    this.assistantController = new AssistantController(
      this.assistantAdapter,
      this.patientId,
      () => {
        void this.closeActiveContext('session_required');
      },
      this.newId,
    );
  }

  setDatabase(database: SqlConnection | null): void {
    this.database = database;
  }

  setCoordinator(coordinator: NotificationCoordinator | null): void {
    this.coordinator = coordinator;
  }

  getPatientId(): string | null {
    return this.patientId;
  }

  getContextEpoch(): number {
    return this.contextEpoch;
  }

  getIsClosing(): boolean {
    return this.isClosing;
  }

  getActiveOperations(): number {
    return this.activeOperations;
  }

  getActiveTeardownPromise(): Promise<TeardownResult> | null {
    return this.activeTeardownPromise;
  }

  getPendingNotificationIntent(): PendingNotificationIntent | null {
    return this.pendingNotificationIntent;
  }

  clearPendingNotificationIntent(): void {
    this.pendingNotificationIntent = null;
  }

  getInFlightNotifications(): Set<string> {
    return this.inFlightNotifications;
  }

  getCompletedNotifications(): Set<string> {
    return this.completedNotifications;
  }

  private notify(): void {
    this.onStateChange?.();
  }

  async trackOperation<T>(operation: () => Promise<T>): Promise<T> {
    if (this.isClosing) {
      throw new Error('Operación rechazada: el contexto se encuentra en proceso de cierre.');
    }
    this.activeOperations += 1;
    try {
      return await operation();
    } finally {
      this.activeOperations -= 1;
      if (this.activeOperations === 0) {
        this.drainResolvers.forEach((resolve) => resolve());
        this.drainResolvers.clear();
      }
    }
  }

  closeActiveContext(reason: CloseReason = 'manual_close'): Promise<TeardownResult> {
    if (this.activeTeardownPromise) {
      return this.activeTeardownPromise;
    }

    // --- FASE 1: TRANSICIÓN INMEDIATA (< 1 segundo, RNF-05 local) ---
    this.contextEpoch += 1;
    const currentEpoch = this.contextEpoch;
    const outgoingPatientId = this.patientId;
    this.isClosing = true;
    this.patientId = null;

    // Invalidar asistente en vuelo y limpiar memoria
    this.assistantController.abort();
    this.assistantController.setContext(null, this.contextEpoch);

    // Limpiar intenciones de notificación pendientes y dedupe
    this.pendingNotificationIntent = null;
    this.inFlightNotifications.clear();

    this.notify();

    // Redirección inmediata según motivo de salida
    if (reason === 'change_patient') {
      this.router.replace('/acceso/seleccionar-paciente');
    } else if (reason === 'session_required') {
      this.router.replace('/acceso?motivo=sesion_requerida');
    } else {
      this.router.replace('/acceso');
    }

    // --- FASE 2: DRENAJE SEGURO OBSERVABLE ---
    let resolveTeardown!: (res: TeardownResult) => void;
    const teardownPromise = new Promise<TeardownResult>((resolve) => {
      resolveTeardown = resolve;
    });
    this.activeTeardownPromise = teardownPromise;

    queueMicrotask(() => {
      void (async () => {
        let cancelSuccess = true;
        let pendingCount = 0;
        let teardownError: string | undefined;

        try {
          // 1. Aguardar que concluyan las operaciones atómicas en curso sin truncarlas
          if (this.activeOperations > 0) {
            await new Promise<void>((resolveDrain) => {
              this.drainResolvers.add(resolveDrain);
            });
          }

          // 2. Cancelar agenda nativa del paciente saliente con el coordinador activo
          if (this.coordinator && outgoingPatientId) {
            try {
              const cancelResult = await this.coordinator.cancelPatientSchedule(outgoingPatientId);
              cancelSuccess = cancelResult.success && cancelResult.pendingCount === 0;
              pendingCount = cancelResult.pendingCount;
              if (!cancelSuccess) {
                console.warn(
                  `[Teardown] Quedan ${pendingCount} cancelaciones pendientes para paciente saliente.`,
                );
              }
            } catch (cancelErr) {
              cancelSuccess = false;
              pendingCount = -1;
              teardownError = cancelErr instanceof Error ? cancelErr.message : String(cancelErr);
              console.warn('[Teardown] Excepción en cancelación de agenda nativa:', cancelErr);
            }
          }

          // 3. Limpiar identidad en el adaptador de sesión
          try {
            await this.sessionAdapter.logout();
          } catch (sessionErr) {
            console.warn('[Teardown] Excepción al cerrar sesión en adaptador:', sessionErr);
          }
        } catch (err) {
          cancelSuccess = false;
          teardownError = err instanceof Error ? err.message : String(err);
          console.warn('[Teardown] Excepción en drenaje seguro:', err);
        } finally {
          const result: TeardownResult = {
            success: cancelSuccess,
            cancelledPatientId: outgoingPatientId,
            pendingNotificationsCount: pendingCount,
            error: teardownError,
          };

          if (this.activeTeardownPromise === teardownPromise) {
            this.activeTeardownPromise = null;
          }
          if (this.contextEpoch === currentEpoch) {
            this.isClosing = false;
            this.notify();
          }

          resolveTeardown(result);
        }
      })();
    });

    return teardownPromise;
  }

  async selectPatient(newPatientId: string): Promise<void> {
    // 1. Validar que la selección manual está soportada
    if (!this.sessionAdapter.selectDemoPatient) {
      throw new Error('La selección manual de paciente solo está disponible en modo demostración.');
    }

    // 2. Si existe otro paciente activo, forzar el inicio del cierre de contexto inmediatamente (Fase 1 síncrona)
    const currentActiveId = this.patientId;
    let closePromise: Promise<TeardownResult> | null = null;
    if (currentActiveId && currentActiveId !== newPatientId) {
      closePromise = this.closeActiveContext('change_patient');
    }

    // 3. Si ya hay un cierre en curso o se inició recién, esperar que concluya el drenaje
    if (this.activeTeardownPromise) {
      await this.activeTeardownPromise;
    }
    if (closePromise) {
      await closePromise;
    }

    // 4. Seleccionar la identidad en el adaptador de sesión
    const sessionResult = await this.sessionAdapter.selectDemoPatient(newPatientId);
    if (!sessionResult.success) {
      throw new Error(
        sessionResult.error ?? `Paciente '${newPatientId}' no válido para demostración.`,
      );
    }

    // 5. Activar el nuevo contexto
    this.contextEpoch += 1;
    this.patientId = newPatientId;
    this.assistantController.setContext(newPatientId, this.contextEpoch);
    this.notify();

    // 6. Navegar hacia (tabs)
    this.router.replace('/(tabs)');
  }

  async handleNotificationOpen(
    payload: NotificationJobPayload,
    dedupeKey?: string,
  ): Promise<boolean> {
    let navigatedSuccessfully = false;
    try {
      const startEpoch = this.contextEpoch;
      const currentId = this.patientId;
      if (this.isClosing || !currentId || currentId !== payload.pacienteId) {
        if (dedupeKey && !this.isClosing && this.contextEpoch === startEpoch) {
          this.pendingNotificationIntent = { payload, dedupeKey };
        }
        return false;
      }

      if (!this.database) return false;

      const row = await this.database.first<{
        id: string;
        paciente_id: string;
        recordatorio_id: string;
        revision: number;
        tipo: string;
      }>(
        'SELECT id, paciente_id, recordatorio_id, revision, tipo FROM notificacion_local WHERE id = ? AND paciente_id = ?',
        [payload.notificacionId, currentId],
      );

      // Comprobar si el contexto cambió o está en proceso de cierre
      if (this.patientId !== currentId || this.contextEpoch !== startEpoch || this.isClosing) {
        return false;
      }

      if (!row) {
        return false;
      }

      if (
        row.recordatorio_id !== payload.recordatorioId ||
        row.revision !== payload.revision ||
        row.tipo !== payload.tipo
      ) {
        return false;
      }

      await this.database.run(
        'UPDATE notificacion_local SET abierta_en = ? WHERE id = ? AND paciente_id = ? AND abierta_en IS NULL',
        [new Date().toISOString(), payload.notificacionId, currentId],
      );

      // Comprobar nuevamente tras la actualización en SQLite
      if (this.patientId !== currentId || this.contextEpoch !== startEpoch || this.isClosing) {
        return false;
      }

      if (ALLOWED_NOTIFICATION_DESTINATIONS.has(payload.destino)) {
        this.router.push(payload.destino);
        navigatedSuccessfully = true;
        return true;
      }
      return false;
    } catch (err) {
      console.warn('Fallo transitorio al procesar apertura de notificación:', err);
      return false;
    } finally {
      if (dedupeKey) {
        this.inFlightNotifications.delete(dedupeKey);
        if (navigatedSuccessfully) {
          this.completedNotifications.add(dedupeKey);
        }
      }
    }
  }
}
