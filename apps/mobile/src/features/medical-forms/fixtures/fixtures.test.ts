import { describe, expect, it } from 'vitest';
import {
  validateConditionIntegrity,
  computeVisibleQuestions,
} from '../../../services/forms/form-conditions';
import {
  SEGUIMIENTO_DOMICILIARIO_BUNDLE_ITEM,
  SEGUIMIENTO_DOMICILIARIO_PREGUNTAS,
  SEGUIMIENTO_DOMICILIARIO_SECCIONES,
  SEGUIMIENTO_DOMICILIARIO_V1_0_0_BUNDLE_ITEM,
  SEGUIMIENTO_DOMICILIARIO_VERSION,
} from './seguimiento-domiciliario';
import {
  SAMPLE_DECOUPLED_BUNDLE_ITEM,
  SAMPLE_DECOUPLED_FORM_PREGUNTAS,
  SAMPLE_DECOUPLED_FORM_SECCIONES,
} from './sample-decoupled-form';

describe('Cuestionario de Seguimiento Domiciliario ePRO (Fixture)', () => {
  it('contiene exactamente 41 preguntas definidas y 11 secciones', () => {
    expect(SEGUIMIENTO_DOMICILIARIO_PREGUNTAS).toHaveLength(41);
    expect(SEGUIMIENTO_DOMICILIARIO_SECCIONES).toHaveLength(11);
    expect(SEGUIMIENTO_DOMICILIARIO_BUNDLE_ITEM.preguntas).toHaveLength(41);
  });

  it('no contiene la pregunta inventada P7.2', () => {
    const questionIds = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.map((q) => q.preguntaId);
    expect(questionIds).not.toContain('P7.2');
    expect(questionIds).toContain('P7.1');
  });

  it('P10 está configurada como texto opcional de 500 caracteres', () => {
    const p10 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P10');
    expect(p10).toBeDefined();
    expect(p10?.tipo).toBe('text');
    expect(p10?.requerida).toBe(false);
    expect(p10?.configuracion?.maxLength).toBe(500);
  });

  it('Módulo 9 distingue fatiga (P9.A) y dolor (P9.B)', () => {
    const p9a = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P9.A');
    const p9b = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P9.B');
    expect(p9a?.texto).toContain('cansancio extremo o fatiga');
    expect(p9b?.texto).toContain('algún dolor en el cuerpo');
  });

  it('preserva fidelidad con el instrumento Word en P1.1-P1.4, P2.3 y P9.B.2', () => {
    const p1_1 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P1.1');
    expect(p1_1?.texto).toBe('¿Qué síntomas has tenido exactamente?');
    expect(p1_1?.configuracion?.opciones?.map((o) => o.valor)).toEqual([
      'calor_decaimiento',
      'tiritones_suaves',
      'tiritones_fuertes',
    ]);

    const p1_2 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P1.2');
    expect(p1_2?.texto).toBe(
      '¿Te tomaste la temperatura con un termómetro (en la axila o en la boca)?',
    );
    expect(p1_2?.configuracion?.opciones?.map((o) => o.valor)).toEqual([
      'menos_37_5',
      '37_5_a_37_9',
      '38_a_38_2_mantenida',
      '38_3_mas',
      'no_tomada',
    ]);

    const p1_3 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P1.3');
    expect(p1_3?.texto).toContain('últimas 6 horas');

    const p1_4 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P1.4');
    expect(p1_4?.configuracion?.opciones?.find((o) => o.valor === 'ninguna')?.esExcluyente).toBe(
      true,
    );

    const p2_3 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P2.3');
    const p2_3_vals = p2_3?.configuracion?.opciones?.map((o) => o.valor);
    expect(p2_3_vals).toContain('vomita_medicamentos');
    expect(p2_3_vals).toContain('alivian_bien');
    expect(p2_3_vals).toContain('alivian_poco');
    expect(p2_3_vals).toContain('no_tomados');

    const p9_b_2 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P9.B.2');
    const p9_b_2_vals = p9_b_2?.configuracion?.opciones?.map((o) => o.valor);
    expect(p9_b_2_vals).toEqual(['alivia_bien', 'alivia_parcial', 'no_se_pasa_o_subito']);

    // Módulo 0: P0.1.1 contiene las 5 opciones literales del Word
    const p0_1_1 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P0.1.1');
    expect(p0_1_1?.configuracion?.opciones).toHaveLength(5);
    expect(p0_1_1?.configuracion?.opciones?.map((o) => o.valor)).toEqual([
      'normal_sin_cambios',
      'sensible_picazon',
      'roja_caliente_hinchada',
      'liquido_pus_sangre',
      'dolor_cuello_hombro_brazo',
    ]);
    expect(p0_1_1?.configuracion?.opciones?.[0]?.esExcluyente).toBe(true);
    expect(p0_1_1?.configuracion?.opciones?.[4]?.etiqueta).toContain(
      'cuello, hombro o en todo el brazo',
    );

    // Módulo 3: P3.A.1 a P3.A.3 corresponden exactamente al Word
    const p3_a = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P3.A');
    expect(p3_a?.texto).toBe(
      '¿Has tenido diarrea (deposiciones líquidas o sueltas) en las últimas 24 horas?',
    );

    const p3_a_1 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P3.A.1');
    expect(p3_a_1?.texto).toBe(
      '¿Cuántas veces has tenido diarrea hoy (en comparación con tu ritmo normal)?',
    );
    expect(p3_a_1?.configuracion?.opciones?.map((o) => o.valor)).toEqual([
      '1_a_3',
      '4_a_6',
      '7_mas',
    ]);

    const p3_a_2 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P3.A.2');
    expect(p3_a_2?.texto).toBe(
      '¿Cómo se ven las deposiciones y qué otros síntomas sientes en el abdomen?',
    );
    expect(p3_a_2?.configuracion?.opciones?.map((o) => o.valor)).toEqual([
      'liquidas_leves',
      'mucosidad_sangre',
      'negras_alquitran',
      'retorcijones_dolor_fuerte',
    ]);
    expect(p3_a_2?.configuracion?.opciones?.[0]?.esExcluyente).toBe(true);

    const p3_a_3 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P3.A.3');
    expect(p3_a_3?.texto).toBe('¿Has notado signos de deshidratación por la diarrea?');
    expect(p3_a_3?.configuracion?.opciones?.map((o) => o.valor)).toEqual([
      'bien_hidratado',
      'mucha_sed_boca_seca',
      'orina_poca_oscura',
      'mareo_de_pie',
    ]);
    expect(p3_a_3?.configuracion?.opciones?.[0]?.esExcluyente).toBe(true);

    const p3_b_1 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P3.B.1');
    expect(p3_b_1?.configuracion?.opciones?.map((o) => o.valor)).toEqual([
      '1_a_2',
      '3_a_4',
      '5_mas',
    ]);

    const p3_b_2 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P3.B.2');
    expect(p3_b_2?.texto).toContain('¿Tienes el abdomen muy hinchado, duro');
  });

  it('preserva fidelidad 100% con el Word en Módulos 2, 4, 5, 6, 7, 8 y 10', () => {
    // Módulo 2: P2.1 y P2.4 literales
    const p2_1 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P2.1');
    expect(p2_1?.configuracion?.opciones?.[0]?.etiqueta).toBe(
      'Leves: Siento asco, pero puedo comer y tomar líquidos casi normal.',
    );
    expect(p2_1?.configuracion?.opciones?.[1]?.etiqueta).toBe(
      'Moderadas: Me cuesta comer, he comido bastante menos de lo habitual, pero logro tomar líquidos.',
    );
    expect(p2_1?.configuracion?.opciones?.[2]?.etiqueta).toBe(
      'Severas: El asco es constante y no me permite comer ni tomar casi nada de líquido.',
    );

    const p2_4 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P2.4');
    expect(p2_4?.texto).toBe('Si vomitaste, ¿notaste algo extraño en el vómito?');
    expect(p2_4?.configuracion?.opciones?.map((o) => o.etiqueta)).toEqual([
      'No, era solo comida o líquido normal/amarillento.',
      'Sí, tenía sangre roja o parecía tener "granos de café" oscuros.',
    ]);

    // Módulo 4: Boca y garganta
    const p4 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P4');
    expect(p4?.texto).toBe(
      '¿Sientes dolor, ardor, enrojecimiento o tienes llagas (heridas) dentro de la boca, lengua, encías o al tragar?',
    );

    const p4_1 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P4.1');
    expect(p4_1?.texto).toBe('¿Qué observas dentro de tu boca?');
    expect(p4_1?.configuracion?.opciones?.map((o) => o.etiqueta)).toEqual([
      'Solo está roja, seca o sensible, sin heridas visibles.',
      'Tengo llagas o úlceras pequeñas.',
      'Tengo placas blancas (como leche cortada) en la lengua o mejillas.',
      'Las heridas sangran solas o al comer.',
    ]);

    const p4_2 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P4.2');
    expect(p4_2?.texto).toBe('¿Cómo afecta esto a tu alimentación hoy?');
    expect(p4_2?.configuracion?.opciones?.map((o) => o.etiqueta)).toEqual([
      'Me molesta un poco, pero puedo comer alimentos normales o blandos sin problema.',
      'Me duele bastante; solo puedo comer papillas, sopas o líquidos, pero logro alimentarme.',
      'El dolor es tan intenso que solo puedo pasar un poco de agua o líquidos con mucha dificultad.',
      'No puedo tragar absolutamente nada, ni agua ni mis medicamentos en pastillas.',
    ]);

    // Módulo 5: Sistema nervioso
    const p5 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P5');
    expect(p5?.texto).toBe(
      '¿Sientes hormigueo, adormecimiento, "corrientazos" o dolor en los dedos de las manos o de los pies?',
    );

    const p5_1 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P5.1');
    expect(p5_1?.texto).toBe('¿Cómo afecta esta sensación a tus actividades diarias?');
    expect(p5_1?.configuracion?.opciones?.map((o) => o.etiqueta)).toEqual([
      'Es solo un hormigueo leve que no me molesta para hacer mis cosas.',
      'Me cuesta hacer cosas finas con las manos (como abrocharme botones, escribir, abrir frascos o sostener una taza sin que se caiga).',
      'Me cuesta caminar bien, siento que no piso firme, tropiezo o pierdo el equilibrio por tener los pies dormidos.',
    ]);

    const p5_2 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P5.2');
    expect(p5_2?.texto).toBe(
      '¿Sientes calambres o dolor en la garganta o en las manos cuando tocas cosas frías o tomas líquidos fríos?',
    );
    expect(p5_2?.configuracion?.opciones?.map((o) => o.etiqueta)).toEqual([
      'No.',
      'Sí, me da molestia o dolor con el frío, pero pasa rápido al calentarme.',
      'Sí, siento que se me cierra la garganta o me cuesta respirar al tomar o respirar algo frío.',
    ]);

    const p5_3 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P5.3');
    expect(p5_3?.texto).toBe(
      'En comparación con tu ciclo anterior de quimioterapia, ¿esta sensación ha cambiado?',
    );
    expect(p5_3?.configuracion?.opciones?.map((o) => o.etiqueta)).toEqual([
      'Está igual o es más suave.',
      'Es nueva o ha empeorado y ya no se quita entre un ciclo y otro.',
    ]);

    // Módulo 6: Piel y extremidades
    const p6 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P6');
    expect(p6?.texto).toBe(
      '¿Has notado enrojecimiento, hinchazón, dolor o descamación en las palmas de las manos, plantas de los pies o en el brazo donde te pusieron el suero?',
    );

    const p6_1 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P6.1');
    expect(p6_1?.texto).toBe(
      'En las palmas de tus manos o plantas de tus pies, ¿qué síntomas tienes?',
    );
    expect(p6_1?.configuracion?.opciones?.map((o) => o.etiqueta)).toEqual([
      'No tengo nada en las palmas ni plantas.',
      'Están un poco rojas o secas, pero no me duelen al caminar ni al usar las manos.',
      'Están rojas, hinchadas, se están pelando y me duelen al caminar o al sostener objetos.',
      'Tienen ampollas, heridas abiertas o costras, y el dolor no me deja caminar ni usar mis manos.',
    ]);

    const p6_2 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P6.2');
    expect(p6_2?.texto).toBe(
      'En la vena del brazo donde te pasaron la quimioterapia (si no usas catéter central), ¿notaste algo?',
    );
    expect(p6_2?.configuracion?.opciones?.map((o) => o.etiqueta)).toEqual([
      'Todo normal.',
      'Está un poco morado por el pinchazo, pero sin dolor importante.',
      'Está muy hinchado, rojo, duro, caliente o me arde/duele mucho esa zona del brazo.',
    ]);

    // Módulo 7: Sangrados y moretones
    const p7 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P7');
    expect(p7?.texto).toBe(
      '¿Has tenido algún tipo de sangrado o te han salido moretones o puntitos rojos en la piel sin haberte golpeado?',
    );

    const p7_1 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P7.1');
    expect(p7_1?.texto).toBe('¿Qué tipo de sangrado o marcas has notado?');
    expect(p7_1?.configuracion?.opciones?.map((o) => o.etiqueta)).toEqual([
      'Pequeño sangrado de encías al cepillarme los dientes o gotitas de sangre al sonarme la nariz, que se detiene en menos de 5 minutos.',
      'Me salieron varios moretones nuevos sin golpearme o muchos puntitos rojos pequeños en las piernas o brazos (petequias).',
      'Sangrado de nariz o encías abundante que no se detiene después de apretar durante 10 a 15 minutos.',
      'Orina de color rojo o rosado (con sangre) o ardor fuerte al orinar.',
      'Sangrado vaginal abundante fuera de mi regla normal, o tos con sangre.',
    ]);

    // Módulo 8: Respiración y sistema cardiovascular
    const p8 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P8');
    expect(p8?.texto).toBe(
      '¿Sientes falta de aire al respirar, dolor en el pecho, palpitaciones o se te ha hinchado alguna pierna?',
    );

    const p8_1 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P8.1');
    expect(p8_1?.texto).toBe('¿Cómo es la falta de aire o dificultad para respirar?');
    expect(p8_1?.configuracion?.opciones?.map((o) => o.etiqueta)).toEqual([
      'No tengo falta de aire.',
      'Me canso un poco más de lo normal al subir escaleras o caminar rápido, pero se me pasa al descansar.',
      'Me falta el aire haciendo cosas mínimas (como vestirme o ir al baño) o necesito dormir con más almohadas para no ahogarme.',
      'Me falta el aire estando totalmente quieto/a y en reposo.',
    ]);

    const p8_2 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P8.2');
    expect(p8_2?.texto).toBe('¿Tienes alguno de estos síntomas en el pecho?');
    expect(p8_2?.configuracion?.opciones?.map((o) => o.etiqueta)).toEqual([
      'Ninguno.',
      'Dolor, presión o pesadez en el centro del pecho.',
      'Siento que el corazón me late muy rápido o desordenado (palpitaciones) estando en reposo.',
    ]);
    expect(p8_2?.configuracion?.opciones?.[0]?.esExcluyente).toBe(true);

    const p8_3 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P8.3');
    expect(p8_3?.texto).toBe('¿Se te han hinchado las piernas o los tobillos?');
    expect(p8_3?.configuracion?.opciones?.map((o) => o.etiqueta)).toEqual([
      'No.',
      'Sí, ambos tobillos están un poco hinchados al final del día.',
      'Sí, una sola pierna (o pantorrilla) se hinchó de repente, me duele, está roja o caliente.',
    ]);

    // Módulo 10: Comentario abierto
    const p10 = SEGUIMIENTO_DOMICILIARIO_PREGUNTAS.find((q) => q.preguntaId === 'P10');
    expect(p10?.texto).toBe(
      '¿Hay algún otro síntoma, duda o comentario que quieras contarle a tu equipo médico o de enfermería y que no hayamos preguntado arriba?',
    );
  });

  it('preserva la versión histórica 1.0.0 y versiona la activa como 1.1.0', () => {
    expect(SEGUIMIENTO_DOMICILIARIO_VERSION).toBe('1.1.0');
    expect(SEGUIMIENTO_DOMICILIARIO_BUNDLE_ITEM.version).toBe('1.1.0');

    expect(SEGUIMIENTO_DOMICILIARIO_V1_0_0_BUNDLE_ITEM.version).toBe('1.0.0');
    expect(SEGUIMIENTO_DOMICILIARIO_V1_0_0_BUNDLE_ITEM.preguntas).toHaveLength(41);
    expect(() =>
      validateConditionIntegrity(SEGUIMIENTO_DOMICILIARIO_V1_0_0_BUNDLE_ITEM),
    ).not.toThrow();
  });

  it('cumple íntegramente la validación de integridad estructural sin errores ni referencias hacia adelante', () => {
    expect(() => validateConditionIntegrity(SEGUIMIENTO_DOMICILIARIO_BUNDLE_ITEM)).not.toThrow();
  });

  it('P2.4 se habilita con condición positiva cuando P2 es Sí y P2.2 indica vómito', () => {
    // Si P2 es Sí pero P2.2 es no_vomito -> P2.4 oculta
    const visibleSinVomito = computeVisibleQuestions(SEGUIMIENTO_DOMICILIARIO_PREGUNTAS, {
      P2: 'si',
      'P2.2': 'no_vomito',
    });
    expect(visibleSinVomito.has('P2.4')).toBe(false);

    // Si P2 es Sí y P2.2 es vomito_1_2 -> P2.4 visible
    const visibleConVomito = computeVisibleQuestions(SEGUIMIENTO_DOMICILIARIO_PREGUNTAS, {
      P2: 'si',
      'P2.2': 'vomito_1_2',
    });
    expect(visibleConVomito.has('P2.4')).toBe(true);

    // Si P2 es No -> P2.4 oculta
    const visibleP2No = computeVisibleQuestions(SEGUIMIENTO_DOMICILIARIO_PREGUNTAS, {
      P2: 'no',
      'P2.2': 'vomito_1_2',
    });
    expect(visibleP2No.has('P2.4')).toBe(false);
  });

  it('todas las preguntas madre en No ocultan todas las hijas del instrumento', () => {
    const answersTodasNo = {
      'P0.1': 'no',
      P1: 'no',
      P2: 'no',
      'P3.A': 'no',
      'P3.B': 'no',
      P4: 'no',
      P5: 'no',
      P6: 'no',
      P7: 'no',
      P8: 'no',
      'P9.A': 'no',
      'P9.B': 'no',
    };

    const visibleQuestions = computeVisibleQuestions(
      SEGUIMIENTO_DOMICILIARIO_PREGUNTAS,
      answersTodasNo,
    );

    // Madres visibles: P0.1, P1, P2, P3.A, P3.B, P4, P5, P6, P7, P8, P9.A, P9.B (12 madres) + P10 comentario (1) = 13
    expect(visibleQuestions.size).toBe(13);
    expect(visibleQuestions.has('P0.1.1')).toBe(false);
    expect(visibleQuestions.has('P1.1')).toBe(false);
    expect(visibleQuestions.has('P2.1')).toBe(false);
    expect(visibleQuestions.has('P3.A.1')).toBe(false);
    expect(visibleQuestions.has('P3.B.1')).toBe(false);
    expect(visibleQuestions.has('P4.1')).toBe(false);
    expect(visibleQuestions.has('P5.1')).toBe(false);
    expect(visibleQuestions.has('P6.1')).toBe(false);
    expect(visibleQuestions.has('P7.1')).toBe(false);
    expect(visibleQuestions.has('P8.1')).toBe(false);
    expect(visibleQuestions.has('P9.A.1')).toBe(false);
    expect(visibleQuestions.has('P9.B.1')).toBe(false);
    expect(visibleQuestions.has('P10')).toBe(true);
  });
});

