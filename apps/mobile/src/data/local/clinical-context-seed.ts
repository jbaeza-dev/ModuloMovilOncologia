import { ingestTermDefinitionsInTransaction } from './consent-ingestion';
import type { TermDefinitionBundle } from './consent-types';
import type { SqlConnection } from './sql';

export const DEMO_TERMS_BUNDLE: TermDefinitionBundle = {
  terminos: [
    {
      terminoId: 'term-piloto-quimiocare',
      version: '1.0',
      titulo: 'Términos y Condiciones del Piloto QuimioCare',
      contenidoMarkdown: `### Términos y Condiciones del Piloto QuimioCare (Muestra Demostrativa)

1. **Propósito del Módulo**: La presente aplicación móvil es una herramienta de acompañamiento, registro y consulta local diseñada para apoyar a pacientes durante su esquema de quimioterapia.
2. **Naturaleza Demostrativa**: Los datos y cuestionarios presentados corresponden a escenarios de prueba y demostración técnica independiente.
3. **Privacidad y Datos Locales**: La información registrada en este dispositivo se conserva de manera local y encriptada en el almacenamiento del teléfono.
4. **No Sustituye Atención Médica de Urgencia**: Esta aplicación no realiza triaje automatizado ni reemplaza las indicaciones de tu oncólogo tratante. Ante fiebre o síntomas severos, acude inmediatamente a un servicio de urgencias.`,
      requerido: true,
      vigenteDesde: '2026-01-01T00:00:00.000Z',
    },
    {
      terminoId: 'term-seguimiento-sintomatico',
      version: '1.0',
      titulo: 'Consentimiento Informado para Seguimiento Sintomático y Reporte Clínico',
      contenidoMarkdown: `### Consentimiento Informado para Seguimiento Sintomático

1. **Registro Voluntario**: Autorizo el registro en este dispositivo de mis signos vitales diarios, síntomas libres y cuestionarios clínicos.
2. **Generación de Reportes**: Comprendo que la aplicación permite exportar resúmenes locales en formato PDF y Excel para facilitar la comunicación con mi equipo de salud.
3. **Revocabilidad**: Este consentimiento puede ser revocado en cualquier momento desde los ajustes de perfil de la aplicación sin alterar mi atención médica.`,
      requerido: true,
      vigenteDesde: '2026-01-01T00:00:00.000Z',
    },
  ],
};

export async function seedClinicalContextDemoInTransaction(
  tx: SqlConnection,
  patientAId: string,
  patientBId: string,
  now: () => string = () => new Date().toISOString(),
): Promise<void> {
  const timestamp = now();

  // 1. Fichas clínicas (INSERT OR IGNORE para no sobreescribir)
  await tx.run(
    'INSERT OR IGNORE INTO ficha_clinica_cache (ficha_id, paciente_id, obtenido_en) VALUES (?, ?, ?)',
    ['FICHA-A-101', patientAId, timestamp],
  );
  await tx.run(
    'INSERT OR IGNORE INTO ficha_clinica_cache (ficha_id, paciente_id, obtenido_en) VALUES (?, ?, ?)',
    ['FICHA-B-202', patientBId, timestamp],
  );

  // 2. Profesionales médicos (INSERT OR IGNORE)
  const profesionales = [
    {
      id: 'prof-1',
      nombre: 'Dra. Claudia Morales',
      especialidad: 'Oncología Médica',
      email: 'claudia.morales@hospital.test',
    },
    {
      id: 'prof-2',
      nombre: 'Enf. Rodrigo Salinas',
      especialidad: 'Enfermería Oncológica',
      email: 'rodrigo.salinas@hospital.test',
    },
    {
      id: 'prof-3',
      nombre: 'Dr. Martín Vega',
      especialidad: 'Oncología Médica',
      email: 'martin.vega@hospital.test',
    },
  ];

  for (const p of profesionales) {
    await tx.run(
      'INSERT OR IGNORE INTO profesional_medico_cache (id, nombre, especialidad, email, obtenido_en) VALUES (?, ?, ?, ?, ?)',
      [p.id, p.nombre, p.especialidad, p.email, timestamp],
    );
  }

  // 3. Vínculos paciente-profesional (INSERT OR IGNORE para preservar revocaciones previas)
  const vinculos = [
    {
      id: 'vinc-a-1',
      pacienteId: patientAId,
      profesionalId: 'prof-1',
      estado: 'activo',
      fecha: '2026-08-01T08:00:00.000Z',
      codigo: 'VINC-A1',
    },
    {
      id: 'vinc-a-2',
      pacienteId: patientAId,
      profesionalId: 'prof-2',
      estado: 'activo',
      fecha: '2026-08-01T08:30:00.000Z',
      codigo: 'VINC-A2',
    },
    {
      id: 'vinc-b-1',
      pacienteId: patientBId,
      profesionalId: 'prof-3',
      estado: 'activo',
      fecha: '2026-09-01T09:00:00.000Z',
      codigo: 'VINC-B1',
    },
  ];

  for (const v of vinculos) {
    await tx.run(
      `INSERT OR IGNORE INTO paciente_clinico_cache (
         id, paciente_id, profesional_id, estado_conocido, fecha_vinculacion, codigo_origen, obtenido_en
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [v.id, v.pacienteId, v.profesionalId, v.estado, v.fecha, v.codigo, timestamp],
    );
  }

  // 4. Medicamentos activos (INSERT OR IGNORE para preservar suspensiones previas)
  const medicamentos = [
    {
      id: 'med-a-1',
      pacienteId: patientAId,
      fichaId: 'FICHA-A-101',
      nombre: 'Ondansetrón 8 mg',
      dosis: '8 mg',
      frecuencia: 'Cada 8 horas',
      fechaInicio: '2026-09-15',
    },
    {
      id: 'med-a-2',
      pacienteId: patientAId,
      fichaId: 'FICHA-A-101',
      nombre: 'Dexametasona 4 mg',
      dosis: '4 mg',
      frecuencia: 'Cada 24 horas (en las mañanas)',
      fechaInicio: '2026-09-15',
    },
    {
      id: 'med-b-1',
      pacienteId: patientBId,
      fichaId: 'FICHA-B-202',
      nombre: 'Metoclopramida 10 mg',
      dosis: '10 mg',
      frecuencia: 'Cada 8 horas si hay náuseas',
      fechaInicio: '2026-10-01',
    },
  ];

  for (const m of medicamentos) {
    await tx.run(
      `INSERT OR IGNORE INTO medicamento_activo_cache (
         id, paciente_id, ficha_id, nombre, dosis, frecuencia, fecha_inicio, fecha_fin, estado_activo, obtenido_en
       ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1, ?)`,
      [m.id, m.pacienteId, m.fichaId, m.nombre, m.dosis, m.frecuencia, m.fechaInicio, timestamp],
    );
  }

  // 5. Términos demo inmutables
  await ingestTermDefinitionsInTransaction(tx, DEMO_TERMS_BUNDLE, now);
}
