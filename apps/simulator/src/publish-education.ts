import { readConfig } from './config.js';
import { openDatabase } from './db.js';
import { publishEducationMaterials } from './education-materials.js';

const config = readConfig();
const db = openDatabase(config.databaseUrl);
try {
  const result = await publishEducationMaterials(db, config.publicBaseUrl);
  console.log(JSON.stringify({ event: 'education_published', ...result }));
} finally {
  await db.end();
}
