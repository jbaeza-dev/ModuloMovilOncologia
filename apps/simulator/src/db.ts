import pg from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';

export type Database = pg.Pool;
export type SqlClient = Pick<PoolClient, 'query'>;

export function openDatabase(connectionString: string): Database {
  return new pg.Pool({ connectionString, max: 8, connectionTimeoutMillis: 5000 });
}

export async function transaction<T>(
  db: Database,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function one<T extends QueryResultRow>(
  client: SqlClient,
  query: string,
  values: unknown[] = [],
): Promise<T | undefined> {
  return (await client.query<T>(query, values)).rows[0];
}

export const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS qc_demo_schema_migration (version integer PRIMARY KEY, aplicado_en timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS qc_demo_meta (clave text PRIMARY KEY, valor text NOT NULL);
CREATE TABLE IF NOT EXISTS qc_demo_paciente (
 id uuid PRIMARY KEY, paciente_demo text NOT NULL UNIQUE CHECK(paciente_demo IN ('A','B')),
 perfil jsonb NOT NULL, perfil_clinico jsonb NOT NULL, tratamiento jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS qc_demo_escenario (
 paciente_id uuid PRIMARY KEY REFERENCES qc_demo_paciente(id), escenario text NOT NULL,
 aplicado_en timestamptz NOT NULL, generation uuid NOT NULL, session_epoch uuid NOT NULL,
 ack_signos_usado boolean NOT NULL DEFAULT false, ack_epro_usado boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS qc_demo_refresh (
 token_hash text PRIMARY KEY, paciente_id uuid NOT NULL REFERENCES qc_demo_paciente(id),
 vence_en timestamptz NOT NULL, consumido boolean NOT NULL DEFAULT false);
ALTER TABLE qc_demo_escenario ADD COLUMN IF NOT EXISTS session_epoch uuid;
UPDATE qc_demo_escenario SET session_epoch=generation WHERE session_epoch IS NULL;
ALTER TABLE qc_demo_escenario ALTER COLUMN session_epoch SET NOT NULL;
CREATE TABLE IF NOT EXISTS qc_demo_terminos (
 id uuid PRIMARY KEY, codigo text NOT NULL, version text NOT NULL, definicion jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS qc_demo_consentimiento (
 id uuid PRIMARY KEY, paciente_id uuid NOT NULL REFERENCES qc_demo_paciente(id),
 definicion_id uuid NOT NULL REFERENCES qc_demo_terminos(id), request jsonb NOT NULL,
 otorgado_el timestamptz NOT NULL, revocado boolean NOT NULL DEFAULT false, revocado_el timestamptz);
CREATE TABLE IF NOT EXISTS qc_demo_vinculacion (
 paciente_id uuid PRIMARY KEY REFERENCES qc_demo_paciente(id), codigo text NOT NULL UNIQUE,
 vence_en timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS formulario (
 id uuid PRIMARY KEY, codigo text NOT NULL, titulo text NOT NULL, descripcion text,
 tratamiento text NOT NULL, version integer NOT NULL, activo boolean NOT NULL,
 configuracion jsonb NOT NULL, fecha_creacion timestamptz NOT NULL, eliminado boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS pregunta (
 id uuid PRIMARY KEY, formulario_id uuid NOT NULL REFERENCES formulario(id), codigo text NOT NULL,
 titulo text NOT NULL, texto text, tipo text NOT NULL, requerida boolean NOT NULL, orden integer NOT NULL,
 opciones jsonb NOT NULL, configuracion jsonb NOT NULL, eliminado boolean NOT NULL DEFAULT false,
 UNIQUE(formulario_id,codigo));
CREATE TABLE IF NOT EXISTS contenido_educativo (
 id uuid PRIMARY KEY, profesional_id uuid NOT NULL, titulo text NOT NULL, descripcion text,
 tipo text NOT NULL, url text, categoria text, activo boolean NOT NULL, fecha_creacion timestamptz NOT NULL,
 carpeta_id uuid, archivo_mime varchar(100), archivo_tamano_bytes bigint,
 archivo_revision uuid, archivo_sha256 varchar(64));
CREATE TABLE IF NOT EXISTS qc_demo_signo (
 id uuid PRIMARY KEY, paciente_id uuid NOT NULL REFERENCES qc_demo_paciente(id),
 request jsonb NOT NULL, respuesta jsonb NOT NULL, fecha_subida timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS qc_demo_epro (
 id uuid PRIMARY KEY, paciente_id uuid NOT NULL REFERENCES qc_demo_paciente(id),
 formulario_id uuid NOT NULL REFERENCES formulario(id), request jsonb NOT NULL,
 respuesta jsonb NOT NULL, fecha_subida timestamptz NOT NULL DEFAULT now());
INSERT INTO qc_demo_schema_migration(version) VALUES(1) ON CONFLICT DO NOTHING;
INSERT INTO qc_demo_meta(clave,valor) VALUES('seed','quimiocare-rc32-v1') ON CONFLICT DO NOTHING;
`;

export async function migrate(db: Database): Promise<void> {
  await transaction(db, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('quimiocare-demo-migration'))");
    await client.query(MIGRATION_SQL);
  });
}
