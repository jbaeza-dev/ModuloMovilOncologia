import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { PowerSyncDatabase } from '@powersync/react-native';
import {
  AgendaCoordinator,
  notificationPayload,
  localAgendaData,
  type AgendaBinding,
} from './agenda-coordinator';
import { ExpoAgendaNotifications } from './agenda-notifications';
import type { HttpSessionAdapter } from '../session/http-session-adapter';
import { nativeVault } from '../session/native-session';
import { object, isUuid } from '../session/response-checks';
import type { ClinicalStore } from '../../data/sync/native-runtime';
import {
  protectedDirectory,
  privateSyncLogger,
  assertEncryptedDatabase,
} from '../../data/sync/native-archive';
import { protectedKey } from '../../data/sync/native-cipher';
import { clinicalSyncSchema } from '../../data/sync/schema';
import { createSyncConnection } from '../../data/sync/sql-connection';
const TASK = 'quimiocare-agenda-p06',
  ACTIVE = 'quimiocare.p06.active';
interface NativeBinding extends AgendaBinding {
  filename: string;
  sessionScope: string;
}
let foreground: { binding: NativeBinding; coordinator: AgendaCoordinator } | null = null;
let backgroundQueue: Promise<unknown> = Promise.resolve();
async function readBinding() {
  const raw = await SecureStore.getItemAsync(ACTIVE);
  if (!raw) return null;
  const v: unknown = JSON.parse(raw);
  if (
    !object(v) ||
    !isUuid(v.owner) ||
    !isUuid(v.sessionId) ||
    !isUuid(v.installationId) ||
    typeof v.environment !== 'string' ||
    typeof v.contextKey !== 'string' ||
    typeof v.localPatientId !== 'string' ||
    typeof v.sessionScope !== 'string' ||
    typeof v.filename !== 'string' ||
    !/^clinical_[0-9a-f]{32}\.db$/.test(v.filename)
  )
    throw new Error('Asociación local inválida.');
  return v as unknown as NativeBinding;
}
async function isActive(binding: NativeBinding) {
  const current = await readBinding();
  if (!current || JSON.stringify(current) !== JSON.stringify(binding)) return false;
  const raw = await nativeVault(binding.sessionScope).read('active');
  if (!raw) return false;
  const session: unknown = JSON.parse(raw);
  return (
    object(session) &&
    session.scope === binding.sessionScope &&
    object(session.credentials) &&
    session.credentials.owner === binding.owner
  );
}
async function handle(data: unknown, opened = false) {
  const binding = await readBinding();
  if (!binding || !(await isActive(binding))) return null;
  if (
    foreground &&
    foreground.binding.contextKey === binding.contextKey &&
    foreground.binding.sessionId === binding.sessionId
  ) {
    return notificationPayload(data)
      ? foreground.coordinator.processPush(data)
      : foreground.coordinator.observe(data, opened ? 'opened' : 'received');
  }
  const directory = protectedDirectory(),
    file = new File(directory, binding.filename);
  if (!file.exists) return null;
  const key = await protectedKey('database:' + binding.environment + ':' + binding.owner, true);
  // No migrations, catalog writes, connect() or clinical uploader in this headless path.
  const database = new PowerSyncDatabase({
    schema: clinicalSyncSchema,
    logger: privateSyncLogger,
    database: {
      dbFilename: binding.filename,
      dbLocation: directory.uri.replace(/^file:\/\//, ''),
      sqliteOptions: { encryptionKey: key },
    },
  });
  try {
    await database.waitForReady();
    const connection = createSyncConnection(database);
    await assertEncryptedDatabase(connection);
    const version = await connection.first<{ user_version: number }>('PRAGMA user_version');
    if (![13, 14, 15, 16, 17].includes(version?.user_version ?? 0) || !(await isActive(binding)))
      return null;
    let valid = true;
    // Recheck the durable active identity before each native side effect, including a concurrent logout.
    const adapter = new ExpoAgendaNotifications();
    const guarded = {
      permission: () => adapter.permission(),
      list: () => adapter.list(),
      cancel: async (id: string) => {
        valid = await isActive(binding);
        if (!valid) throw new Error('Contexto cerrado.');
        return adapter.cancel(id);
      },
      schedule: async (...args: Parameters<ExpoAgendaNotifications['schedule']>) => {
        valid = await isActive(binding);
        if (!valid) throw new Error('Contexto cerrado.');
        return adapter.schedule(...args);
      },
    };
    const active = new AgendaCoordinator(
      connection,
      binding,
      guarded,
      () => {
        if (!valid) throw new Error('Contexto cerrado.');
      },
      Crypto.randomUUID,
    );
    return notificationPayload(data)
      ? await active.processPush(data)
      : await active.observe(data, opened ? 'opened' : 'received');
  } finally {
    await database.close();
  }
}
export function handleAgendaNotification(data: unknown, opened = false) {
  const next = backgroundQueue.then(() => handle(data, opened));
  backgroundQueue = next.catch(() => undefined);
  return next;
}
if (!TaskManager.isTaskDefined(TASK))
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(TASK, async ({ data, error }) => {
    if (error || !data) return;
    // Android data-only tasks expose the JSON string as data.dataString; foreground listeners expose content.data.
    let payload: unknown = data;
    if (object(data) && object(data.data) && typeof data.data.dataString === 'string') {
      try {
        payload = JSON.parse(data.data.dataString);
      } catch {
        return;
      }
    } else if (
      object(data) &&
      object(data.notification) &&
      object(data.notification.request) &&
      object(data.notification.request.content)
    )
      payload = data.notification.request.content.data;
    if (notificationPayload(payload) || localAgendaData(payload))
      await handleAgendaNotification(payload, object(data) && 'actionIdentifier' in data).catch(
        () => undefined,
      );
  });
export async function activateNativeAgenda(session: HttpSessionAdapter, store: ClinicalStore) {
  const owner = store.scope.owner,
    signal = session.getContextSignal();
  const assert = () => {
    if (store.closed || signal.aborted || session.getCurrentUser()?.id !== owner)
      throw new Error('Contexto de agenda cerrado.');
  };
  assert();
  const associationRaw = await session.vault.read('device-association-' + owner),
    installationId = await session.vault.read('installation');
  assert();
  if (!associationRaw || !installationId || !isUuid(installationId)) return null;
  const sessionId: unknown = JSON.parse(associationRaw);
  if (!isUuid(sessionId)) return null;
  const prior = await readBinding();
  assert();
  let accepted: boolean;
  try {
    const r = await session.request('gateway', '/api/gateway/dispositivo/sesiones/' + sessionId);
    assert();
    accepted =
      r.status === 200 &&
      object(r.body) &&
      object(r.body.sesion) &&
      r.body.sesion.id === sessionId &&
      r.body.sesion.instalacion_id === installationId &&
      r.body.sesion.activa === true;
    if (!accepted) {
      if (prior?.owner === owner && prior.sessionId === sessionId) {
        const old = new AgendaCoordinator(
          store.connection,
          prior,
          new ExpoAgendaNotifications(),
          assert,
          Crypto.randomUUID,
        );
        await old.close();
        await SecureStore.deleteItemAsync(ACTIVE);
      }
      return null;
    }
  } catch {
    assert();
    accepted =
      prior?.owner === owner &&
      prior.sessionId === sessionId &&
      prior.environment === store.scope.environment;
  }
  if (!accepted) return null;
  const contextKey = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    store.scope.environment + '|' + owner,
  );
  const binding: NativeBinding = {
    ...store.scope,
    sessionId,
    installationId,
    contextKey,
    filename: store.filename,
    sessionScope: session.config.scope,
  };
  assert();
  const coordinator = new AgendaCoordinator(
    store.connection,
    binding,
    new ExpoAgendaNotifications(),
    assert,
    Crypto.randomUUID,
  );
  await SecureStore.setItemAsync(ACTIVE, JSON.stringify(binding), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  assert();
  foreground = { binding, coordinator };
  let closed = false;
  const unregister = session.registerConnector(async () => {
    if (closed) return;
    await coordinator.close();
    const current = await readBinding();
    if (current?.sessionId === sessionId && current.contextKey === contextKey)
      await SecureStore.deleteItemAsync(ACTIVE);
    if (foreground?.coordinator === coordinator) foreground = null;
    closed = true;
  });
  let taskRegistered = false;
  try {
    if (await TaskManager.isAvailableAsync()) {
      await Notifications.registerTaskAsync(TASK);
      taskRegistered = true;
    }
  } catch {
    /* Local backup remains active; UI exposes missing background capability. */
  }
  return {
    coordinator,
    taskRegistered,
    dispose() {
      coordinator.deactivate();
      unregister();
      if (foreground?.coordinator === coordinator) foreground = null;
    },
  };
}
