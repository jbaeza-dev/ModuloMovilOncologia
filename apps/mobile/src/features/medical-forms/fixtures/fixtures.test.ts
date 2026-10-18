import { describe, expect, it } from 'vitest';
import {
  validateConditionIntegrity,
  computeVisibleQuestions,
} from '../../../services/forms/form-conditions';
import {
  SEGUIMIENTO_DOMICILIARIO_BUNDLE_ITEM,
  SEGUIMIENTO_DOMICILIARIO_PREGUNTAS,
  SEGUIMIENTO_DOMICILIARIO_SECCIONES,
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
