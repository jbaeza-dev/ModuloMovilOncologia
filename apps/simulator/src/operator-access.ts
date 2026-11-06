import { randomUUID } from 'node:crypto';
import type { SqlClient } from './db.js';
import type { SimulatorConfig } from './config.js';
import type { Principal } from './types.js';
import { ApiError } from './errors.js';

/** Undefined keeps explicitly provisioned operators; a configured list is authoritative. */
export async function ensureOperatorAccess(
  db: SqlClient,
  config: SimulatorConfig,
  principal: Principal,
) {
  if (config.operatorAllowedEmails === undefined) return;
  const email = principal.email?.trim().toLowerCase();
  if (
    principal.tipo !== 'external' ||
    principal.issuer !== config.issuer ||
    !email ||
    !config.operatorAllowedEmails.includes(email)
  )
    throw new ApiError(403, 'OPERADOR_NO_AUTORIZADO', 'Cuenta fuera de la lista de operadores.');
  const existing = (
    await db.query(
      'SELECT id,activo FROM qc_demo_operador WHERE auth_issuer=$1 AND auth_subject=$2',
      [config.issuer, principal.id],
    )
  ).rows[0];
  if (existing) {
    if (!existing.activo)
      throw new ApiError(403, 'OPERADOR_NO_AUTORIZADO', 'Operador desactivado.');
    return;
  }
  await db.query(
    `INSERT INTO qc_demo_operador(id,auth_issuer,auth_subject,email,nombre)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [
      randomUUID(),
      config.issuer,
      principal.id,
      email,
      principal.displayName || 'Operador de evaluación',
    ],
  );
}
