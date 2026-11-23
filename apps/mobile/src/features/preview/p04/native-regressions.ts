import * as Crypto from 'expo-crypto';
import type { HttpSessionAdapter } from '../../../services/session/http-session-adapter';
import { DEMO_USERS } from '../../../services/session/demo-session-adapter';
import { createPatientRepository } from '../../../data/local/repository';
import { ClinicalConnector } from '../../../data/sync/clinical-connector';
import { openClinicalStore, type ClinicalStore } from '../../../data/sync/native-runtime';
import type { ClinicalCommand } from '../../../data/sync/clinical-command';
import { listSetAside, retrySetAside } from '../../../data/sync/paused-command';

const cases = [
  'a05',
  'a07',
  'a08-renew',
  'a08-expired',
  'a08-denied',
  'a08-unavailable',
  'a09',
  'a10',
  'a11-remote',
  'a11-ack-write',
  'a11-reject-write',
  'a14-readonly',
  'a14-unknown',
];
const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Opt-in Android acceptance, real SDK/SQLite/HTTP. The fault server exists only on loopback. */
export async function runNativeRegressions(
  store: ClinicalStore,
  session: HttpSessionAdapter,
  databaseName: string,
  phase: string,
) {
  check(
    process.env.EXPO_PUBLIC_DEMO_MODE === 'true' &&
      process.env.EXPO_PUBLIC_P04_PROBE_ENABLED === 'true' &&
      process.env.EXPO_PUBLIC_P04_LAB_ONLY === 'true',
    'Regresión nativa deshabilitada.',
  );
  check(cases.includes(phase), 'Caso de regresión desconocido.');
  const base = process.env.EXPO_PUBLIC_CLINICAL_URL!;
  const control = async (kind: string, id?: string, extra: Record<string, unknown> = {}) => {
    const response = await fetch(base + '/__p04_lab/control', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, ...(id ? { id } : {}), ...extra }),
    });
    check(response.status === 200, 'No se pudo preparar la falla HTTP sintética.');
  };
  const inspect = async (id: string) => {
    const response = await fetch(base + '/__p04_lab/inspect?id=' + id);
    check(response.status === 200, 'No se pudo verificar la persistencia central.');
    return (await response.json()) as {
      remoteSigns: { id: string; owner: string; capturedAt: string }[];
      remoteForms: number;
      events: { operation?: string; status?: number; delayed?: boolean; id?: string }[];
    };
  };
  const capturedDates = new Map<string, string>();
  const capture = async (active: ClinicalStore) => {
    const id = Crypto.randomUUID(),
      queue = Crypto.randomUUID(),
      capturedAt = new Date().toISOString();
    let first = true;
    await createPatientRepository(
      active.connection,
      active.scope.localPatientId,
      () => {
        if (first) {
          first = false;
          return id;
        }
        return queue;
      },
      () => capturedAt,
      active.captureHook,
    ).createVitals({
      temperatura: 36.6,
      pulso: 72,
      presion_sistolica: 120,
      presion_diastolica: 80,
      saturacion_o2: 98,
    });
    capturedDates.set(id, capturedAt);
    return id;
  };
  const snapshot = async (active: ClinicalStore, id: string) => {
    const command = await active.connection.first<ClinicalCommand>(
      'SELECT * FROM qc_clinical_command WHERE id=?',
      [id],
    );
    check(command, 'Falta el comando clínico.');
    return {
      id: command!.id,
      owner: command!.owner,
      capturedAt: command!.captured_at,
      status: command!.status,
      ack: !!command!.ack_json,
      payloadSha256: await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        command!.payload_json,
      ),
      errorCode: command!.error_json
        ? (JSON.parse(command!.error_json) as { code?: string }).code
        : null,
    };
  };
  const same = (
    before: Awaited<ReturnType<typeof snapshot>>,
    after: Awaited<ReturnType<typeof snapshot>>,
  ) => {
    for (const key of ['id', 'owner', 'capturedAt', 'payloadSha256'] as const)
      check(before[key] === after[key], 'Cambió un campo inmutable: ' + key);
  };
  let pauseCode: string | null = null;
  const connector = (active: ClinicalStore) =>
    new ClinicalConnector(
      active.scope,
      process.env.EXPO_PUBLIC_POWERSYNC_URL!,
      session,
      active.connection,
      (code) => {
        pauseCode = code;
      },
    );
  const upload = async (active: ClinicalStore) => {
    pauseCode = null;
    try {
      await connector(active).uploadData(active.database);
      return { failed: false, pauseCode: null as string | null };
    } catch {
      return { failed: true, pauseCode };
    }
  };
  const pending = async (active: ClinicalStore) =>
    (await active.database.getUploadQueueStats()).count;
  const drain = async (active: ClinicalStore) => {
    await active.resume(true);
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && (await pending(active)) > 0) await delay(150);
    await active.disconnect();
    check((await pending(active)) === 0, 'La cola SDK no se vació tras recuperar el servicio.');
  };
  const login = async (which: 'A' | 'B') => {
    const response = await session.selectDemoPatient(DEMO_USERS[which === 'A' ? 0 : 1].id);
    check(response.success, 'Falló la reautenticación real de demostración.');
    if (session.getSnapshot().consent?.requiere_aceptacion) await session.acceptTerms();
  };
  const remote = async (id: string, expectedOwner: string, count = 1) => {
    const result = await inspect(id);
    check(result.remoteSigns.length === count, 'Conteo central inesperado.');
    if (count) {
      check(result.remoteSigns[0].owner === expectedOwner, 'Propietario remoto incorrecto.');
      check(
        result.remoteSigns[0].capturedAt === capturedDates.get(id),
        'La fecha original cambió en el servidor.',
      );
    }
    return result;
  };
  const result: Record<string, unknown> = {
    case: phase,
    realSdk: true,
    realHttp: true,
    isolatedDatabase: true,
  };
  const opened: ClinicalStore[] = [];
  try {
    await control('reset');
    if (phase.startsWith('a14-')) {
      const id = Crypto.randomUUID();
      if (phase === 'a14-readonly')
        await store.connection.run(
          'INSERT INTO formulario(id,codigo,titulo,version,activo) VALUES (?,?,?,1,1)',
          [id, 'P04_NO_PUBLICAR', 'Solo prueba negativa'],
        );
      else
        await store.connection.run(
          'INSERT INTO qc_upload_signos(id,owner,environment,captured_at,payload_json) VALUES (?,?,?,?,?)',
          [id, store.scope.owner, store.scope.environment, new Date().toISOString(), '{}'],
        );
      const attempt = await upload(store);
      check(
        attempt.failed &&
          attempt.pauseCode ===
            (phase === 'a14-readonly'
              ? 'COMANDO_SDK_NO_PERMITIDO'
              : 'PROPIETARIO_O_SNAPSHOT_INCORRECTO'),
        'No se diagnosticó la operación SDK no permitida.',
      );
      check((await pending(store)) === 1, 'Se descartó la operación desconocida.');
      const central = await inspect(id);
      check(
        central.remoteSigns.length === 0 &&
          central.remoteForms === 0 &&
          central.events.filter((e) => e.operation === 'C06').length === 0,
        'Una escritura de réplica provocó un alta clínica genérica.',
      );
      return { ...result, id, pauseCode: attempt.pauseCode, sdkPending: 1, remoteWrites: 0 };
    }
    const id = await capture(store),
      before = await snapshot(store, id);
    result.before = before;
    if (phase === 'a07') {
      await control('delay', id);
      const flight = upload(store);
      let committed = false;
      for (let i = 0; i < 30; i++) {
        if ((await inspect(id)).events.some((e) => e.operation === 'C06')) {
          committed = true;
          break;
        }
        await delay(100);
      }
      check(committed, 'La petición A no entró en vuelo.');
      await login('B');
      const outgoing = await flight;
      check(outgoing.failed, 'Se aceptó un ACK después de cancelar el contexto A.');
      const stopped = await snapshot(store, id);
      same(before, stopped);
      check(
        !stopped.ack && (await pending(store)) === 1,
        'La petición A cancelada se marcó aceptada localmente.',
      );
      await store.close();
      const b = await openClinicalStore(session, DEMO_USERS[1].id, { databaseName });
      opened.push(b);
      check(
        (
          await b.connection.first<{ n: number }>(
            'SELECT count(*) n FROM qc_clinical_command WHERE owner<>?',
            [b.scope.owner],
          )
        )?.n === 0,
        'B muestra comandos A.',
      );
      const bId = await capture(b);
      await control('pass');
      check(!(await upload(b)).failed, 'Falló la captura propia de B.');
      await remote(bId, b.scope.owner);
      await b.close();
      await login('A');
      const restored = await openClinicalStore(session, DEMO_USERS[0].id, { databaseName });
      opened.push(restored);
      await drain(restored);
      const after = await snapshot(restored, id);
      same(before, after);
      check(after.ack && after.status === 'aceptado', 'A no recuperó su ACK.');
      await remote(id, restored.scope.owner);
      return {
        ...result,
        after,
        bId,
        bRowsForeign: 0,
        oldAckDiscarded: true,
        originalQueueRecovered: true,
      };
    }
    if (phase === 'a05' || phase === 'a11-reject-write') await control('conflict', id);
    if (phase === 'a11-remote') await control('incoherent', id);
    if (phase === 'a11-ack-write' || phase === 'a11-reject-write') {
      const column = phase === 'a11-ack-write' ? 'ack_json' : 'error_json';
      await store.connection.run(
        `CREATE TRIGGER p04_lab_persistence_failure BEFORE UPDATE OF ${column} ON qc_clinical_command WHEN NEW.id='${id}' AND NEW.${column} IS NOT NULL BEGIN SELECT RAISE(ABORT,'P04_INJECTED_PERSISTENCE_FAILURE'); END`,
      );
    }
    if (phase === 'a08-renew') await control('expire', undefined, { failRefresh: false });
    if (phase === 'a08-expired') await control('expire', undefined, { failRefresh: true });
    if (phase === 'a08-denied') await control('denied');
    if (phase === 'a08-unavailable') await control('unavailable');
    if (phase === 'a09' || phase === 'a10') {
      const previousTerms = session.getSnapshot().terms?.id;
      await control('terms-required');
      await session.refreshConsent();
      check(
        session.getSnapshot().consent?.requiere_aceptacion && !session.getSnapshot().uploadAllowed,
        'Los términos nuevos no pausaron la autorización.',
      );
      if (phase === 'a09') {
        const oldAct = await session.request(
          'clinical',
          '/api/v1/pacientes/me/consentimientos',
          'POST',
          {
            definicion_terminos_id: previousTerms,
            operacion_id: Crypto.randomUUID(),
            codigo: 'TERMINOS_PLATAFORMA',
          },
        );
        check(oldAct.status === 409, 'Un acto nuevo de una edición antigua no devolvió 409.');
        result.oldEditionActStatus = oldAct.status;
      } else {
        await control('revoke-terms-ack');
        let firstFailed = false;
        try {
          await session.acceptTerms();
        } catch {
          firstFailed = true;
        }
        check(firstFailed, 'No se perdió la respuesta del acto revocado.');
        let replayDenied = false;
        try {
          await session.acceptTerms();
        } catch {
          replayDenied = true;
        }
        check(
          replayDenied &&
            !session.getSnapshot().uploadAllowed &&
            session.getSnapshot().consent?.consentimiento_actual?.revocado,
          'El replay revocado habilitó el envío.',
        );
        const r = await fetch(base + '/__p04_lab/events');
        const events = (await r.json()) as {
          events: { operation?: string; status?: number; id?: string; revoked?: boolean }[];
        };
        const replay = events.events
          .filter((e) => e.operation === 'C15' && e.status === 200 && e.revoked === true)
          .at(-1);
        check(replay, 'No se observó el 200 revocado real.');
        result.revokedReplayOperation = replay!.id;
        result.revokedReplayStatus = 200;
      }
    }
    const attempt = await upload(store),
      stopped = await snapshot(store, id);
    same(before, stopped);
    result.afterAttempt = stopped;
    result.pauseCode = attempt.pauseCode;
    if (phase === 'a05') {
      check(
        !attempt.failed &&
          stopped.status === 'rechazado' &&
          !stopped.ack &&
          stopped.errorCode === 'CONFLICTO_ESTADO',
        'El conflicto no quedó rechazado con snapshot conservado.',
      );
      check((await pending(store)) === 0, 'El rechazo durable no completó su operación SDK.');
      await remote(id, store.scope.owner);
      return { ...result, sdkPending: 0, remoteRows: 1 };
    }
    if (phase === 'a08-renew') {
      check(
        !attempt.failed && stopped.ack && (await pending(store)) === 0,
        'La renovación real no recuperó el envío SDK.',
      );
      await remote(id, store.scope.owner);
      return { ...result, sdkPending: 0, renewalRecovered: true };
    }
    if (phase === 'a11-remote') {
      // Un ACK incoherente aparta solo ese registro: la operación SDK se completa para no
      // detener la cola, y el registro espera a que el paciente lo reintente.
      check(
        !attempt.failed &&
          !stopped.ack &&
          stopped.status === 'pausado' &&
          stopped.errorCode === 'ACK_REMOTO_INCOHERENTE',
        'No se apartó el ACK incoherente.',
      );
      check((await pending(store)) === 0, 'El registro apartado siguió deteniendo la cola SDK.');
      check(
        (await listSetAside(store.connection, store.scope)).some((item) => item.id === id),
        'El registro apartado no aparece para que el paciente lo revise.',
      );
      await control('pass');
      await retrySetAside(store.connection, store.scope, id);
      await drain(store);
      const after = await snapshot(store, id);
      same(before, after);
      check(after.ack, 'El reintento del paciente no recuperó el ACK coherente.');
      await remote(id, store.scope.owner);
      return { ...result, after, sdkPending: 0, setAsideRetried: true };
    }
    check(
      attempt.failed && !stopped.ack && (await pending(store)) === 1,
      'El fallo se convirtió en un ACK o descartó su operación SDK.',
    );
    if (phase === 'a11-ack-write' || phase === 'a11-reject-write') {
      check(
        stopped.status === 'pendiente',
        'La falla de persistencia cambió el resultado durable.',
      );
      await store.connection.run('DROP TRIGGER p04_lab_persistence_failure');
      await control(phase === 'a11-reject-write' ? 'conflict' : 'pass', id);
      await drain(store);
      const after = await snapshot(store, id);
      same(before, after);
      check(
        phase === 'a11-reject-write'
          ? after.status === 'rechazado' && !after.ack
          : after.status === 'aceptado' && after.ack,
        'La recuperación de persistencia no produjo un resultado durable.',
      );
      await remote(id, store.scope.owner);
      return { ...result, after, sdkPending: 0, persistenceFailureRetainedQueue: true };
    }
    await remote(id, store.scope.owner, 0);
    const extra = await capture(store),
      extraBefore = await snapshot(store, extra);
    check((await pending(store)) === 2, 'La sesión pausada impidió guardar otra captura local.');
    result.localCaptureDuringPause = extraBefore;
    if (phase === 'a09') {
      await session.acceptTerms();
      await drain(store);
      const after = await snapshot(store, id);
      same(before, after);
      check(after.ack, 'Aceptar términos no reanudó el envío.');
      await remote(id, store.scope.owner);
      await remote(extra, store.scope.owner);
      return { ...result, after, sdkPending: 0 };
    }
    await control('reset');
    await login('A');
    await store.close();
    const restored = await openClinicalStore(session, DEMO_USERS[0].id, { databaseName });
    opened.push(restored);
    await drain(restored);
    const after = await snapshot(restored, id),
      extraAfter = await snapshot(restored, extra);
    same(before, after);
    same(extraBefore, extraAfter);
    check(after.ack && extraAfter.ack, 'La reautenticación no recuperó las capturas conservadas.');
    await remote(id, restored.scope.owner);
    await remote(extra, restored.scope.owner);
    return { ...result, after, extraAfter, sdkPending: 0 };
  } finally {
    for (const active of opened) await active.close().catch(() => undefined);
    await control('reset').catch(() => undefined);
  }
}
