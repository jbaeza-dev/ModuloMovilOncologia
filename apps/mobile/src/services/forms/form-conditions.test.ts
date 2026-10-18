import { describe, expect, it } from 'vitest';
import {
  evaluateCondition,
  computeVisibleQuestions,
  validateConditionIntegrity,
} from './form-conditions';
import {
  DefinicionIncompatibleError,
  CondicionInvalidaError,
  TipoPreguntaNoSoportadoError,
  type FormCondition,
  type MedicalFormBundleItem,
} from '../../data/local/forms/form-types';

describe('form-conditions service', () => {
  describe('evaluateCondition', () => {
    it('evalúa operador "eq" correctamente', () => {
      const condition: FormCondition = { op: 'eq', questionId: 'P1', value: 'si' };
      expect(evaluateCondition(condition, { P1: 'si' })).toBe(true);
      expect(evaluateCondition(condition, { P1: 'no' })).toBe(false);
      expect(evaluateCondition(condition, {})).toBe(false);
      expect(evaluateCondition(condition, { P1: '' })).toBe(false);
    });

    it('evalúa operador "in" con valor único o array', () => {
      const condition: FormCondition = {
        op: 'in',
        questionId: 'P2.2',
        values: ['vomito_1_2', 'vomito_3_5'],
      };
      expect(evaluateCondition(condition, { 'P2.2': 'vomito_1_2' })).toBe(true);
      expect(evaluateCondition(condition, { 'P2.2': 'vomito_3_5' })).toBe(true);
      expect(evaluateCondition(condition, { 'P2.2': 'no_vomito' })).toBe(false);
      expect(evaluateCondition(condition, {})).toBe(false);
      expect(evaluateCondition(condition, { 'P2.2': ['otro', 'vomito_1_2'] })).toBe(true);
    });

    it('evalúa operador "all" exigiendo que todas las subcondiciones sean verdaderas', () => {
      const condition: FormCondition = {
        op: 'all',
        conditions: [
          { op: 'eq', questionId: 'P2', value: 'si' },
          { op: 'in', questionId: 'P2.2', values: ['vomito_1_2', 'vomito_3_5'] },
        ],
      };
      expect(evaluateCondition(condition, { P2: 'si', 'P2.2': 'vomito_1_2' })).toBe(true);
      expect(evaluateCondition(condition, { P2: 'no', 'P2.2': 'vomito_1_2' })).toBe(false);
      expect(evaluateCondition(condition, { P2: 'si', 'P2.2': 'no_vomito' })).toBe(false);
      expect(evaluateCondition(condition, { P2: 'si' })).toBe(false);
    });

    it('retorna false ante operadores o estructuras no soportadas', () => {
      const invalidCondition = { op: 'desconocido', questionId: 'P1' } as unknown as FormCondition;
      expect(evaluateCondition(invalidCondition, { P1: 'si' })).toBe(false);
    });
  });

  describe('computeVisibleQuestions y dependencias encadenadas', () => {
    it('resuelve visibilidad simple', () => {
      const questions = [
        { preguntaId: 'Q1' },
        {
          preguntaId: 'Q1.1',
          configuracion: {
            visibleWhen: { op: 'eq', questionId: 'Q1', value: 'si' } as FormCondition,
          },
        },
      ];

      const visibleSi = computeVisibleQuestions(questions, { Q1: 'si' });
      expect(visibleSi.has('Q1')).toBe(true);
      expect(visibleSi.has('Q1.1')).toBe(true);

      const visibleNo = computeVisibleQuestions(questions, { Q1: 'no' });
      expect(visibleNo.has('Q1')).toBe(true);
      expect(visibleNo.has('Q1.1')).toBe(false);
    });

    it('garantiza que si A oculta B, una respuesta residual de B no puede mantener visible a C', () => {
      // Cadena: Q1 habilita Q2; Q2 habilita Q3
      const questions = [
        { preguntaId: 'Q1' },
        {
          preguntaId: 'Q2',
          configuracion: {
            visibleWhen: { op: 'eq', questionId: 'Q1', value: 'si' } as FormCondition,
          },
        },
        {
          preguntaId: 'Q3',
          configuracion: {
            visibleWhen: { op: 'eq', questionId: 'Q2', value: 'si' } as FormCondition,
          },
        },
      ];

      // Caso 1: Ambos en Sí -> Q1, Q2 y Q3 visibles
      const allYes = computeVisibleQuestions(questions, { Q1: 'si', Q2: 'si' });
      expect(allYes.has('Q1')).toBe(true);
      expect(allYes.has('Q2')).toBe(true);
      expect(allYes.has('Q3')).toBe(true);

      // Caso 2: Q1 cambia a No, pero el estado de respuestas aún contiene Q2: 'si'
      const residualAnswers = { Q1: 'no', Q2: 'si' };
      const afterChange = computeVisibleQuestions(questions, residualAnswers);

      expect(afterChange.has('Q1')).toBe(true);
      expect(afterChange.has('Q2')).toBe(false);
      // Q3 DEBE estar oculta porque Q2 está oculta, impidiendo que su respuesta residual active a Q3
      expect(afterChange.has('Q3')).toBe(false);
    });
  });

  describe('validateConditionIntegrity', () => {
    it('acepta una definición válida con orden secuencial correcto', () => {
      const formItem: MedicalFormBundleItem = {
        formularioId: 'form-test',
        version: '1.0.0',
        titulo: 'Formulario de prueba',
        descripcion: 'Descripción',
        duracionEstimadaMin: 5,
        configuracion: {
          secciones: [
            { id: 'sec-1', titulo: 'Sección 1', orden: 1 },
            { id: 'sec-2', titulo: 'Sección 2', orden: 2 },
          ],
        },
        preguntas: [
          {
            preguntaId: 'P0',
            texto: '¿Tienes dispositivo?',
            tipo: 'single_choice',
            orden: 1,
            configuracion: {
              sectionId: 'sec-1',
              opciones: [
                { valor: 'si', etiqueta: 'Sí' },
                { valor: 'no', etiqueta: 'No' },
              ],
            },
          },
          {
            preguntaId: 'P0.1',
            texto: 'Detalles del dispositivo',
            tipo: 'single_choice',
            orden: 2,
            configuracion: {
              sectionId: 'sec-1',
              visibleWhen: { op: 'eq', questionId: 'P0', value: 'si' },
              opciones: [
                { valor: 'bien', etiqueta: 'Bien' },
                { valor: 'rojo', etiqueta: 'Rojo' },
              ],
            },
          },
          {
            preguntaId: 'P1',
            texto: 'Comentario',
            tipo: 'text',
            orden: 3,
            configuracion: {
              sectionId: 'sec-2',
              maxLength: 500,
            },
          },
        ],
      };

      expect(() => validateConditionIntegrity(formItem)).not.toThrow();
    });

    it('rechaza referencias hacia adelante en el orden de presentación', () => {
      const formItem: MedicalFormBundleItem = {
        formularioId: 'form-forward-ref',
        version: '1.0.0',
        titulo: 'Test Forward Ref',
        descripcion: 'Descripción',
        duracionEstimadaMin: 5,
        preguntas: [
          {
            preguntaId: 'P_PRIMERA',
            texto: 'Pregunta 1',
            tipo: 'single_choice',
            orden: 1,
            // Referencia ilegal hacia una pregunta posterior P_SEGUNDA
            configuracion: {
              visibleWhen: { op: 'eq', questionId: 'P_SEGUNDA', value: 'si' },
            },
          },
          {
            preguntaId: 'P_SEGUNDA',
            texto: 'Pregunta 2',
            tipo: 'single_choice',
            orden: 2,
            configuracion: {
              opciones: [{ valor: 'si', etiqueta: 'Sí' }],
            },
          },
        ],
      };

      expect(() => validateConditionIntegrity(formItem)).toThrow(DefinicionIncompatibleError);
      expect(() => validateConditionIntegrity(formItem)).toThrow(
        /hace referencia a una pregunta posterior o a sí misma/,
      );
    });

    it('rechaza autoreferencias', () => {
      const formItem: MedicalFormBundleItem = {
        formularioId: 'form-self-ref',
        version: '1.0.0',
        titulo: 'Test Self Ref',
        descripcion: 'Descripción',
        duracionEstimadaMin: 5,
        preguntas: [
          {
            preguntaId: 'P_AUTO',
            texto: 'Pregunta autoreferenciada',
            tipo: 'single_choice',
            orden: 1,
            configuracion: {
              visibleWhen: { op: 'eq', questionId: 'P_AUTO', value: 'si' },
            },
          },
        ],
      };

      expect(() => validateConditionIntegrity(formItem)).toThrow(DefinicionIncompatibleError);
    });

    it('rechaza referencias a preguntas inexistentes', () => {
      const formItem: MedicalFormBundleItem = {
        formularioId: 'form-unknown-ref',
        version: '1.0.0',
        titulo: 'Test Unknown Ref',
        descripcion: 'Descripción',
        duracionEstimadaMin: 5,
        preguntas: [
          {
            preguntaId: 'P1',
            texto: 'Pregunta',
            tipo: 'single_choice',
            orden: 1,
            configuracion: {
              visibleWhen: { op: 'eq', questionId: 'P_NO_EXISTE', value: 'si' },
            },
          },
        ],
      };

      expect(() => validateConditionIntegrity(formItem)).toThrow(DefinicionIncompatibleError);
      expect(() => validateConditionIntegrity(formItem)).toThrow(/pregunta desconocida/);
    });

    it('rechaza valores no definidos en las opciones de la pregunta referenciada', () => {
      const formItem: MedicalFormBundleItem = {
        formularioId: 'form-invalid-value',
        version: '1.0.0',
        titulo: 'Test Invalid Value',
        descripcion: 'Descripción',
        duracionEstimadaMin: 5,
        preguntas: [
          {
            preguntaId: 'P0',
            texto: 'Madre',
            tipo: 'single_choice',
            orden: 1,
            configuracion: {
              opciones: [{ valor: 'si', etiqueta: 'Sí' }],
            },
          },
          {
            preguntaId: 'P1',
            texto: 'Hija',
            tipo: 'single_choice',
            orden: 2,
            configuracion: {
              // 'no_existe_este_valor' no está en opciones de P0
              visibleWhen: { op: 'eq', questionId: 'P0', value: 'no_existe_este_valor' },
            },
          },
        ],
      };

      expect(() => validateConditionIntegrity(formItem)).toThrow(DefinicionIncompatibleError);
      expect(() => validateConditionIntegrity(formItem)).toThrow(/no existe en las opciones/);
    });

    it('rechaza tipos de pregunta no soportados', () => {
      const formItem: MedicalFormBundleItem = {
        formularioId: 'form-bad-type',
        version: '1.0.0',
        titulo: 'Bad Type',
        descripcion: 'Desc',
        duracionEstimadaMin: 5,
        preguntas: [
          {
            preguntaId: 'P1',
            texto: 'Pregunta con tipo no admitido',
            tipo: 'slider_no_soportado',
            orden: 1,
          },
        ],
      };

      expect(() => validateConditionIntegrity(formItem)).toThrow(TipoPreguntaNoSoportadoError);
    });

    it('rechaza maxLength no entero o menor o igual a cero', () => {
      const formItem: MedicalFormBundleItem = {
        formularioId: 'form-bad-length',
        version: '1.0.0',
        titulo: 'Bad Length',
        descripcion: 'Desc',
        duracionEstimadaMin: 5,
        preguntas: [
          {
            preguntaId: 'P1',
            texto: 'Pregunta con maxLength inválido',
            tipo: 'text',
            orden: 1,
            configuracion: { maxLength: -10 },
          },
        ],
      };

      expect(() => validateConditionIntegrity(formItem)).toThrow(DefinicionIncompatibleError);
    });

    it('rechaza operador "in" con lista vacía de valores', () => {
      const formItem: MedicalFormBundleItem = {
        formularioId: 'form-empty-in',
        version: '1.0.0',
        titulo: 'Empty In',
        descripcion: 'Desc',
        duracionEstimadaMin: 5,
        preguntas: [
          {
            preguntaId: 'P0',
            texto: 'Madre',
            tipo: 'single_choice',
            orden: 1,
            configuracion: { opciones: [{ valor: 'si', etiqueta: 'Sí' }] },
          },
          {
            preguntaId: 'P1',
            texto: 'Hija',
            tipo: 'single_choice',
            orden: 2,
            configuracion: {
              visibleWhen: { op: 'in', questionId: 'P0', values: [] },
            },
          },
        ],
      };

      expect(() => validateConditionIntegrity(formItem)).toThrow(CondicionInvalidaError);
    });

    it('rechaza operador "all" con lista vacía de condiciones', () => {
      const formItem: MedicalFormBundleItem = {
        formularioId: 'form-empty-all',
        version: '1.0.0',
        titulo: 'Empty All',
        descripcion: 'Desc',
        duracionEstimadaMin: 5,
        preguntas: [
          {
            preguntaId: 'P0',
            texto: 'Madre',
            tipo: 'single_choice',
            orden: 1,
          },
          {
            preguntaId: 'P1',
            texto: 'Hija',
            tipo: 'single_choice',
            orden: 2,
            configuracion: {
              visibleWhen: { op: 'all', conditions: [] },
            },
          },
        ],
      };

      expect(() => validateConditionIntegrity(formItem)).toThrow(CondicionInvalidaError);
    });
  });
});
