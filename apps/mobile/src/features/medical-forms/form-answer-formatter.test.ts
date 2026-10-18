import { describe, expect, it } from 'vitest';

import {
  FALLBACK_UNKNOWN_OPTION_LABEL,
  formatFormAnswer,
  UNANSWERED_OPTIONAL_LABEL,
  UNANSWERED_REQUIRED_LABEL,
} from './form-answer-formatter';

describe('formatFormAnswer', () => {
  describe('Selección única (single_choice)', () => {
    const question = {
      tipo: 'single_choice' as const,
      obligatoria: true,
      configuracion: {
        opciones: [
          { valor: 'todo_normal', etiqueta: 'Todo normal, sin molestias' },
          { valor: 'molestia_leve', etiqueta: 'Molestias leves tolerables' },
          { valor: 'molestia_severa', etiqueta: 'Molestias severas' },
        ],
      },
    };

    it('retorna la etiqueta humana cuando el valor coincide', () => {
      const result = formatFormAnswer(question, 'todo_normal');
      expect(result).toEqual({
        text: 'Todo normal, sin molestias',
        isUnanswered: false,
      });
    });

    it('distingue mayúsculas y minúsculas cuando la definición tiene alternativas diferenciadas (ej. A y a)', () => {
      const caseSensitiveQuestion = {
        tipo: 'single_choice' as const,
        obligatoria: true,
        configuracion: {
          opciones: [
            { valor: 'A', etiqueta: 'Opción A (Mayúscula)' },
            { valor: 'a', etiqueta: 'Opción a (Minúscula)' },
          ],
        },
      };

      expect(formatFormAnswer(caseSensitiveQuestion, 'A').text).toBe('Opción A (Mayúscula)');
      expect(formatFormAnswer(caseSensitiveQuestion, 'a').text).toBe('Opción a (Minúscula)');
      expect(formatFormAnswer(caseSensitiveQuestion, 'B').text).toBe(FALLBACK_UNKNOWN_OPTION_LABEL);
    });

    it('retorna el fallback de descripción no disponible si el valor no coincide exactamente con la definición', () => {
      const result = formatFormAnswer(question, 'opcion_antigua_descontinuada');
      expect(result).toEqual({
        text: FALLBACK_UNKNOWN_OPTION_LABEL,
        isUnanswered: false,
      });

      // Con espacios o mayúsculas no coincidentes con la clave definida en minúsculas
      expect(formatFormAnswer(question, 'TODO_NORMAL').text).toBe(FALLBACK_UNKNOWN_OPTION_LABEL);
    });
  });

  describe('Selección múltiple (multiple_choice)', () => {
    const question = {
      tipo: 'multiple_choice' as const,
      obligatoria: false,
      configuracion: {
        opciones: [
          { valor: 'nauseas', etiqueta: 'Náuseas o mareos' },
          { valor: 'fatiga', etiqueta: 'Cansancio extremo' },
          { valor: 'fiebre', etiqueta: 'Fiebre o escalofríos' },
        ],
      },
    };

    it('retorna lista de etiquetas legibles cuando todas coinciden', () => {
      const result = formatFormAnswer(question, ['nauseas', 'fiebre']);
      expect(result).toEqual({
        text: 'Náuseas o mareos\nFiebre o escalofríos',
        items: ['Náuseas o mareos', 'Fiebre o escalofríos'],
        isUnanswered: false,
      });
    });

    it('conserva etiquetas conocidas y aplica fallback solo a las desconocidas', () => {
      const result = formatFormAnswer(question, ['nauseas', 'desconocido_historico', 'fatiga']);
      expect(result.items).toEqual([
        'Náuseas o mareos',
        FALLBACK_UNKNOWN_OPTION_LABEL,
        'Cansancio extremo',
      ]);
      expect(result.isUnanswered).toBe(false);
    });

    it('distingue mayúsculas y minúsculas en selección múltiple conservando etiquetas independientes', () => {
      const caseSensitiveQuestion = {
        tipo: 'multiple_choice' as const,
        obligatoria: true,
        configuracion: {
          opciones: [
            { valor: 'X', etiqueta: 'Factor X' },
            { valor: 'x', etiqueta: 'Factor x' },
          ],
        },
      };

      const result = formatFormAnswer(caseSensitiveQuestion, ['X', 'x', 'Z']);
      expect(result.items).toEqual(['Factor X', 'Factor x', FALLBACK_UNKNOWN_OPTION_LABEL]);
    });

    it('maneja arreglo vacío como no respondido opcional', () => {
      const result = formatFormAnswer(question, []);
      expect(result).toEqual({
        text: UNANSWERED_OPTIONAL_LABEL,
        isUnanswered: true,
      });
    });
  });

  describe('Escala numérica (scale_0_10)', () => {
    it('trata el valor 0 como respuesta numérica válida (no como vacío)', () => {
      const question = {
        tipo: 'scale_0_10' as const,
        obligatoria: true,
        configuracion: {
          min: 0,
          max: 10,
          minEtiqueta: 'Sin dolor',
          maxEtiqueta: 'Dolor insoportable',
        },
      };

      const result = formatFormAnswer(question, 0);
      expect(result).toEqual({
        text: '0 de 10',
        scaleContext: '0: Sin dolor · 10: Dolor insoportable',
        isUnanswered: false,
      });
    });

    it('respeta límites configurados min y max diferentes de 0 y 10 (ej. 1 a 5)', () => {
      const question = {
        tipo: 'scale_0_10' as const,
        obligatoria: true,
        configuracion: {
          min: 1,
          max: 5,
          minEtiqueta: 'Poco o nada',
          maxEtiqueta: 'Muchísimo',
        },
      };

      const result = formatFormAnswer(question, 3);
      expect(result).toEqual({
        text: '3 de 5',
        scaleContext: '1: Poco o nada · 5: Muchísimo',
        isUnanswered: false,
      });
    });

    it('muestra etiqueta discreta si y solo si está explícitamente configurada para ese valor', () => {
      const question = {
        tipo: 'scale_0_10' as const,
        obligatoria: true,
        configuracion: {
          min: 1,
          max: 5,
          opciones: [
            { valor: '1', etiqueta: 'Leve' },
            { valor: '3', etiqueta: 'Moderado' },
            { valor: '5', etiqueta: 'Severo' },
          ],
        },
      };

      const result = formatFormAnswer(question, 3);
      expect(result).toEqual({
        text: '3 de 5 (Moderado)',
        scaleContext: undefined,
        isUnanswered: false,
      });
    });

    it('no inventa etiquetas si no están en opciones, solo usa etiquetas de extremos', () => {
      const question = {
        tipo: 'scale_0_10' as const,
        obligatoria: true,
        configuracion: {
          min: 0,
          max: 10,
          minEtiqueta: 'Nada',
          maxEtiqueta: 'Máximo',
        },
      };

      // Valor 7 no tiene etiqueta discreta, debe mostrar "7 de 10" con el contexto de extremos
      const result = formatFormAnswer(question, 7);
      expect(result).toEqual({
        text: '7 de 10',
        scaleContext: '0: Nada · 10: Máximo',
        isUnanswered: false,
      });
    });
  });

  describe('Texto libre (text)', () => {
    const question = {
      tipo: 'text' as const,
      obligatoria: false,
    };

    it('retorna el texto con trim', () => {
      const result = formatFormAnswer(question, '   Sensación de hormigueo en dedos   ');
      expect(result).toEqual({
        text: 'Sensación de hormigueo en dedos',
        isUnanswered: false,
      });
    });
  });

  describe('Manejo de obligatoriedad en respuestas no registradas', () => {
    it('indica "Sin respuesta registrada" cuando la pregunta obligatoria está vacía', () => {
      const questionReq = {
        tipo: 'single_choice' as const,
        obligatoria: true,
      };
      expect(formatFormAnswer(questionReq, null)).toEqual({
        text: UNANSWERED_REQUIRED_LABEL,
        isUnanswered: true,
      });
      expect(formatFormAnswer(questionReq, undefined)).toEqual({
        text: UNANSWERED_REQUIRED_LABEL,
        isUnanswered: true,
      });
      expect(formatFormAnswer(questionReq, '   ')).toEqual({
        text: UNANSWERED_REQUIRED_LABEL,
        isUnanswered: true,
      });
    });

    it('indica "Sin respuesta (opcional)" cuando la pregunta opcional está vacía', () => {
      const questionOpt = {
        tipo: 'text' as const,
        obligatoria: false,
      };
      expect(formatFormAnswer(questionOpt, null)).toEqual({
        text: UNANSWERED_OPTIONAL_LABEL,
        isUnanswered: true,
      });
      expect(formatFormAnswer(questionOpt, '')).toEqual({
        text: UNANSWERED_OPTIONAL_LABEL,
        isUnanswered: true,
      });
    });
  });

  describe('Fidelidad histórica entre versiones', () => {
    const defV1 = {
      tipo: 'single_choice' as const,
      configuracion: {
        opciones: [{ valor: 'opt_1', etiqueta: 'Versión antigua de la etiqueta' }],
      },
    };

    const defV2 = {
      tipo: 'single_choice' as const,
      configuracion: {
        opciones: [{ valor: 'opt_1', etiqueta: 'Versión nueva y mejorada' }],
      },
    };

    it('formatea según la definición provista para la versión histórica', () => {
      expect(formatFormAnswer(defV1, 'opt_1').text).toBe('Versión antigua de la etiqueta');
      expect(formatFormAnswer(defV2, 'opt_1').text).toBe('Versión nueva y mejorada');
    });
  });
});
