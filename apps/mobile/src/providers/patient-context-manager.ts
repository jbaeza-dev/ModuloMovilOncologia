import type { SqlConnection } from '../data/local/core/sql';
import {
  ALLOWED_NOTIFICATION_DESTINATIONS,
  type NotificationJobPayload,
} from '../data/local/reminders/reminder-types';
import type { NotificationCoordinator } from '../services/reminders/notification-coordinator';
import type { SessionAdapter } from '../services/session/session-adapter';
import type { AssistantAdapter } from '../services/assistant/assistant-adapter';
import { AssistantController } from '../services/assistant/assistant-controller';
import { cancelActiveBulkDownload } from '../features/education/bulk-download-coordinator';

export type CloseReason = 'change_patient' | 'manual_close' | 'session_required';

export type TeardownResult = {
  success: boolean;
  cancelledPatientId: string | null;
  pendingNotificationsCount: number;
  /** Operaciones que no terminaron dentro del límite de espera; el cierre siguió igual. */
  unfinishedOperations: number;
  error?: string;
};

/** Tiempo máximo que el cierre espera a las operaciones en curso antes de borrar la sesión. */
export const DRAIN_TIMEOUT_MS = 10_000;

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
  id: number;
  payload: NotificationJobPayload;
  dedupeKey: string;
  epoch: number;
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
  cancelNotifications?: () => Promise<void>;
}

export class PatientContextManager {
  private database: SqlConnection | null = null;
  private coordinator: NotificationCoordinator | null = null;
  public readonly sessionAdapter: SessionAdapter;
  public readonly assistantAdapter: AssistantAdapter;
  private router: RouterAdapter;
  private newId: () => string;
  private onStateChange?: () => void;
  private cancelNotifications?: () => Promise<void>;

  private patientId: string | null = null;
  private contextEpoch = 0;
  private activeOperations = 0;
  private drainResolvers = new Set<() => void>();
  private activeTeardownPromise: Promise<TeardownResult> | null = null;
  private isClosing = false;
  private selecting = false;

  private nextNotificationAttemptToken = 0;
  private nextNotificationIntentId = 0;
  private inFlightNotifications = new Map<string, number>();
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
    this.cancelNotifications = options.cancelNotifications;

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
    return new Set(this.inFlightNotifications.keys());
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
    const outgoingCoordinator = this.coordinator;
    this.isClosing = true;
    this.patientId = null;
    this.sessionAdapter.cancelRequests?.();

    // Cancelar descargas masivas en curso para el paciente saliente de inmediato.
    // Esto asegura que la descarga se interrumpa tras completar el archivo que
    // esté en vuelo y no comience los siguientes, permitiendo que el drenaje
    // no espere la cola completa y que funcione incluso si Educación está desmontada.
    if (outgoingPatientId) {
      cancelActiveBulkDownload(outgoingPatientId);
    }

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
        let unfinishedOperations = 0;

        try {
          // 1. Aguardar que concluyan las operaciones atómicas en curso sin truncarlas, con un
          // límite: una operación colgada no puede impedir que se borren las credenciales. Sus
          // solicitudes ya se cancelaron en la fase 1 y la base se cierra al terminar el cierre.
          if (this.activeOperations > 0) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            let resolveDrain!: () => void;
            const drained = new Promise<void>((resolve) => {
              resolveDrain = resolve;
              this.drainResolvers.add(resolve);
            });
            const timedOut = new Promise<void>((resolve) => {
              timer = setTimeout(resolve, DRAIN_TIMEOUT_MS);
            });
            await Promise.race([drained, timedOut]);
            clearTimeout(timer);
            this.drainResolvers.delete(resolveDrain);
            unfinishedOperations = this.activeOperations;
          }

