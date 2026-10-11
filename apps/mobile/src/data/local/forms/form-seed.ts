import type { SqlConnection } from '../core/sql';
import { type MedicalFormBundle } from './form-types';
import { ingestMedicalFormBundle, type Clock } from './form-ingestion';

export async function seedMedicalFormsDemo(
  connection: SqlConnection,
  patientAId: string,
  patientBId: string,
  now: Clock = () => new Date().toISOString(),
): Promise<void> {
  const demoForms: MedicalFormBundle['formularios'] = [
    {
      formularioId: 'form-qlq30-muestra',
      version: '1.0',
      titulo: 'Calidad de Vida en Tratamiento (Muestra QLQ-C30)',
      descripcion:
        'Cuestionario clínico de muestra para valorar el impacto del ciclo de quimioterapia en tu bienestar diario.',
      duracionEstimadaMin: 3,
      preguntas: [
        {
          preguntaId: 'q1',
          texto:
            '¿Durante el día de hoy has tenido dificultades para realizar tus actividades cotidianas?',
          tipo: 'single_choice',
          orden: 1,
          requerida: true,
          configuracion: {
            opciones: [
              { valor: 'nada', etiqueta: 'Nada' },
              { valor: 'un_poco', etiqueta: 'Un poco' },
              { valor: 'bastante', etiqueta: 'Bastante' },
              { valor: 'mucho', etiqueta: 'Mucho' },
            ],
          },
        },
        {
          preguntaId: 'q2',
          texto: '¿Has sentido cansancio o falta de energía persistente?',
          tipo: 'single_choice',
          orden: 2,
          requerida: true,
          configuracion: {
            opciones: [
              { valor: 'nada', etiqueta: 'Nada' },
              { valor: 'un_poco', etiqueta: 'Un poco' },
              { valor: 'bastante', etiqueta: 'Bastante' },
              { valor: 'mucho', etiqueta: 'Mucho' },
            ],
          },
        },
        {
          preguntaId: 'q3',
          texto: '¿Has presentado náuseas o disminución del apetito?',
          tipo: 'single_choice',
          orden: 3,
          requerida: true,
          configuracion: {
            opciones: [
              { valor: 'nada', etiqueta: 'Nada' },
              { valor: 'un_poco', etiqueta: 'Un poco' },
              { valor: 'bastante', etiqueta: 'Bastante' },
              { valor: 'mucho', etiqueta: 'Mucho' },
            ],
          },
        },
        {
          preguntaId: 'q4',
          texto: '¿Cómo calificarías tu calidad de vida global durante la última jornada?',
          tipo: 'scale_0_10',
          orden: 4,
          requerida: true,
          configuracion: {
            minEtiqueta: '0 = Muy mala',
            maxEtiqueta: '10 = Excelente',
          },
        },
        {
          preguntaId: 'q5',
          texto: 'Comentarios adicionales sobre tu estado actual:',
          descripcion:
            'Puedes detallar sensaciones específicas que desees consultar en tu próxima visita.',
          tipo: 'text',
          orden: 5,
          requerida: false,
        },
      ],
    },
    {
      formularioId: 'form-esas-muestra',
      version: '1.0',
      titulo: 'Evaluación de Síntomas de Edmonton (ESAS de muestra)',
      descripcion:
        'Escala de evaluación rápida para cuantificar la intensidad de molestias comunes asociadas al tratamiento.',
      duracionEstimadaMin: 2,
      preguntas: [
        {
          preguntaId: 'esas_dolor',
          texto: 'Nivel de dolor percibido:',
          tipo: 'scale_0_10',
          orden: 1,
          requerida: true,
          configuracion: {
            minEtiqueta: '0 = Sin dolor',
            maxEtiqueta: '10 = Máximo dolor',
          },
        },
        {
          preguntaId: 'esas_fatiga',
          texto: 'Nivel de cansancio o fatiga:',
          tipo: 'scale_0_10',
          orden: 2,
          requerida: true,
          configuracion: {
            minEtiqueta: '0 = Sin cansancio',
            maxEtiqueta: '10 = Cansancio extremo',
          },
        },
        {
          preguntaId: 'esas_nauseas',
          texto: 'Nivel de malestar estomacal o náuseas:',
          tipo: 'scale_0_10',
          orden: 3,
          requerida: true,
          configuracion: {
            minEtiqueta: '0 = Sin náuseas',
            maxEtiqueta: '10 = Náuseas intensas',
          },
        },
        {
          preguntaId: 'esas_sintomas_secundarios',
          texto: 'Molestias acompañantes presentes:',
          tipo: 'multiple_choice',
          orden: 4,
          requerida: false,
          configuracion: {
            opciones: [
              { valor: 'boca_seca', etiqueta: 'Boca seca o mucositis' },
              { valor: 'dificultad_dormir', etiqueta: 'Dificultad para conciliar el sueño' },
              { valor: 'sensibilidad_frio', etiqueta: 'Sensibilidad al frío o disestesias' },
              { valor: 'mareos', etiqueta: 'Mareos o sensación de inestabilidad' },
              { valor: 'ninguna', etiqueta: 'Ninguna molestia adicional', esExcluyente: true },
            ],
          },
        },
        {
          preguntaId: 'esas_notas',
          texto: 'Observaciones para el registro clínico local:',
          tipo: 'text',
          orden: 5,
          requerida: false,
        },
      ],
    },
  ];

  // Consultar asignaciones existentes para no reactivar asignaciones retiradas
  const targetAssignments = [
    { pacienteId: patientAId, formularioId: 'form-qlq30-muestra', version: '1.0' },
    { pacienteId: patientAId, formularioId: 'form-esas-muestra', version: '1.0' },
    { pacienteId: patientBId, formularioId: 'form-esas-muestra', version: '1.0' },
  ];

  const demoAssignments: MedicalFormBundle['asignaciones'] = [];
  for (const target of targetAssignments) {
    const existing = await connection.first<{ estado_conocido: string }>(
      'SELECT estado_conocido FROM formulario_asignacion_cache WHERE paciente_id = ? AND formulario_id = ? AND version = ?',
      [target.pacienteId, target.formularioId, target.version],
    );

    if (existing) {
      // Si ya existe (incluso si está 'retirada'), no especificamos cambio de estado
      // para preservar su estado conocido actual
      demoAssignments.push({
        pacienteId: target.pacienteId,
        formularioId: target.formularioId,
        version: target.version,
      });
    } else {
      // Si no existe, se inserta como activa por defecto
      demoAssignments.push({
        pacienteId: target.pacienteId,
        formularioId: target.formularioId,
        version: target.version,
        estado: 'activa',
      });
    }
  }

  const bundle: MedicalFormBundle = {
    formularios: demoForms,
    asignaciones: demoAssignments,
  };

  await ingestMedicalFormBundle(connection, bundle, now);
}
