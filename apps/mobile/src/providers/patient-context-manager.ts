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

export type NotificationOpenStatus =
  | 'navigated'
  | 'duplicate'
  | 'pending_saved'
  | 'discarded'
  | 'transient_failure';

export interface NotificationOpenResult {
  status: NotificationOpenStatus;
  navigated: boolean;
  error?: unknown;
}

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
  public readonly sessionAdapter: SessionAdapter;
  public readonly assistantAdapter: AssistantAdapter;
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

  setRouter(router: RouterAdapter): void {
    this.router = router;
  }

  changePatient(): void {
    void this.closeActiveContext('change_patient');
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
    this.completedNotifications.clear();

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

  async processPendingNotificationIntent(): Promise<NotificationOpenResult> {
    const pending = this.pendingNotificationIntent;
    if (!pending) {
      return { status: 'discarded', navigated: false };
    }
    if (!this.patientId || pending.payload.pacienteId !== this.patientId || this.isClosing) {
      return { status: 'pending_saved', navigated: false };
    }
    return this.handleNotificationOpen(pending.payload, pending.dedupeKey);
  }

  async handleNotificationOpen(
    payload: NotificationJobPayload,
    dedupeKey?: string,
  ): Promise<NotificationOpenResult> {
    // 1. Verificación centralizada de deduplicación
    if (dedupeKey) {
      if (this.completedNotifications.has(dedupeKey) || this.inFlightNotifications.has(dedupeKey)) {
        return { status: 'duplicate', navigated: false };
      }
      // Registrar el procesamiento en vuelo ANTES de cualquier operación asíncrona / primer await
      this.inFlightNotifications.add(dedupeKey);
    }

    let navigatedSuccessfully = false;
    let status: NotificationOpenStatus = 'discarded';

    try {
      const startEpoch = this.contextEpoch;
      const currentId = this.patientId;

      // Si el contexto está en cierre, o no hay paciente activo, o no coincide con el payload
      if (this.isClosing || !currentId || currentId !== payload.pacienteId) {
        if (dedupeKey && !this.isClosing && this.contextEpoch === startEpoch) {
          this.pendingNotificationIntent = { payload, dedupeKey };
          status = 'pending_saved';
          return { status, navigated: false };
        }
        status = 'discarded';
        return { status, navigated: false };
      }

      if (!this.database) {
        // Base de datos aún no disponible es una condición transitoria
        status = 'transient_failure';
        return { status, navigated: false };
      }

      let row: {
        id: string;
        paciente_id: string;
        recordatorio_id: string;
        revision: number;
        tipo: string;
      } | null = null;

      try {
        row = await this.database.first<{
          id: string;
          paciente_id: string;
          recordatorio_id: string;
          revision: number;
          tipo: string;
        }>(
          'SELECT id, paciente_id, recordatorio_id, revision, tipo FROM notificacion_local WHERE id = ? AND paciente_id = ?',
          [payload.notificacionId, currentId],
        );
      } catch (dbErr) {
        status = 'transient_failure';
        return { status, navigated: false, error: dbErr };
      }

      // Comprobar si el contexto cambió o está en proceso de cierre durante la consulta
      if (this.patientId !== currentId || this.contextEpoch !== startEpoch || this.isClosing) {
        status = 'discarded';
        return { status, navigated: false };
      }

      if (!row) {
        status = 'discarded';
        return { status, navigated: false };
      }

      if (
        row.recordatorio_id !== payload.recordatorioId ||
        row.revision !== payload.revision ||
        row.tipo !== payload.tipo
      ) {
        status = 'discarded';
        return { status, navigated: false };
      }

      try {
        await this.database.run(
          'UPDATE notificacion_local SET abierta_en = ? WHERE id = ? AND paciente_id = ? AND abierta_en IS NULL',
          [new Date().toISOString(), payload.notificacionId, currentId],
        );
      } catch (dbErr) {
        status = 'transient_failure';
        return { status, navigated: false, error: dbErr };
      }

      // Comprobar nuevamente tras la actualización en SQLite
      if (this.patientId !== currentId || this.contextEpoch !== startEpoch || this.isClosing) {
        status = 'discarded';
        return { status, navigated: false };
      }

      if (ALLOWED_NOTIFICATION_DESTINATIONS.has(payload.destino)) {
        this.router.push(payload.destino);
        navigatedSuccessfully = true;
        status = 'navigated';
        return { status, navigated: true };
      }

      status = 'discarded';
      return { status, navigated: false };
    } catch (unexpectedErr) {
      console.warn('Fallo inesperado al procesar apertura de notificación:', unexpectedErr);
      status = 'transient_failure';
      return { status, navigated: false, error: unexpectedErr };
    } finally {
      // 1. Liberar inFlight siempre en finally
      if (dedupeKey) {
        this.inFlightNotifications.delete(dedupeKey);
        // 2. Marcar como completado ÚNICAMENTE tras navegación exitosa
        if (navigatedSuccessfully) {
          this.completedNotifications.add(dedupeKey);
        }
      }

      // 3. Gestión de intención pendiente:
      // Si la intención pendiente coincide con la clave procesada:
      // - Si navegó, fue descartada definitivamente o fue detectada como duplicado:
      //   retirar la intención pendiente.
      // - Si el resultado fue 'transient_failure' o 'pending_saved':
      //   SE CONSERVA para permitir reintentos cuando el entorno/SQLite esté listo.
      if (
        dedupeKey &&
        this.pendingNotificationIntent?.dedupeKey === dedupeKey &&
        (status === 'navigated' || status === 'discarded')
      ) {
        this.pendingNotificationIntent = null;
      }
    }
  }
}
