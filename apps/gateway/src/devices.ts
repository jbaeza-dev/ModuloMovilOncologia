import { createHmac, timingSafeEqual } from 'node:crypto';
import type { GatewayRegistroPush, GatewaySesion, GatewaySesiones } from '@quimiocare/contracts';
import type { Database } from './persistence/database.js';
import { transaction } from './persistence/database.js';
import { GatewayError } from './http/errors.js';
import { UUID } from './auth.js';

interface DeviceRow {
  id: string;
  owner_id: string;
  installation_id: string;
  push_provider: 'expo' | 'fcm';
  push_token: string;
  platform: 'android';
  model: string | null;
  app_version: string | null;
  os_version: string | null;
  active: boolean;
  token_enabled: boolean;
  version: number;
  last_seen_at: Date;
  created_at: Date;
  updated_at: Date;
  cursor_time?: string;
}
const conflict = () => new GatewayError(409, 'REGISTRO_EN_CONFLICTO');
const notFound = () => new GatewayError(404, 'SESION_NO_ENCONTRADA');
function view(row: DeviceRow): GatewaySesion {
  return {
    id: row.id,
    instalacion_id: row.installation_id,
    plataforma: row.platform,
    proveedor_push: row.push_provider,
    activa: row.active,
    version: row.version,
    ultima_conexion: row.last_seen_at.toISOString(),
    creado_en: row.created_at.toISOString(),
    actualizado_en: row.updated_at.toISOString(),
    token_registrado: row.active && row.token_enabled,
  };
}
interface Cursor {
  v: 1;
  owner: string;
  filter: 'all';
  at: string;
  id: string;
}
export function devices(db: Database, cursorKey: string) {
  const mac = (value: string) =>
    createHmac('sha256', cursorKey)
      .update('gateway-devices-v1:' + value)
      .digest();
  function encode(value: Cursor) {
    const body = Buffer.from(JSON.stringify(value)).toString('base64url');
    return body + '.' + mac(body).toString('base64url');
  }
  function decode(value: string, owner: string): Cursor {
    try {
      if (value.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) throw new Error();
      const [body, signature] = value.split('.') as [string, string];
      const actual = Buffer.from(signature, 'base64url'),
        expected = mac(body);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
        throw new Error();
      const cursor = JSON.parse(Buffer.from(body, 'base64url').toString()) as Cursor;
      if (
        cursor.v !== 1 ||
        cursor.owner !== owner ||
        cursor.filter !== 'all' ||
        !UUID.test(cursor.id) ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(cursor.at) ||
        !Number.isFinite(Date.parse(cursor.at))
      )
        throw new Error();
      return cursor;
    } catch {
      throw new GatewayError(422, 'DATOS_INVALIDOS');
    }
  }
  return {
    async register(
      owner: string,
      body: GatewayRegistroPush,
    ): Promise<{ status: 200 | 201; body: { sesion: GatewaySesion } }> {
      try {
        return await transaction(db, async (client) => {
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
            'device:' + body.sesion_id.toLowerCase(),
          ]);
          const existing = (
            await client.query<DeviceRow>('SELECT * FROM gw_device WHERE id=$1 FOR UPDATE', [
              body.sesion_id,
            ])
          ).rows[0];
          if (existing) {
            if (existing.owner_id !== owner) throw conflict();
            if (!existing.active) throw new GatewayError(409, 'SESION_REVOCADA');
            if (existing.installation_id !== body.instalacion_id.toLowerCase()) throw conflict();
            const same =
              existing.push_provider === body.proveedor_push &&
              existing.push_token === body.token_push &&
              existing.model === (body.modelo ?? null) &&
              existing.app_version === (body.version_app ?? null) &&
              existing.os_version === (body.version_so ?? null);
            if (!same && body.version_esperada !== existing.version)
              throw new GatewayError(409, 'VERSION_EN_CONFLICTO');
            const row = (
              await client.query<DeviceRow>(
                `UPDATE gw_device SET last_seen_at=clock_timestamp(),
              push_provider=$3,push_token=$4,model=$5,app_version=$6,os_version=$7,
              version=version+$8,updated_at=CASE WHEN $8=1 THEN clock_timestamp() ELSE updated_at END,
              token_enabled=CASE WHEN $8=1 THEN true ELSE token_enabled END
              WHERE id=$1 AND owner_id=$2 RETURNING *`,
                [
                  body.sesion_id,
                  owner,
                  body.proveedor_push,
                  body.token_push,
                  body.modelo ?? null,
                  body.version_app ?? null,
                  body.version_so ?? null,
                  same ? 0 : 1,
                ],
              )
            ).rows[0]!;
            return { status: 200 as const, body: { sesion: view(row) } };
          }
          if (body.version_esperada !== undefined && body.version_esperada !== 1)
            throw new GatewayError(409, 'VERSION_EN_CONFLICTO');
          const row = (
            await client.query<DeviceRow>(
              `INSERT INTO gw_device(id,owner_id,installation_id,push_provider,push_token,platform,model,app_version,os_version)
            VALUES($1,$2,$3,$4,$5,'android',$6,$7,$8) RETURNING *`,
              [
                body.sesion_id,
                owner,
                body.instalacion_id,
                body.proveedor_push,
                body.token_push,
                body.modelo ?? null,
                body.version_app ?? null,
                body.version_so ?? null,
              ],
            )
          ).rows[0]!;
          return { status: 201 as const, body: { sesion: view(row) } };
        });
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
          throw conflict();
        throw error;
      }
    },
    async list(owner: string, limit = 20, cursor?: string): Promise<GatewaySesiones> {
      const decoded = cursor ? decode(cursor, owner) : null;
      const rows = (
        await db.query<DeviceRow>(
          `SELECT *,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time
        FROM gw_device WHERE owner_id=$1 AND ($2::timestamptz IS NULL OR created_at<$2 OR (created_at=$2 AND id>$3::uuid))
        ORDER BY created_at DESC,id ASC LIMIT $4`,
          [owner, decoded?.at ?? null, decoded?.id ?? null, limit + 1],
        )
      ).rows;
      const page = rows.slice(0, limit),
        last = page.at(-1);
      return {
        items: page.map(view),
        next_cursor:
          rows.length > limit && last
            ? encode({ v: 1, owner, filter: 'all', at: last.cursor_time!, id: last.id })
            : null,
      };
    },
    async get(owner: string, id: string) {
      const row = (
        await db.query<DeviceRow>('SELECT * FROM gw_device WHERE owner_id=$1 AND id=$2', [
          owner,
          id,
        ])
      ).rows[0];
      if (!row) throw notFound();
      return { sesion: view(row) };
    },
    async revoke(owner: string, id: string) {
      await transaction(db, async (client) => {
        const row = (
          await client.query<DeviceRow>(
            'SELECT * FROM gw_device WHERE owner_id=$1 AND id=$2 FOR UPDATE',
            [owner, id],
          )
        ).rows[0];
        if (!row) throw notFound();
        if (row.active) {
          await client.query(
            'UPDATE gw_device SET active=false,token_enabled=false,revoked_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1 WHERE owner_id=$1 AND id=$2',
            [owner, id],
          );
          await client.query(
            "UPDATE gw_dispatch SET status='cancelled',next_attempt_at=NULL WHERE owner_id=$1 AND session_id=$2 AND status IN ('reserved','retry','sending')",
            [owner, id],
          );
        }
      });
    },
  };
}