          // 2. Cancelar agenda nativa del paciente saliente con el coordinador activo y limpiar notificaciones
          if (this.cancelNotifications) {
            await this.cancelNotifications().catch(() => undefined);
          }
          if (outgoingCoordinator && outgoingPatientId) {
            try {
              const cancelResult =
                await outgoingCoordinator.cancelPatientSchedule(outgoingPatientId);
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
            cancelSuccess = false;
            teardownError =
              'No se pudo conservar el cierre de sesión; reintenta antes de cambiar de cuenta.';
            console.warn('[Teardown] No se pudo completar el cierre de sesión.');
            void sessionErr;
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
            unfinishedOperations,
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

  async restoreSession(): Promise<void> {
    const result = await this.sessionAdapter.restore?.();
    if (result?.success && result.user)
      this.activateUser(result.user.localPatientId ?? result.user.id, false);
  }
  private activateUser(id: string, navigate = true) {
    this.contextEpoch += 1;
    this.patientId = id;
    this.assistantController.setContext(id, this.contextEpoch);
    this.notify();
    if (navigate) this.router.replace('/(tabs)');
  }
  async authenticate(): Promise<void> {
    if (this.selecting) throw new Error('Ya hay un acceso en curso.');
    this.selecting = true;
    try {
      if (this.patientId) await this.closeActiveContext('manual_close');
      if (this.activeTeardownPromise) await this.activeTeardownPromise;
      const result = await this.sessionAdapter.login({});
      if (!result.success || !result.user)
        throw new Error(result.error ?? 'No se pudo autenticar la cuenta.');
      this.activateUser(result.user.localPatientId ?? result.user.id);
    } finally {
      this.selecting = false;
    }
  }
  async selectPatient(newPatientId: string): Promise<void> {
    if (!this.sessionAdapter.selectDemoPatient)
      throw new Error('La selección manual de paciente solo está disponible en modo demostración.');
    if (this.selecting) throw new Error('Ya hay un acceso en curso.');
    this.selecting = true;
    try {
      if (this.patientId) await this.closeActiveContext('change_patient');
      if (this.activeTeardownPromise) await this.activeTeardownPromise;
      const previous = this.sessionAdapter.getCurrentUser();
      if (!this.patientId && previous)
        throw new Error('Reintenta el cierre de la cuenta anterior antes de cambiar de paciente.');
      const result = await this.sessionAdapter.selectDemoPatient(newPatientId);
      if (!result.success || !result.user)
        throw new Error(result.error ?? 'No se pudo autenticar al paciente de demostración.');
      this.activateUser(result.user.localPatientId ?? newPatientId);
    } finally {
      this.selecting = false;
    }
  }

  async processPendingNotificationIntent(): Promise<NotificationOpenResult> {
    const pending = this.pendingNotificationIntent;
    if (!pending) {
      return { status: 'discarded', navigated: false };
    }
    if (!this.patientId || pending.payload.pacienteId !== this.patientId || this.isClosing) {
      return { status: 'pending_saved', navigated: false };
    }
    return this.handleNotificationOpen(pending.payload, pending.dedupeKey, pending.id);
  }

  async handleNotificationOpen(
    payload: NotificationJobPayload,
    dedupeKey?: string,
    targetIntentId?: number,
  ): Promise<NotificationOpenResult> {
    let attemptToken: number | null = null;

    // 1. Verificación centralizada de deduplicación
    if (dedupeKey) {
      if (this.completedNotifications.has(dedupeKey) || this.inFlightNotifications.has(dedupeKey)) {
        return { status: 'duplicate', navigated: false };
      }
      attemptToken = ++this.nextNotificationAttemptToken;
      // Registrar el procesamiento en vuelo con su token único ANTES de cualquier await
      this.inFlightNotifications.set(dedupeKey, attemptToken);
    }

    let navigatedSuccessfully = false;
    let status: NotificationOpenStatus = 'discarded';
    const startEpoch = this.contextEpoch;
    const currentId = this.patientId;

    try {
      // Si el contexto está en cierre, o no hay paciente activo, o no coincide con el payload
      if (this.isClosing || !currentId || currentId !== payload.pacienteId) {
        if (dedupeKey && !this.isClosing && this.contextEpoch === startEpoch) {
          this.pendingNotificationIntent = {
            id: ++this.nextNotificationIntentId,
            payload,
            dedupeKey,
            epoch: startEpoch,
          };
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
      // 1. Liberar inFlight ÚNICAMENTE si la reserva registrada sigue siendo la de este intento específico
      if (dedupeKey && attemptToken !== null) {
        if (this.inFlightNotifications.get(dedupeKey) === attemptToken) {
          this.inFlightNotifications.delete(dedupeKey);
        }
        // 2. Marcar como completado ÚNICAMENTE tras navegación exitosa en el contexto vigente
        if (
          navigatedSuccessfully &&
          this.contextEpoch === startEpoch &&
          this.patientId === currentId
        ) {
          this.completedNotifications.add(dedupeKey);
        }
      }

      // 3. Gestión de intención pendiente:
      if (dedupeKey) {
        const isContextStillValid =
          !this.isClosing &&
          this.contextEpoch === startEpoch &&
          this.patientId === payload.pacienteId;

        if (status === 'transient_failure' && isContextStillValid) {
          // Si ocurrió un fallo transitorio y el contexto sigue vigente,
          // registrar o conservar la intención pendiente para permitir reintentos posteriores.
          const existingId =
            this.pendingNotificationIntent?.dedupeKey === dedupeKey
              ? this.pendingNotificationIntent.id
              : ++this.nextNotificationIntentId;
          this.pendingNotificationIntent = {
            id: existingId,
            payload,
            dedupeKey,
            epoch: startEpoch,
          };
        } else if (
          status === 'navigated' &&
          isContextStillValid &&
          this.pendingNotificationIntent?.dedupeKey === dedupeKey
        ) {
          // Si la apertura navegó con éxito en el contexto actual, retirar la intención pendiente
          this.pendingNotificationIntent = null;
        } else if (
          status === 'discarded' &&
          isContextStillValid &&
          this.pendingNotificationIntent?.dedupeKey === dedupeKey
        ) {
          // Si el contexto sigue vigente y este intento descartó definitivamente la intención:
          // Solo retirarla si la intención no ha sido reemplazada por una posterior.
          const isTargetIntentStillActive =
            targetIntentId !== undefined
              ? this.pendingNotificationIntent.id === targetIntentId
              : this.pendingNotificationIntent.epoch === startEpoch;

          if (isTargetIntentStillActive) {
            this.pendingNotificationIntent = null;
          }
        }
      }
    }
  }
}
