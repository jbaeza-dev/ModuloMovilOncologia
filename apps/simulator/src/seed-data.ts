import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { fixtures } from '@quimiocare/contracts';
import type { Database, SqlClient } from './db.js';
import { one, transaction } from './db.js';
import { ApiError } from './errors.js';
import { PATIENTS } from './types.js';
import type { FormDefinition, ObjectValue } from './types.js';

interface MobileFixtures {
  operaciones: Record<string, { response: ObjectValue }>;
}
export const mobileFixtures = fixtures.mobile as unknown as MobileFixtures;
export const FORMS = [
  (fixtures.provisionalForm as unknown as { formulario: FormDefinition }).formulario,
  (fixtures.conditions as unknown as { formulario: FormDefinition }).formulario,
  (fixtures.exclusivityExamples as unknown as { formulario: FormDefinition }).formulario,
];
export const FOLLOWUP_FORM = fixtures.followupForm.formulario as unknown as FormDefinition;
export const ACTIVE_FORMS = [FOLLOWUP_FORM, FORMS[1]!, FORMS[2]!];
export const ORIGINAL_TERMS_ID = '783218b5-da7c-5495-83b4-dfd5330ced29';
export const NEW_TERMS_ID = 'e93105f1-ffcf-5b99-84af-772808e39991';
export const APPROVED_TERMS_ID = fixtures.approvedTerms.id;
export const FUTURE_TERMS_ID = '788d0474-3c28-5833-9b04-4cdfb6919ef8';
export const EDUCATION_ID = '8384c56c-0b01-5629-9108-0ec27217646e';

