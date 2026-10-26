import { column, PowerSyncDatabase, Schema, Table } from '@powersync/react-native';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { parseProbeSession, type ProbeOptions } from './probe-options';

// Solo diagnóstico sintético. No abre, migra ni sube la base clínica actual.
const schema = new Schema({
  formulario: new Table({ titulo: column.text }),
  pregunta: new Table({ formulario_id: column.text, codigo: column.text }),
  contenido_educativo: new Table({ titulo: column.text, tipo: column.text }),
  p01_probe_notes: new Table({ created_at: column.text, marker: column.text }, { localOnly: true }),
});

async function selectSession(options: ProbeOptions, signal: AbortSignal, owner?: string) {
  const response = await fetch(options.clinicalUrl + '/__demo/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paciente_demo: options.patient }),
    signal,
  });
  if (!response.ok) throw new Error('No se pudo obtener sesión sintética: HTTP ' + response.status);
  return parseProbeSession(await response.json(), owner);
}

export type ProbeResult = {
  localRows: number;
  forms: number;
  questions: number;
  education: number;
  firstSyncComplete: boolean;
};

export class NativeP01Probe {
  private database: PowerSyncDatabase | null = null;
  private owner: string | null = null;
  private abort = new AbortController();

  async initialize(options: ProbeOptions) {
    // Identidades sintéticas fijas del dataset P01. Abrir localmente no requiere red.
    if (this.database) throw new Error('Cierra el contexto antes de inicializar otro.');
    this.owner =
      options.patient === 'A'
        ? '964d32f1-6941-579f-9f08-b60342194da9'
        : '2dcb04f2-a2ad-5ea4-b711-9acd7e570002';
    this.database = this.open(this.owner);
    await this.database.waitForReady();
  }

  private open(owner: string) {
    return new PowerSyncDatabase({
      schema,
      database: { dbFilename: 'p01-demo-' + owner + '.sqlite' },
    });
  }

  private requireDatabase() {
    if (!this.database || !this.owner) throw new Error('Inicializa la prueba primero.');
    return this.database;
  }

  async saveLocalMarker() {
    const db = this.requireDatabase();
    await db.execute('INSERT INTO p01_probe_notes (id, created_at, marker) VALUES (?, ?, ?)', [
      String(Date.now()),
      new Date().toISOString(),
      'P01: solo dato sintético local',
    ]);
    return this.read(false);
  }

  async reopen() {
    const db = this.requireDatabase();
    const owner = this.owner!;
    await db.close();
    this.database = this.open(owner);
    await this.database.waitForReady();
    return this.read(false);
  }

  async sync(options: ProbeOptions) {
    const db = this.requireDatabase();
    const owner = this.owner!;
    const previousCheckpoint = db.currentStatus.lastSyncedAt?.getTime() ?? 0;
    await db.connect({
      fetchCredentials: async () => {
        const session = await selectSession(options, this.abort.signal, owner);
        return { endpoint: options.syncUrl, token: session.token, expiresAt: session.expiresAt };
      },
      uploadData: async (database) => {
        const stats = await database.getUploadQueueStats();
        if (stats.count > 0) {
          throw new Error('Esta prueba es de lectura; no completa comandos clínicos desconocidos.');
        }
      },
    });
    const timeout = new AbortController();
    const abort = () => timeout.abort();
    this.abort.signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 30000);
    try {
      await db.waitForStatus(
        (status) =>
          status.connected &&
          Boolean(status.hasSynced) &&
          (status.lastSyncedAt?.getTime() ?? 0) > previousCheckpoint,
        timeout.signal,
      );
      if (timeout.signal.aborted)
        throw new Error('No se completó la primera sincronización en 30 s.');
      return await this.read(true);
    } finally {
      clearTimeout(timer);
      this.abort.signal.removeEventListener('abort', abort);
      await db.disconnect();
    }
  }

  async read(firstSyncComplete = false): Promise<ProbeResult> {
    const db = this.requireDatabase();
    const count = async (sql: string) => {
      const rows = await db.getAll<{ total: number }>(sql);
      return rows[0]?.total ?? 0;
    };
    return {
      localRows: await count('SELECT count(*) AS total FROM p01_probe_notes'),
      forms: await count('SELECT count(*) AS total FROM formulario'),
      questions: await count('SELECT count(*) AS total FROM pregunta'),
      education: await count('SELECT count(*) AS total FROM contenido_educativo'),
      firstSyncComplete,
    };
  }

  async close() {
    this.abort.abort();
    const db = this.database;
    this.database = null;
    this.owner = null;
    if (db) await db.close();
  }
}

// El token queda solo en RAM para que el operador lo utilice localmente; no se registra ni muestra.
export async function acquireProbePushToken(projectId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(projectId))
    throw new Error('Falta el UUID público del proyecto Expo.');
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('p01_transport', {
      name: 'Prueba de transporte P01',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error('Permiso de notificaciones no concedido.');
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}
