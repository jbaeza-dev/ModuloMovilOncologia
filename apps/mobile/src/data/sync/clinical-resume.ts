import type { PowerSyncBackendConnector } from '@powersync/common';
import type { SqlConnection } from '../local/core/sql';
import type { HttpSessionAdapter } from '../../services/session/http-session-adapter';
import type { ClinicalScope } from './clinical-command';
import { retrySessionCommands } from './session-pause';

export interface ClinicalResumeOptions {
  store: { closed: boolean; pauseCode: string | null };
  scope: ClinicalScope;
  endpoint: string | null;
  session: Pick<HttpSessionAdapter, 'getCurrentUser' | 'getSnapshot'>;
  connection: Pick<SqlConnection, 'run'>;
  getConnector: () => PowerSyncBackendConnector;
  signal: AbortSignal;
  database: { connect: (connector: PowerSyncBackendConnector) => Promise<void> };
  getDisconnecting?: () => Promise<void> | null;
  clearPauseTimer?: () => void;
}

export function createClinicalResume(options: ClinicalResumeOptions) {
  const {
    store,
    scope,
    endpoint,
    session,
    connection,
    getConnector,
    signal,
    database,
    getDisconnecting,
    clearPauseTimer,
  } = options;
  let started = false;

  return async function resume(retryPaused: boolean | 'session' = true) {
    if (store.closed || signal.aborted || session.getCurrentUser()?.id !== scope.owner) return;
    clearPauseTimer?.();
    const disconnecting = getDisconnecting?.();
    if (disconnecting) await disconnecting;
    if (store.closed || signal.aborted || session.getCurrentUser()?.id !== scope.owner) return;
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
    if (!started) {
      started = true;
      try {
        await database.connect(getConnector());
      } catch (error) {
        started = false;
        throw error;
      }
    }
  };
}