describe('Segundo Formulario Desacoplado (Fixture)', () => {
  it('contiene 2 secciones e IDs Q_* demostrando desacoplamiento', () => {
    expect(SAMPLE_DECOUPLED_FORM_PREGUNTAS).toHaveLength(3);
    expect(SAMPLE_DECOUPLED_FORM_SECCIONES).toHaveLength(2);
    expect(SAMPLE_DECOUPLED_BUNDLE_ITEM.preguntas).toHaveLength(3);
  });

  it('cumple la validación de integridad estructural', () => {
    expect(() => validateConditionIntegrity(SAMPLE_DECOUPLED_BUNDLE_ITEM)).not.toThrow();
  });

  it('evalúa visibilidad dinámica correctamente en el formulario desacoplado', () => {
    const visibleNo = computeVisibleQuestions(SAMPLE_DECOUPLED_FORM_PREGUNTAS, {
      Q_ANIMO: 'no',
    });
    expect(visibleNo.has('Q_ANIMO')).toBe(true);
    expect(visibleNo.has('Q_DETALLE_ANIMO')).toBe(false);
    expect(visibleNo.has('Q_COMENTARIO')).toBe(true);

    const visibleSi = computeVisibleQuestions(SAMPLE_DECOUPLED_FORM_PREGUNTAS, {
      Q_ANIMO: 'si',
    });
    expect(visibleSi.has('Q_ANIMO')).toBe(true);
    expect(visibleSi.has('Q_DETALLE_ANIMO')).toBe(true);
    expect(visibleSi.has('Q_COMENTARIO')).toBe(true);
  });
});
