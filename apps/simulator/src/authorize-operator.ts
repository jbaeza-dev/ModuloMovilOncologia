import { verifyAccess } from './auth.js';
import { readConfig } from './config.js';
import { openDatabase } from './db.js';
const config = readConfig();
if (config.authProvider !== 'supabase' || !process.env.OPERATOR_ACCESS_TOKEN)
  throw new Error('Supabase and OPERATOR_ACCESS_TOKEN in a private process environment required.');
const principal = await verifyAccess(config, process.env.OPERATOR_ACCESS_TOKEN);
if (!principal.email) throw new Error('Verified identity has no email.');
const db = openDatabase(config.databaseUrl);
try {
  await db.query(
    `INSERT INTO qc_demo_operador(id,auth_issuer,auth_subject,email,nombre,activo)
 VALUES($1::uuid,$2,$1::text,$3,$4,true) ON CONFLICT(auth_issuer,auth_subject) DO UPDATE SET activo=true`,
    [
      principal.id,
      config.issuer,
      principal.email,
      principal.displayName || 'Operador de evaluacion',
    ],
  );
  console.log('Verified operator authorized locally. No remote account changed.');
} finally {
  await db.end();
}
