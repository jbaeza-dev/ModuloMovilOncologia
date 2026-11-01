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

  // Sembrar plantillas clínicas sintéticas aprobadas
  const clinicalA = structuredClone(operations['API-03']!.response);
  const treatmentA = structuredClone(operations['API-04']!.response);
  const clinicalB = structuredClone(operations['API-03']!.response);
  clinicalB.id = 'dba7e9f7-46ed-5b29-8e51-fb5a81212342';
  clinicalB.diagnostico = 'Carcinoma ductal infiltrante de mama estadio II';
  const treatmentB = structuredClone(operations['API-04']!.response);
  treatmentB.id = '89e72d25-8063-5f9d-91c8-515d14c1e663';
  treatmentB.esquema = 'AC-T (Doxorrubicina + Ciclofosfamida)';

  await client.query(
    `INSERT INTO qc_demo_plantilla_sintetica(id, nombre, descripcion, version, perfil_clinico_template, tratamiento_template, activo)
     VALUES($1, $2, $3, $4, $5, $6, true)
     ON CONFLICT(id) DO UPDATE SET perfil_clinico_template=excluded.perfil_clinico_template, tratamiento_template=excluded.tratamiento_template`,
    [
      'DEMO-FOLFOX-v1',
      'Esquema FOLFOX Sintético (Cáncer Colorrectal)',
      'Plantilla demostrativa basada en el protocolo estándar mFOLFOX6 para evaluación académica.',
      1,
      clinicalA,
      treatmentA,
    ],
  );

  await client.query(
    `INSERT INTO qc_demo_plantilla_sintetica(id, nombre, descripcion, version, perfil_clinico_template, tratamiento_template, activo)
     VALUES($1, $2, $3, $4, $5, $6, true)
     ON CONFLICT(id) DO UPDATE SET perfil_clinico_template=excluded.perfil_clinico_template, tratamiento_template=excluded.tratamiento_template`,
    [
      'DEMO-AC-T-v1',
      'Esquema AC-T Sintético (Cáncer de Mama)',
      'Plantilla demostrativa basada en el protocolo AC-T para evaluación académica.',
      1,
      clinicalB,
      treatmentB,
    ],
  );

  // Sembrar operador inicial para pruebas
  await client.query(
    `INSERT INTO qc_demo_operador(id, auth_issuer, auth_subject, email, nombre, activo)
     VALUES($1, $2, $3, $4, $5, true) ON CONFLICT(id) DO NOTHING`,
    [
      '11111111-1111-1111-1111-111111111111',
      'https://quimiocare-auth.supabase.co/auth/v1',
      '11111111-1111-1111-1111-111111111111',
      'operador.demo@ubiobio.cl',
      'Dra. Evaluadora UBB',
    ],
  );

  // Sembrar invitaciones iniciales
  await client.query(
    `INSERT INTO qc_demo_invitacion_paciente(email, nombre, activo)
     VALUES('paciente.evaluador@gmail.com', 'Paciente Evaluador', true),
           ('paciente.a@example.com', 'Paciente Sintético A', true),
           ('paciente.b@example.com', 'Paciente Sintético B', true)
     ON CONFLICT(email) DO NOTHING`,
  );

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
  image.url = `${publicBaseUrl}/archivos/educacion/${EDUCATION_ID}/${image.archivo_revision}.png`;
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
    await client.query(
      'INSERT INTO qc_preparacion_formulario_vigente(tratamiento,formulario_id) SELECT tratamiento,(array_agg(id))[1] FROM formulario WHERE activo AND NOT eliminado GROUP BY tratamiento HAVING count(*)=1 ON CONFLICT DO NOTHING',
    );
    await client.query(
      "INSERT INTO qc_preparacion_terminos_vigentes(codigo,definicion_id) VALUES('TERMINOS_PLATAFORMA',$1) ON CONFLICT DO NOTHING",
      [APPROVED_TERMS_ID],
    );
    await client.query(
      "INSERT INTO qc_preparacion_categoria(clave,nombre) SELECT lower(btrim(categoria)),min(btrim(categoria)) FROM contenido_educativo WHERE btrim(coalesce(categoria,'')) <> '' GROUP BY lower(btrim(categoria)) ON CONFLICT DO NOTHING",
    );
  });
}

export async function resetDatabase(db: Database, publicBaseUrl: string): Promise<void> {
  if (
    !db.options.database?.endsWith('_test') &&
    !new URL(String(db.options.connectionString)).pathname.endsWith('_test')
  )
    throw new ApiError(
      403,
      'RESET_NO_PERMITIDO',
      'Reset solo disponible en bases desechables *_test.',
    );
  await transaction(db, async (client) => {
    const marker = await one<{ valor: string }>(
      client,
      "SELECT valor FROM qc_demo_meta WHERE clave='seed' FOR UPDATE",
    );
    if (marker?.valor !== 'quimiocare-rc32-v1')
      throw new ApiError(403, 'RESET_NO_PERMITIDO', 'Base no identificada como dataset sintético.');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('quimiocare-demo-seed'))");
    for (const table of [
      'qc_preparacion_auditoria',
      'qc_preparacion_operacion',
      'qc_demo_operacion_educativa',
      'qc_preparacion_formulario_vigente',
      'qc_preparacion_terminos_vigentes',
      'qc_preparacion_categoria',
      'qc_demo_auditoria_vinculacion',
      'qc_demo_relacion_clinica',
      'qc_demo_vinculacion',
      'qc_demo_refresh',
      'qc_demo_signo',
      'qc_demo_epro',
      'qc_demo_consentimiento',
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
    await client.query(
      'INSERT INTO qc_preparacion_formulario_vigente(tratamiento,formulario_id) SELECT tratamiento,(array_agg(id))[1] FROM formulario WHERE activo AND NOT eliminado GROUP BY tratamiento HAVING count(*)=1 ON CONFLICT DO NOTHING',
    );
    await client.query(
      "INSERT INTO qc_preparacion_terminos_vigentes(codigo,definicion_id) VALUES('TERMINOS_PLATAFORMA',$1) ON CONFLICT DO NOTHING",
      [APPROVED_TERMS_ID],
    );
    await client.query(
      "INSERT INTO qc_preparacion_categoria(clave,nombre) SELECT lower(btrim(categoria)),min(btrim(categoria)) FROM contenido_educativo WHERE btrim(coalesce(categoria,'')) <> '' GROUP BY lower(btrim(categoria)) ON CONFLICT DO NOTHING",
    );
  });
}
