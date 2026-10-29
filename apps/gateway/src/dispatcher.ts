import { randomUUID } from 'node:crypto';
import type { GatewayPayloadNotificacion } from '@quimiocare/contracts';
import {
  agendaDate,
  shiftAgendaDate,
  reminderOccurrence,
  parseOccurrenceId,
} from '@quimiocare/contracts/agenda';
import { lockAgenda, reminderView, type ReminderRow } from './agenda.js';
import { transaction, type Database } from './persistence/database.js';
import type { PoolClient } from 'pg';
import type { PushProvider, PushResult } from './push-provider.js';

interface DispatchRow {
  occurrence_id: string;
  session_id: string;
  owner_id: string;
  reminder_id: string;
  reminder_version: number;
  scheduled_at: Date;
  backup_at: Date;
  expires_at: Date;
  status: string;
  attempts: number;
  lease_id: string | null;
  lease_until: Date | null;
  next_attempt_at: Date | null;
}
interface Device {
  id: string;
  owner_id: string;
  active: boolean;
  token_enabled: boolean;
  push_provider: string;
  push_token: string;
  version: number;
}
interface Claim {
  row: DispatchRow;
  token: string;
  deviceVersion: number;
  lease: string;
  data: GatewayPayloadNotificacion;
}
export interface DispatchOptions {
  now?: () => Date;
  random?: () => number;
  leaseMs?: number;
  batchSize?: number;
}
/** Multiple processes share PostgreSQL reservations and leases. Network effects cannot be exactly-once. */
export class AgendaDispatcher {
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly leaseMs: number;
  private readonly batch: number;
  constructor(
    private readonly db: Database,
    private readonly provider: PushProvider,
    options: DispatchOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
    this.leaseMs = Math.max(15000, options.leaseMs ?? 20000);
    this.batch = Math.max(1, Math.min(100, options.batchSize ?? 50));
  }
  async reserve(): Promise<number> {
    const owners = await this.db.query<{ owner_id: string }>(
      "SELECT DISTINCT r.owner_id FROM gw_reminder r JOIN gw_device d ON d.owner_id=r.owner_id WHERE r.active AND r.deleted_at IS NULL AND d.active AND d.token_enabled AND d.push_provider='expo'",
    );
    let inserted = 0;
    for (const { owner_id: owner } of owners.rows)
      inserted += await transaction(this.db, async (client) => {
        await lockAgenda(client, owner);
        const now = this.now(),
          date = agendaDate(now.toISOString());
        const rules = await client.query<ReminderRow>(
          'SELECT r.*,r.starts_on::text AS starts_on,r.ends_on::text AS ends_on FROM gw_reminder r WHERE owner_id=$1 AND active AND deleted_at IS NULL',
          [owner],
        );
        const devices = await client.query<{ id: string }>(
          "SELECT id FROM gw_device WHERE owner_id=$1 AND active AND token_enabled AND push_provider='expo'",
          [owner],
        );
        const completed = await client.query<{ kind: string; date: string }>(
          'SELECT kind,local_date::text AS date FROM gw_daily_state WHERE owner_id=$1 AND local_date BETWEEN $2::date AND $3::date',
          [owner, shiftAgendaDate(date, -1), date],
        );
        const done = new Set(completed.rows.map((v) => v.kind + ':' + v.date));
        let count = 0;
        for (const row of rules.rows)
          for (const day of [shiftAgendaDate(date, -1), date])
            for (const hour of reminderView(row).horas) {
              const occurrence = reminderOccurrence(reminderView(row), day, hour);
              if (
                !occurrence ||
                Date.parse(occurrence.programado_en) > now.getTime() ||
                Date.parse(occurrence.vence_en) <= now.getTime() ||
                (row.kind !== 'medicacion' && done.has(row.kind + ':' + day))
              )
                continue;
              for (const device of devices.rows) {
                const result = await client.query(
                  'INSERT INTO gw_dispatch(occurrence_id,session_id,owner_id,reminder_id,reminder_version,scheduled_at,backup_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',
                  [
                    occurrence.ocurrencia_id,
                    device.id,
                    owner,
                    row.id,
                    row.version,
                    occurrence.programado_en,
                    occurrence.respaldo_en,
                    occurrence.vence_en,
                  ],
                );
                count += result.rowCount ?? 0;
              }
            }
        return count;
      });
    return inserted;
  }
  private async eligible(client: PoolClient, row: DispatchRow): Promise<Device | null> {
    const device = (
      await client.query<Device>('SELECT * FROM gw_device WHERE owner_id=$1 AND id=$2 FOR UPDATE', [
        row.owner_id,
        row.session_id,
      ])
    ).rows[0];
    if (!device?.active || !device.token_enabled || device.push_provider !== 'expo') return null;
    const rule = (
      await client.query<ReminderRow>(
        'SELECT r.*,r.starts_on::text AS starts_on,r.ends_on::text AS ends_on FROM gw_reminder r WHERE owner_id=$1 AND id=$2',
        [row.owner_id, row.reminder_id],
      )
    ).rows[0];
    const parsed = parseOccurrenceId(row.occurrence_id);
    if (
      !rule ||
      rule.deleted_at ||
      !rule.active ||
      rule.version !== row.reminder_version ||
      !parsed
    )
      return null;
    const occurrence = reminderOccurrence(reminderView(rule), parsed.date, parsed.time);
    if (
      !occurrence ||
      occurrence.ocurrencia_id !== row.occurrence_id ||
      occurrence.programado_en !== row.scheduled_at.toISOString()
    )
      return null;
    if (
      rule.kind !== 'medicacion' &&
      (
        await client.query(
          'SELECT 1 FROM gw_daily_state WHERE owner_id=$1 AND kind=$2 AND local_date=$3::date',
          [row.owner_id, rule.kind, parsed.date],
        )
      ).rowCount
    )
      return null;
    return device;
  }
  private async claim(candidate: DispatchRow): Promise<Claim | null> {
    return transaction(this.db, async (client) => {
      await lockAgenda(client, candidate.owner_id);
      // Same lock order as agenda mutations and device revocation: agenda -> device -> dispatch.
      const device = await this.eligible(client, candidate);
      const row = (
        await client.query<DispatchRow>(
          'SELECT * FROM gw_dispatch WHERE occurrence_id=$1 AND session_id=$2 FOR UPDATE',
          [candidate.occurrence_id, candidate.session_id],
        )
      ).rows[0];
      if (!row || !['reserved', 'retry', 'sending'].includes(row.status)) return null;
      const at = this.now();
      if (row.status === 'sending') {
        if (row.lease_until && row.lease_until > at) return null;
        await client.query(
          "UPDATE gw_dispatch_attempt SET state='uncertain',error_code='WorkerLeaseExpired',finished_at=$2 WHERE id=$1 AND state='started'",
          [row.lease_id, at],
        );
      } else if (row.next_attempt_at && row.next_attempt_at > at) return null;
      const expired = row.expires_at <= at;
      if (!device || expired || row.attempts >= 3) {
        await client.query(
          'UPDATE gw_dispatch SET status=$3,next_attempt_at=NULL,lease_id=NULL,lease_until=NULL WHERE occurrence_id=$1 AND session_id=$2',
          [
            row.occurrence_id,
            row.session_id,
            expired ? 'expired' : !device ? 'cancelled' : 'failed',
          ],
        );
        return null;
      }
      const lease = randomUUID(),
        ordinal = row.attempts + 1;
      await client.query(
        "UPDATE gw_dispatch SET status='sending',attempts=$3,lease_id=$4,lease_until=$5,next_attempt_at=NULL WHERE occurrence_id=$1 AND session_id=$2",
        [row.occurrence_id, row.session_id, ordinal, lease, new Date(at.getTime() + this.leaseMs)],
      );
      await client.query(
        "INSERT INTO gw_dispatch_attempt(id,occurrence_id,session_id,ordinal,device_version,state,started_at) VALUES($1,$2,$3,$4,$5,'started',$6)",
        [lease, row.occurrence_id, row.session_id, ordinal, device.version, at],
      );
      return {
        row: { ...row, attempts: ordinal },
        token: device.push_token,
        deviceVersion: device.version,
        lease,
        data: {
          tipo: 'recordatorio',
          sesion_id: row.session_id,
          recordatorio_id: row.reminder_id,
          version_recordatorio: row.reminder_version,
          ocurrencia_id: row.occurrence_id,
          programado_en: row.scheduled_at.toISOString(),
          respaldo_en: row.backup_at.toISOString(),
          vence_en: row.expires_at.toISOString(),
        },
      };
    });
  }
  private async revalidate(claim: Claim): Promise<boolean> {
    return transaction(this.db, async (client) => {
      await lockAgenda(client, claim.row.owner_id);
      const device = await this.eligible(client, claim.row);
      const row = (
        await client.query<DispatchRow>(
          'SELECT * FROM gw_dispatch WHERE occurrence_id=$1 AND session_id=$2 FOR UPDATE',
          [claim.row.occurrence_id, claim.row.session_id],
        )
      ).rows[0];
      return (
        !!device &&
        device.version === claim.deviceVersion &&
        device.push_token === claim.token &&
        row?.status === 'sending' &&
        row.lease_id === claim.lease &&
        row.expires_at > this.now() &&
        !!row.lease_until &&
        row.lease_until > this.now()
      );
    });
  }
  private async finish(claim: Claim, result: PushResult | { state: 'cancelled'; code: string }) {
    await transaction(this.db, async (client) => {
      const row = claim.row,
        at = this.now();
      await lockAgenda(client, row.owner_id);
      await client.query('SELECT id FROM gw_device WHERE owner_id=$1 AND id=$2 FOR UPDATE', [
        row.owner_id,
        row.session_id,
      ]);
      const current = (
        await client.query<DispatchRow>(
          'SELECT * FROM gw_dispatch WHERE occurrence_id=$1 AND session_id=$2 FOR UPDATE',
          [row.occurrence_id, row.session_id],
        )
      ).rows[0]!;
      // Audit an in-flight network result even if a concurrent completion/revocation cancelled the job.
      await client.query(
        "UPDATE gw_dispatch_attempt SET state=$2,ticket=$3,error_code=$4,finished_at=$5,receipt_status=$6 WHERE id=$1 AND state='started'",
        [
          claim.lease,
          result.state,
          result.state === 'accepted' ? result.ticket : null,
          result.state === 'accepted' ? null : result.code,
          at,
          result.state === 'accepted' ? 'pending' : null,
        ],
      );
      if (result.state !== 'accepted' && result.code === 'DeviceNotRegistered')
        await client.query(
          'UPDATE gw_device SET token_enabled=false,updated_at=$4 WHERE owner_id=$1 AND id=$2 AND version=$3',
          [row.owner_id, row.session_id, claim.deviceVersion, at],
        );
      if (current.status !== 'sending' || current.lease_id !== claim.lease) return;
      const retryAt = new Date(
        at.getTime() + 5000 * 2 ** (row.attempts - 1) + Math.floor(this.random() * 1000),
      );
      const retry =
        (result.state === 'temporary' || result.state === 'uncertain') &&
        row.attempts < 3 &&
        retryAt < row.expires_at;
      const status =
        result.state === 'accepted'
          ? 'sent'
          : result.state === 'cancelled'
            ? 'cancelled'
            : at >= row.expires_at
              ? 'expired'
              : retry
                ? 'retry'
                : 'failed';
      await client.query(
        'UPDATE gw_dispatch SET status=$3,next_attempt_at=$4,provider_ticket=$5,last_error_code=$6,lease_id=NULL,lease_until=NULL,receipt_status=$7 WHERE occurrence_id=$1 AND session_id=$2',
        [
          row.occurrence_id,
          row.session_id,
          status,
          retry ? retryAt : null,
          result.state === 'accepted' ? result.ticket : null,
          result.state === 'accepted' ? null : result.code,
          result.state === 'accepted' ? 'pending' : null,
        ],
      );
    });
  }
  async receipts(signal?: AbortSignal): Promise<number> {
    const at = this.now();
    const pending = await this.db.query<{
      id: string;
      ticket: string;
      owner_id: string;
      session_id: string;
      device_version: number;
      started_at: Date;
    }>(
      "SELECT a.id,a.ticket,d.owner_id,a.session_id,a.device_version,a.started_at FROM gw_dispatch_attempt a JOIN gw_dispatch d USING(occurrence_id,session_id) WHERE a.receipt_status='pending' AND a.started_at <= $1 AND (a.receipt_checked_at IS NULL OR a.receipt_checked_at <= $2) ORDER BY a.started_at LIMIT $3",
      [new Date(at.getTime() - 900000), new Date(at.getTime() - 60000), this.batch],
    );
    let checked = 0;
    for (const attempt of pending.rows) {
      if (signal?.aborted) break;
      const result = await this.provider.receipt(attempt.ticket, signal);
      await transaction(this.db, async (client) => {
        await client.query('SELECT id FROM gw_device WHERE owner_id=$1 AND id=$2 FOR UPDATE', [
          attempt.owner_id,
          attempt.session_id,
        ]);
        // Unknown is rechecked for at most 24 hours; it never becomes proof of client processing.
        const state =
          result.state === 'unknown' && at.getTime() - attempt.started_at.getTime() < 86400000
            ? 'pending'
            : result.state;
        await client.query(
          'UPDATE gw_dispatch_attempt SET receipt_status=$2,receipt_checked_at=$3,error_code=COALESCE($4,error_code) WHERE id=$1',
          [attempt.id, state, at, result.code ?? null],
        );
        if (result.code === 'DeviceNotRegistered')
          await client.query(
            'UPDATE gw_device SET token_enabled=false,updated_at=$4 WHERE owner_id=$1 AND id=$2 AND version=$3',
            [attempt.owner_id, attempt.session_id, attempt.device_version, at],
          );
        await client.query(
          'UPDATE gw_dispatch SET receipt_status=$2,receipt_checked_at=$3 WHERE provider_ticket=$1',
          [attempt.ticket, state, at],
        );
      });
      checked++;
    }
    return checked;
  }
  async tick(signal?: AbortSignal) {
    if (signal?.aborted) return { reserved: 0, attempted: 0, receipts: 0 };
    const reserved = await this.reserve();
    let attempted = 0;
    const candidates = await this.db.query<DispatchRow>(
      "SELECT * FROM gw_dispatch WHERE status IN ('reserved','retry','sending') AND (next_attempt_at IS NULL OR next_attempt_at <= $1) AND (status<>'sending' OR lease_until <= $1) ORDER BY scheduled_at,occurrence_id,session_id LIMIT $2",
      [this.now(), this.batch],
    );
    for (const row of candidates.rows) {
      if (signal?.aborted) break;
      const claim = await this.claim(row);
      if (!claim) continue;
      if (!(await this.revalidate(claim)) || signal?.aborted) {
        await this.finish(claim, { state: 'cancelled', code: 'ContextChangedBeforeSend' });
        continue;
      }
      let result: PushResult;
      try {
        result = await this.provider.send(claim.token, claim.data, signal);
      } catch {
        result = { state: 'uncertain', code: 'ProviderTransportUncertain' };
      }
      await this.finish(claim, result);
      attempted++;
    }
    return { reserved, attempted, receipts: await this.receipts(signal) };
  }
}