async function seedInto(client: SqlClient, publicBaseUrl: string): Promise<void> {
  const operations = mobileFixtures.operaciones;
  for (const patient of ['A', 'B'] as const) {
    const profile = structuredClone(operations['API-01']!.response);
    profile.id = PATIENTS[patient];
    profile.email = `paciente.${patient.toLowerCase()}@example.com`;
    profile.nombre = `Paciente Sintético ${patient}`;
    if (patient === 'B') profile.rut = '11.111.111-1';
    const clinical = structuredClone(operations['API-03']!.response);
    const treatment = structuredClone(operations['API-04']!.response);
    if (patient === 'B') {
      clinical.id = 'dba7e9f7-46ed-5b29-8e51-fb5a81212342';
      treatment.id = '89e72d25-8063-5f9d-91c8-515d14c1e663';
      clinical.medicamentos = [];
    }
    await client.query(
      `INSERT INTO qc_demo_paciente(id,paciente_demo,perfil,perfil_clinico,tratamiento)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [PATIENTS[patient], patient, profile, clinical, treatment],
    );
    await client.query(
      `INSERT INTO qc_demo_escenario(paciente_id,escenario,aplicado_en,generation,session_epoch)
      VALUES($1,'NORMAL',now(),$2,$3) ON CONFLICT DO NOTHING`,
      [PATIENTS[patient], randomUUID(), randomUUID()],
    );
  }
  const terms = structuredClone(operations['API-14']!.response);
  for (const [id, version] of [
    [ORIGINAL_TERMS_ID, '1.0'],
    [NEW_TERMS_ID, '2.0'],
  ] as const) {
    const definition = {
      ...terms,
      id,
      version,
      texto_completo: 'Términos sintéticos de evaluación; no son términos institucionales.',
    };
    await client.query(
      'INSERT INTO qc_demo_terminos(id,codigo,version,definicion) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [id, 'TERMINOS_PLATAFORMA', version, definition],
    );
  }
  // New identities preserve all previously accepted definitions byte-for-content.
  const approved = structuredClone(fixtures.approvedTerms);
  for (const definition of [
    approved,
    {
      ...approved,
      id: FUTURE_TERMS_ID,
      version: '4.0',
      titulo: 'Prueba de actualización de términos — QuimioCare',
      texto_completo:
        'EDICIÓN TÉCNICA DE PRUEBA: este escenario simula una actualización; no acredita una nueva aprobación institucional.\n\n' +
        approved.texto_completo,
    },
  ]) {
    await client.query(
      'INSERT INTO qc_demo_terminos(id,codigo,version,definicion) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',
      [definition.id, definition.codigo, definition.version, definition],
    );
    const stored = await one<{ definicion: ObjectValue }>(
      client,
      'SELECT definicion FROM qc_demo_terminos WHERE id=$1',
      [definition.id],
    );
    if (!stored || !isDeepStrictEqual(stored.definicion, definition))
      throw new ApiError(
        503,
        'HTTP_503',
        'La edición de términos ya existe con otro contenido; se requiere una identidad nueva.',
      );
  }
  for (const form of [...FORMS, FOLLOWUP_FORM]) {
    const config: ObjectValue =
      form.id === FOLLOWUP_FORM.id
        ? fixtures.followupForm.configuracion_formulario_en_origen
        : {
            version_condiciones: form.version_condiciones,
            provisional: true,
          };

    await client.query(
      `INSERT INTO formulario(id,codigo,titulo,descripcion,tratamiento,version,activo,configuracion,fecha_creacion)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [
        form.id,
        form.codigo,
        form.titulo,
        form.descripcion ?? null,
        form.tratamiento,
        form.version,
        form.id === FOLLOWUP_FORM.id,
        config,
        form.fecha_creacion,
      ],
    );
    if (form.id !== FOLLOWUP_FORM.id)
      await client.query('UPDATE formulario SET activo=false WHERE id=$1 AND codigo=$2', [
        form.id,
        form.codigo,
      ]);
    for (const q of form.preguntas) {
      await client.query(
        `INSERT INTO pregunta(id,formulario_id,codigo,titulo,texto,tipo,requerida,orden,opciones,configuracion)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
        [
          q.id,
          form.id,
          q.codigo,
          q.titulo,
          q.texto ?? null,
          q.tipo,
          q.requerida ?? true,
          q.orden,
          JSON.stringify(q.opciones ?? []),
          q.configuracion ?? {},
        ],
      );
    }
  }
  const metadata = fixtures.imageMetadata as unknown as { contenido_educativo: ObjectValue };
  // Byte metadata is fixed by the original 77-byte fixture, never by response-body serialization.
  const image = {
    ...operations['API-13']!.response,
    descripcion: 'Imagen sintética de prueba; no es material clínico aprobado.',
    url: `${publicBaseUrl}/__demo/archivos/imagen-prueba.png`,
    archivo_mime: 'image/png',
    archivo_tamano_bytes: 77,
    archivo_revision: '38a00cb5-7f84-5076-9c22-2378dad7ea71',
    archivo_sha256: '3928618d567aa706302b2f1a7278e3758fee6d69637a075813c3ee5a565d747a',
    ...metadata.contenido_educativo,
  };
  // Keep the fixture URL server-controlled even if the editorial metadata contains a placeholder.
  image.url = `${publicBaseUrl}/__demo/archivos/imagen-prueba.png`;
  await client.query(
    `INSERT INTO contenido_educativo(id,profesional_id,titulo,descripcion,tipo,url,categoria,activo,fecha_creacion,
    carpeta_id,archivo_mime,archivo_tamano_bytes,archivo_revision,archivo_sha256)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING`,
    [
      'id',
      'profesional_id',
      'titulo',
      'descripcion',
      'tipo',
      'url',
      'categoria',
      'activo',
      'fecha_creacion',
      'carpeta_id',
      'archivo_mime',
      'archivo_tamano_bytes',
      'archivo_revision',
      'archivo_sha256',
    ].map((key) => (image as ObjectValue)[key] ?? null),
  );
}

export async function seedDatabase(db: Database, publicBaseUrl: string): Promise<void> {
  await transaction(db, async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('quimiocare-demo-seed'))");
    await seedInto(client, publicBaseUrl);
  });
}

export async function resetDatabase(db: Database, publicBaseUrl: string): Promise<void> {
  await transaction(db, async (client) => {
    const marker = await one<{ valor: string }>(
      client,
      "SELECT valor FROM qc_demo_meta WHERE clave='seed' FOR UPDATE",
    );
    if (marker?.valor !== 'quimiocare-rc32-v1')
      throw new ApiError(403, 'RESET_NO_PERMITIDO', 'Base no identificada como dataset sintético.');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('quimiocare-demo-seed'))");
    // Explicit list of synthetic relations: no CASCADE and no dynamic table identifiers.
    for (const table of [
      'qc_demo_refresh',
      'qc_demo_signo',
      'qc_demo_epro',
      'qc_demo_consentimiento',
      'qc_demo_vinculacion',
      'qc_demo_escenario',
      'qc_demo_paciente',
      'pregunta',
      'formulario',
      'contenido_educativo',
      'qc_demo_terminos',
    ]) {
      await client.query(`DELETE FROM ${table}`);
    }
    await seedInto(client, publicBaseUrl);
  });
}
