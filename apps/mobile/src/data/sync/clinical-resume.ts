import type { PowerSyncBackendConnector } from '@powersync/common';
import type { SqlConnection } from '../local/core/sql';
import type { HttpSessionAdapter } from '../../services/session/http-session-adapter';
import type { ClinicalScope } from './clinical-command';
import { retrySessionCommands } from './session-pause';

export interface ClinicalConnectionControllerOptions {
  store: { closed: boolean; pauseCode: string | null };
  scope: ClinicalScope;
  endpoint: string | null;
  session: Pick<HttpSessionAdapter, 'getCurrentUser' | 'getSnapshot'>;
  connection: Pick<SqlConnection, 'run'>;
  getConnector: () => PowerSyncBackendConnector;
  signal: AbortSignal;
  database: {
    connect: (connector: PowerSyncBackendConnector) => Promise<void>;
    disconnect: () => Promise<void>;
  };
  clearPauseTimer?: () => void;
}

export interface ClinicalConnectionController {
  resume(retryPaused?: boolean | 'session'): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  triggerPendingUpload(): Promise<void>;
}

export function createClinicalConnectionController(
  options: ClinicalConnectionControllerOptions,
): ClinicalConnectionController {
  const {
    store,
    scope,
    endpoint,
    session,
    connection,
    getConnector,
    signal,
    database,
    clearPauseTimer,
  } = options;

  let connected = false;
  let inFlightResume: Promise<void> | null = null;
  let inFlightDisconnect: Promise<void> | null = null;

  async function resume(retryPaused: boolean | 'session' = true): Promise<void> {
    if (store.closed || signal.aborted || session.getCurrentUser()?.id !== scope.owner) return;
    clearPauseTimer?.();

    // Si hay una desconexión en curso, esperar a que termine antes de evaluar la reanudación
    if (inFlightDisconnect) {
      await inFlightDisconnect;
    }
    if (store.closed || signal.aborted || session.getCurrentUser()?.id !== scope.owner) return;

    // Si ya hay una reanudación concurrente en curso, compartir la misma promesa (sin conexiones duplicadas)
    if (inFlightResume) {
      return inFlightResume;
    }

    if (connected) {
      if (retryPaused === 'session') {
        const isAuthorized = session.getSnapshot().uploadAllowed;
        if (isAuthorized) {
          await retrySessionCommands(connection, scope);
          store.pauseCode = null;
          await connection.run("DELETE FROM qc_storage_control WHERE id='runtime:pause'");
        }
      }
      return;
    }

    const currentResume = (async () => {
      if (!endpoint) {
        store.pauseCode = 'SIN_CONFIGURACION';
        return;
      }

      if (retryPaused === 'session') {
        const isAuthorized = session.getSnapshot().uploadAllowed;
        if (isAuthorized) {
          await retrySessionCommands(connection, scope);
          store.pauseCode = null;
          await connection.run("DELETE FROM qc_storage_control WHERE id='runtime:pause'");
        } else {
          return;
        }
      } else if (retryPaused === true) {
        await connection.run(
          "UPDATE qc_clinical_command SET status='pendiente',error_json=NULL WHERE owner=? AND environment=? AND status='pausado'",
          [scope.owner, scope.environment],
        );
        store.pauseCode = null;
        await connection.run("DELETE FROM qc_storage_control WHERE id='runtime:pause'");
      } else {
        if (!store.pauseCode) {
          await connection.run("DELETE FROM qc_storage_control WHERE id='runtime:pause'");
        }
      }

      if (store.pauseCode) {
        return;
      }
      if (store.closed || signal.aborted || session.getCurrentUser()?.id !== scope.owner) return;
      if (!session.getSnapshot().uploadAllowed) {
        return;
      }

      try {
        await database.connect(getConnector());
      } catch (error) {
        connected = false;
        throw error;
      }

      // Validación post-conexión: Si durante el connect asíncrono se solicitó desconexión,
      // se pausó, cerró o revocó la autorización, no dejar la conexión abierta
      if (
        store.closed ||
        signal.aborted ||
        session.getCurrentUser()?.id !== scope.owner ||
        store.pauseCode !== null ||
        !session.getSnapshot().uploadAllowed ||
        inFlightDisconnect !== null
      ) {
        connected = false;
        await database.disconnect().catch(() => undefined);
        return;
      }

      connected = true;
    })();

    inFlightResume = currentResume;
    try {
      await currentResume;
    } finally {
      if (inFlightResume === currentResume) {
        inFlightResume = null;
      }
    }
  }

  async function disconnect(): Promise<void> {
    if (inFlightDisconnect) {
      return inFlightDisconnect;
    }

    const pending = (async () => {
      // Si hay una conexión en curso, esperar a que termine/falle antes de desconectar
      if (inFlightResume) {
        await inFlightResume.catch(() => undefined);
      }
      if (connected) {
        connected = false;
        await database.disconnect();
      }
    })();

    inFlightDisconnect = pending;
    try {
      await pending;
    } finally {
      if (inFlightDisconnect === pending) {
        inFlightDisconnect = null;
      }
    }
  }

  async function triggerPendingUpload(): Promise<void> {
    if (store.closed || signal.aborted || session.getCurrentUser()?.id !== scope.owner) return;
    if (store.pauseCode || !session.getSnapshot().uploadAllowed) return;
    if (!connected) {
      await resume('session');
      return;
    }
    const connector = getConnector() as { uploadData?: (db: unknown) => Promise<void> };
    if (connector && typeof connector.uploadData === 'function') {
      try {
        await connector.uploadData(database);
      } catch {
        // Pausas se registran en connector.uploadData si ocurre un error clínico
      }
    }
  }

  return {
    resume,
    disconnect,
    isConnected: () => connected,
    triggerPendingUpload,
  };
}

// Compatibilidad directa
export type ClinicalResumeOptions = ClinicalConnectionControllerOptions;

export function createClinicalResume(
  options: ClinicalConnectionControllerOptions,
): (retryPaused?: boolean | 'session') => Promise<void> {
  const controller = createClinicalConnectionController(options);
  return controller.resume;
}
