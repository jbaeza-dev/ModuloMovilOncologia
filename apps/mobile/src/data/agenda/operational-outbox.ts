import type { GatewayAcuse, GatewayCumplimiento } from '@quimiocare/contracts';
import type { SqlConnection } from '../local/core/sql';
import type { ClinicalScope } from '../sync/clinical-command';
import { isUuid, object } from '../../services/session/response-checks';
export type OperationalScope = Pick<ClinicalScope, 'owner' | 'environment'>;
export interface OperationalEvent {
  id: string;
  owner: string;
  environment: string;
  kind: 'completion' | 'receipt';
  body_json: string;
  created_at: string;
  status: 'pending' | 'acked' | 'conflict';
}
export function utf8Length(value: string) {
  let count = 0;
  for (const c of value) {
    const p = c.codePointAt(0)!;
    count += p < 128 ? 1 : p < 2048 ? 2 : p < 65536 ? 3 : 4;
  }
  return count;
}
/** Called inside the same durable transaction as SAVE/observation; never called on a draft or provider ticket. */
export async function enqueueOperational(
  tx: SqlConnection,
  scope: OperationalScope,
  kind: OperationalEvent['kind'],
  body: GatewayAcuse | GatewayCumplimiento,
  at: string,
) {
  if (!isUuid(body.operacion_id) || !isUuid(scope.owner) || !scope.environment)
    throw new Error('Evento operativo sin contexto válido.');
  const json = JSON.stringify(body, Object.keys(body).sort()),
    old = await tx.first<OperationalEvent>('SELECT * FROM qc_gateway_outbox WHERE id=?', [
      body.operacion_id,
    ]);
  if (old) {
    if (
      old.owner !== scope.owner ||
      old.environment !== scope.environment ||
      old.kind !== kind ||
      old.body_json !== json
    )
      throw new Error('El UUID identifica otro evento operativo.');
    return;
  }
  await tx.run(
    'INSERT INTO qc_gateway_outbox(id,owner,environment,kind,body_json,created_at) VALUES(?,?,?,?,?,?)',
    [body.operacion_id, scope.owner, scope.environment, kind, json, at],
  );
}
export function operationalOutbox(
  db: SqlConnection,
  scope: OperationalScope,
  request: (
    kind: OperationalEvent['kind'],
    body: { items: unknown[] },
  ) => Promise<{ status: number; body: unknown }>,
  assertContext: () => void,
  now = () => new Date().toISOString(),
) {
  let flushing: Promise<number> | null = null;
  async function flush() {
    assertContext();
    let acknowledged = 0;
    for (const kind of ['completion', 'receipt'] as const) {
      const candidates = await db.all<OperationalEvent>(
        "SELECT * FROM qc_gateway_outbox WHERE owner=? AND environment=? AND status='pending' AND kind=? ORDER BY created_at,id LIMIT 100",
        [scope.owner, scope.environment, kind],
      );
      const batch: OperationalEvent[] = [];
      let bytes = utf8Length('{"items":[]}');
      for (const row of candidates) {
        const size = utf8Length(row.body_json) + (batch.length ? 1 : 0);
        if (bytes + size > 65536) break;
        batch.push(row);
        bytes += size;
      }
      if (!batch.length) continue;
      assertContext();
      const response = await request(kind, { items: batch.map((v) => JSON.parse(v.body_json)) });
      assertContext();
      if (response.status === 409) {
        await db.transaction(async (tx) => {
          assertContext();
          for (const row of batch)
            await tx.run(
              "UPDATE qc_gateway_outbox SET status='conflict',error_code='OPERACION_EN_CONFLICTO' WHERE id=? AND owner=? AND environment=?",
              [row.id, scope.owner, scope.environment],
            );
        });
        throw new Error(
          'El servidor detectó un conflicto en los metadatos. Se conservaron los eventos.',
        );
      }
      const body = response.body;
      if (
        response.status !== 200 ||
        !object(body) ||
        !Array.isArray(body.items) ||
        body.items.length !== batch.length
      )
        throw new Error('No se confirmó el lote operativo.');
      const ids = new Set<string>();
      for (const ack of body.items) {
        if (
          !object(ack) ||
          typeof ack.operacion_id !== 'string' ||
          !batch.some((v) => v.id === ack.operacion_id) ||
          ids.has(ack.operacion_id) ||
          !['registrado', 'replay'].includes(String(ack.resultado))
        )
          throw new Error('Acuse operativo incoherente.');
        ids.add(ack.operacion_id);
      }
      await db.transaction(async (tx) => {
        assertContext();
        for (const row of batch) {
          await tx.run(
            "UPDATE qc_gateway_outbox SET status='acked',acked_at=?,error_code=NULL WHERE id=? AND owner=? AND environment=?",
            [now(), row.id, scope.owner, scope.environment],
          );
          if (kind === 'completion')
            await tx.run(
              "UPDATE qc_operational_event SET status='confirmado' WHERE record_id=? AND owner=?",
              [row.id, scope.owner],
            );
        }
      });
      acknowledged += batch.length;
    }
    return acknowledged;
  }
  return {
    flush: () =>
      (flushing ??= flush().finally(() => {
        flushing = null;
      })),
    pending: () =>
      db.all<OperationalEvent>(
        "SELECT * FROM qc_gateway_outbox WHERE owner=? AND environment=? AND status<>'acked' ORDER BY created_at,id",
        [scope.owner, scope.environment],
      ),
  };
}
