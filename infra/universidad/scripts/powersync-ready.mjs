// Run privately inside the pinned PowerSync container; never expose the admin API in Nginx.
const token = process.env.PS_ADMIN_TOKEN;
if (!token) throw new Error('PowerSync admin credential is not configured.');
const ready = await fetch('http://127.0.0.1:8080/probes/readiness', {
  signal: AbortSignal.timeout(5000),
});
if (!ready.ok) throw new Error('PowerSync readiness failed.');
const response = await fetch('http://127.0.0.1:8080/api/admin/v1/diagnostics', {
  method: 'POST',
  signal: AbortSignal.timeout(10000),
  headers: { authorization: 'Token ' + token, 'content-type': 'application/json' },
  body: JSON.stringify({ include_content: false }),
});
if (!response.ok) throw new Error('PowerSync diagnostics unavailable.');
const data = (await response.json()).data;
const source = data?.connections;
const active = data?.active_sync_rules;
if (
  !Array.isArray(source) ||
  !source.length ||
  source.some((c) => c.connected !== true || c.errors?.length) ||
  !active ||
  active.errors?.length ||
  !Array.isArray(active.connections) ||
  !active.connections.length ||
  active.connections.some(
    (c) =>
      c.initial_replication_done !== true ||
      !Number.isFinite(c.replication_lag_bytes) ||
      c.replication_lag_bytes > 16777216 ||
      !c.tables?.length ||
      c.tables.some((t) => t.errors?.length),
  )
) {
  throw new Error('PowerSync replication is not ready, has errors, or exceeds 16 MiB lag.');
}
console.log(
  JSON.stringify({
    ready: true,
    initial_replication_done: true,
    replication_lag_bytes: Math.max(...active.connections.map((c) => c.replication_lag_bytes)),
  }),
);
