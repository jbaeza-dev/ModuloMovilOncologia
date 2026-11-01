import { readConfig } from './config.js';
import { openDatabase, transaction } from './db.js';
const config = readConfig();
const emails = (process.env.EVALUATION_PATIENT_EMAILS ?? '').split(',').filter(Boolean);
if (emails.some((email) => !/^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/.test(email)))
  throw new Error('Invalid evaluation patient email list.');
const db = openDatabase(config.databaseUrl);
try {
  await transaction(db, async (client) => {
    for (const email of emails)
      await client.query(
        'INSERT INTO qc_demo_invitacion_paciente(email,nombre,activo) VALUES($1,$2,true) ON CONFLICT(email) DO NOTHING',
        [email.toLowerCase(), 'Paciente de evaluación'],
      );
  });
  console.log(
    'Patient invitations provisioned. Existing permissions were preserved; no operators granted.',
  );
} finally {
  await db.end();
}
