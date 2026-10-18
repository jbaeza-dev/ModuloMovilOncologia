/// <reference types="jest" />

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

import { QuestionInput } from '../features/medical-forms/components/QuestionInput';
import { DailyFollowUpScreen } from '../features/medical-forms/DailyFollowUpScreen';
import { FormSectionScreen } from '../features/medical-forms/FormSectionScreen';
import { DailyFormReviewScreen } from '../features/medical-forms/DailyFormReviewScreen';
import { SAMPLE_DECOUPLED_FORM } from '../features/medical-forms/fixtures/sample-decoupled-form';

// Mock expo-router
const mockRouterPush = jest.fn();
const mockRouterReplace = jest.fn();
const mockRouterBack = jest.fn();
const mockUseLocalSearchParams = jest.fn();

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    router: {
      push: (...args: unknown[]) => mockRouterPush(...args),
      replace: (...args: unknown[]) => mockRouterReplace(...args),
      back: (...args: unknown[]) => mockRouterBack(...args),
      canGoBack: () => true,
    },
    useLocalSearchParams: () => mockUseLocalSearchParams(),
    useFocusEffect: (cb: () => void | (() => void)) => {
      React.useEffect(() => {
        return cb();
      }, [cb]);
    },
  };
});

jest.mock('expo-router/react-navigation', () => ({
  useNavigationState: (selector: (state: { index: number }) => unknown) => selector({ index: 0 }),
}));

// Mock theme
const mockTheme = {
  colors: {
    background: '#FFFFFF',
    surface: '#F5F5F5',
    mutedSurface: '#E0E0E0',
    primary: '#00695C',
    onPrimary: '#FFFFFF',
    primaryContainer: '#E0F2EF',
    onPrimaryContainer: '#183B36',
    border: '#D0D0D0',
    text: '#212121',
    secondary: '#555555',
    error: '#D32F2F',
    errorContainer: '#FFEBEE',
    onErrorContainer: '#B71C1C',
    success: '#388E3C',
    warning: '#F57C00',
    surfaceVariant: '#F0F7FF',
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { sm: 12, md: 18, full: 9999 },
};

jest.mock('../providers/ThemeProvider', () => ({
  useAppTheme: () => ({ theme: mockTheme }),
}));

// Mock repository
const mockRepository = {
  listAssignedForms: jest.fn(),
  getDailyFormStatus: jest.fn(),
  getFormDefinition: jest.fn(),
  getOrCreateDailyDraft: jest.fn(),
  saveDailyDraft: jest.fn(),
  confirmDailySubmission: jest.fn(),
  discardDraft: jest.fn(),
  getDraft: jest.fn(),
};

jest.mock('../providers/LocalDataProvider', () => ({
  useLocalData: () => ({
    repository: mockRepository,
    patientId: 'patient-test-1',
    formStorageReady: true,
  }),
}));

describe('Pruebas de UI: Componentes y Pantallas de Formularios Médicos', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalSearchParams.mockReturnValue({});
  });

  describe('QuestionInput', () => {
    it('renderiza single_choice con rol radio y área táctil accesible', async () => {
      const onChange = jest.fn();
      await render(
        <QuestionInput
          question={{
            id: 'P1',
            pregunta: '¿Has tenido fiebre en las últimas 24 horas?',
            tipo: 'single_choice',
            requerida: true,
            configuracion: {
              opciones: [
                { valor: 'si', etiqueta: 'Sí' },
                { valor: 'no', etiqueta: 'No' },
              ],
            },
          }}
          value="no"
          onChange={onChange}
        />,
      );

      expect(screen.getByText(/¿Has tenido fiebre en las últimas 24 horas\?/)).toBeTruthy();
      const optionSi = screen.getByLabelText('Sí');
      const optionNo = screen.getByLabelText('No, seleccionado');
      expect(optionSi).toBeTruthy();
      expect(optionNo).toBeTruthy();

      fireEvent.press(optionSi);
      expect(onChange).toHaveBeenCalledWith('si');
    });

    it('renderiza multiple_choice con rol checkbox y respeta opción excluyente', async () => {
      const onChange = jest.fn();
      await render(
        <QuestionInput
          question={{
            id: 'P2.1',
            pregunta: '¿Qué molestias has tenido?',
            tipo: 'multiple_choice',
            configuracion: {
              opciones: [
                { valor: 'nauseas', etiqueta: 'Náuseas' },
                { valor: 'ardor', etiqueta: 'Ardor' },
                { valor: 'ninguna', etiqueta: 'Ninguna de las anteriores', esExcluyente: true },
              ],
            },
          }}
          value={['nauseas']}
          onChange={onChange}
        />,
      );

      expect(screen.getByText('Puedes marcar más de una opción.')).toBeTruthy();

      // Pulsar la opción excluyente "Ninguna"
      const optionNinguna = screen.getByLabelText('Ninguna de las anteriores');
      fireEvent.press(optionNinguna);

      // Debe retornar solo ['ninguna'], desmarcando 'nauseas'
      expect(onChange).toHaveBeenCalledWith(['ninguna']);
    });

    it('renderiza scale_0_10 con etiquetas de extremos y botones 0 a 10', async () => {
      const onChange = jest.fn();
      await render(
        <QuestionInput
          question={{
            id: 'P9.B.1',
            pregunta: '¿Qué tan intenso fue el dolor?',
            tipo: 'scale_0_10',
            configuracion: {
              minEtiqueta: '0 = Sin dolor',
              maxEtiqueta: '10 = Máximo dolor',
            },
          }}
          value={5}
          onChange={onChange}
        />,
      );

      expect(screen.getByText('0 = Sin dolor')).toBeTruthy();
      expect(screen.getByText('10 = Máximo dolor')).toBeTruthy();

      const btn8 = screen.getByLabelText('Nivel 8');
      fireEvent.press(btn8);
      expect(onChange).toHaveBeenCalledWith(8);
    });

    it('renderiza campo de texto multilínea con contador dinámico de maxLength', async () => {
      const onChange = jest.fn();
      await render(
        <QuestionInput
          question={{
            id: 'P10',
            pregunta: '¿Quieres agregar algún comentario?',
            tipo: 'text',
            configuracion: {
              maxLength: 500,
            },
          }}
          value="Me sentí mejor por la tarde."
          onChange={onChange}
        />,
      );

      expect(screen.getByText(/28.*de.*500.*caracteres/)).toBeTruthy();

      const input = screen.getByPlaceholderText('Escribe tu respuesta aquí (opcional)...');
      fireEvent.changeText(input, 'Nuevo texto');
      expect(onChange).toHaveBeenCalledWith('Nuevo texto');
    });
  });

  describe('DailyFollowUpScreen', () => {
    it('muestra "Responder seguimiento de hoy" cuando no hay entregas ni borradores', async () => {
      mockRepository.listAssignedForms.mockResolvedValue([
        {
          formulario_id: 'seguimiento-domiciliario',
          version: '1.0.0',
          titulo: 'Seguimiento domiciliario',
          descripcion: 'Cuestionario diario',
          estado_conocido: 'activa',
        },
      ]);

      mockRepository.getDailyFormStatus.mockResolvedValue({
        hasSubmittedToday: false,
        hasActiveDraft: false,
        hasOlderDraft: false,
        activeDraft: null,
        olderDraft: null,
        lastSubmission: null,
        todayTrackingDate: '2026-10-18',
      });

      mockRepository.getFormDefinition.mockResolvedValue({
        formulario_id: 'seguimiento-domiciliario',
        version: '1.0.0',
        titulo: 'Seguimiento domiciliario',
        descripcion: 'Cuestionario diario',
        duracion_estimada_min: 5,
        preguntas: [],
      });

      await render(<DailyFollowUpScreen />);

      await waitFor(() => {
        expect(screen.getByText('Cómo me siento hoy')).toBeTruthy();
        expect(screen.getByText('Responder seguimiento de hoy')).toBeTruthy();
      });
    });

    it('muestra "Continuar mi registro de hoy" cuando existe un borrador activo', async () => {
      mockRepository.listAssignedForms.mockResolvedValue([
        {
          formulario_id: 'seguimiento-domiciliario',
          version: '1.0.0',
          titulo: 'Seguimiento domiciliario',
          descripcion: 'Cuestionario diario',
          estado_conocido: 'activa',
        },
      ]);

      mockRepository.getDailyFormStatus.mockResolvedValue({
        hasSubmittedToday: false,
        hasActiveDraft: true,
        hasOlderDraft: false,
        activeDraft: {
          periodo_clave: 'dia:2026-10-18',
          entrega_id: 'draft-today-1',
          respuestas_json: '{"P1":"si"}',
        },
        olderDraft: null,
        lastSubmission: null,
        todayTrackingDate: '2026-10-18',
      });

      mockRepository.getFormDefinition.mockResolvedValue({
        formulario_id: 'seguimiento-domiciliario',
        version: '1.0.0',
        titulo: 'Seguimiento domiciliario',
        descripcion: 'Cuestionario diario',
        duracion_estimada_min: 5,
        preguntas: [],
      });

      await render(<DailyFollowUpScreen />);

      await waitFor(() => {
        expect(screen.getByText('Continuar mi registro de hoy')).toBeTruthy();
      });
    });

    it('muestra "Ver mi registro de hoy" cuando el paciente ya confirmó su seguimiento', async () => {
      mockRepository.listAssignedForms.mockResolvedValue([
        {
          formulario_id: 'seguimiento-domiciliario',
          version: '1.0.0',
          titulo: 'Seguimiento domiciliario',
          descripcion: 'Cuestionario diario',
          estado_conocido: 'activa',
        },
      ]);

      mockRepository.getDailyFormStatus.mockResolvedValue({
        hasSubmittedToday: true,
        hasActiveDraft: false,
        hasOlderDraft: false,
        activeDraft: null,
        olderDraft: null,
        lastSubmission: { id: 'sub-confirmed-today' },
        todayTrackingDate: '2026-10-18',
      });

      mockRepository.getFormDefinition.mockResolvedValue({
        formulario_id: 'seguimiento-domiciliario',
        version: '1.0.0',
        titulo: 'Seguimiento domiciliario',
        descripcion: 'Cuestionario diario',
        duracion_estimada_min: 5,
        preguntas: [],
      });

      await render(<DailyFollowUpScreen />);

      await waitFor(() => {
        expect(screen.getByText('Ver mi registro de hoy')).toBeTruthy();
        expect(screen.getByText('Registrar una nueva actualización')).toBeTruthy();
      });
    });

    it('muestra tarjeta de advertencia para borrador de día anterior', async () => {
      mockRepository.listAssignedForms.mockResolvedValue([
        {
          formulario_id: 'seguimiento-domiciliario',
          version: '1.0.0',
          titulo: 'Seguimiento domiciliario',
          descripcion: 'Cuestionario diario',
          estado_conocido: 'activa',
        },
      ]);

      mockRepository.getDailyFormStatus.mockResolvedValue({
        hasSubmittedToday: false,
        hasActiveDraft: false,
        hasOlderDraft: true,
        activeDraft: null,
        olderDraft: {
          formulario_id: 'seguimiento-domiciliario',
          version: '1.0.0',
          periodo_clave: 'dia:2026-10-17',
          fecha_seguimiento: '2026-10-17',
          entrega_id: 'draft-older-1',
        },
        lastSubmission: null,
        todayTrackingDate: '2026-10-18',
      });

      mockRepository.getFormDefinition.mockResolvedValue({
        formulario_id: 'seguimiento-domiciliario',
        version: '1.0.0',
        titulo: 'Seguimiento domiciliario',
        descripcion: 'Cuestionario diario',
        duracion_estimada_min: 5,
        preguntas: [],
      });

      await render(<DailyFollowUpScreen />);

      await waitFor(() => {
        expect(screen.getByText(/Borrador pendiente/)).toBeTruthy();
        expect(screen.getByText('Continuar borrador anterior')).toBeTruthy();
        expect(screen.getByText('Descartar borrador anterior')).toBeTruthy();
      });
    });
  });

  describe('FormSectionScreen con Formulario Desacoplado', () => {
    it('demuestra desacoplamiento e interpreta formulario de prueba de 2 secciones con IDs Q_*', async () => {
      mockUseLocalSearchParams.mockReturnValue({
        id: SAMPLE_DECOUPLED_FORM.formularioId,
        version: SAMPLE_DECOUPLED_FORM.version,
      });

      mockRepository.getFormDefinition.mockResolvedValue({
        formulario_id: SAMPLE_DECOUPLED_FORM.formularioId,
        version: SAMPLE_DECOUPLED_FORM.version,
        titulo: SAMPLE_DECOUPLED_FORM.titulo,
        descripcion: SAMPLE_DECOUPLED_FORM.descripcion,
        duracion_estimada_min: SAMPLE_DECOUPLED_FORM.duracionEstimadaMin,
        configuracion_json: JSON.stringify(SAMPLE_DECOUPLED_FORM.configuracion),
        configuracion: SAMPLE_DECOUPLED_FORM.configuracion,
        preguntas: SAMPLE_DECOUPLED_FORM.preguntas.map((q) => ({
          formulario_id: SAMPLE_DECOUPLED_FORM.formularioId,
          version: SAMPLE_DECOUPLED_FORM.version,
          pregunta_id: q.preguntaId,
          texto: q.texto,
          descripcion: q.descripcion ?? null,
          tipo: q.tipo,
          orden: q.orden,
          requerida: q.requerida ? 1 : 0,
          configuracion_json: JSON.stringify(q.configuracion),
          configuracion: q.configuracion,
          retirado: 0,
        })),
      });

      mockRepository.getOrCreateDailyDraft.mockResolvedValue({
        formId: SAMPLE_DECOUPLED_FORM.formularioId,
        version: SAMPLE_DECOUPLED_FORM.version,
        periodoClave: 'dia:2026-10-18',
        entregaId: 'del-decoupled-1',
        fechaSeguimiento: '2026-10-18',
        zonaHoraria: 'America/Santiago',
        iniciadoEn: '2026-10-18T10:00:00Z',
        ventanaDesde: '2026-10-17T10:00:00Z',
        ventanaHasta: '2026-10-18T10:00:00Z',
        pasoActual: 'sec-animo',
        respuestas: {},
        guardadoEn: '2026-10-18T10:00:00Z',
      });

      await render(<FormSectionScreen />);

      // Debe calcular dinámicamente "Sección 1 de 2" (no 11)
      await waitFor(() => {
        expect(screen.getByText('Sección 1 de 2')).toBeTruthy();
        expect(screen.getByText('Estado de ánimo')).toBeTruthy();
      });

      // La pregunta Q_ANIMO está visible
      expect(screen.getByText(/¿Te has sentido con buen ánimo hoy\?/)).toBeTruthy();

      // Q_DETALLE_ANIMO no está visible inicialmente porque depende de Q_ANIMO = 'si'
      expect(screen.queryByText('¿Qué actividad te ayudó a sentirte mejor?')).toBeNull();

      // Seleccionar opción "si"
      const optionSi = screen.getByLabelText('Sí');
      fireEvent.press(optionSi);

      // Ahora Q_DETALLE_ANIMO debe aparecer dinámicamente
      await waitFor(() => {
        expect(screen.getByText('¿Qué actividad te ayudó a sentirte mejor?')).toBeTruthy();
      });

      // Avanzar a la sección 2
      const btnContinuar = screen.getByText('Continuar');
      fireEvent.press(btnContinuar);

      // Debe anunciar "Sección 2 de 2" y mostrar Q_COMENTARIO con límite de 200 caracteres
      await waitFor(() => {
        expect(screen.getByText('Sección 2 de 2')).toBeTruthy();
        expect(screen.getByText('Comentario breve')).toBeTruthy();
      });

      expect(screen.getByText('0 de 200 caracteres')).toBeTruthy();
    });

    it('solicita confirmación contextual al cambiar una pregunta madre que oculta hijas respondidas', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert');

      mockUseLocalSearchParams.mockReturnValue({
        id: SAMPLE_DECOUPLED_FORM.formularioId,
        version: SAMPLE_DECOUPLED_FORM.version,
      });

      mockRepository.getFormDefinition.mockResolvedValue({
        formulario_id: SAMPLE_DECOUPLED_FORM.formularioId,
        version: SAMPLE_DECOUPLED_FORM.version,
        titulo: SAMPLE_DECOUPLED_FORM.titulo,
        descripcion: SAMPLE_DECOUPLED_FORM.descripcion,
        duracion_estimada_min: SAMPLE_DECOUPLED_FORM.duracionEstimadaMin,
        configuracion: SAMPLE_DECOUPLED_FORM.configuracion,
        preguntas: SAMPLE_DECOUPLED_FORM.preguntas.map((q) => ({
          formulario_id: SAMPLE_DECOUPLED_FORM.formularioId,
          version: SAMPLE_DECOUPLED_FORM.version,
          pregunta_id: q.preguntaId,
          texto: q.texto,
          tipo: q.tipo,
          orden: q.orden,
          requerida: q.requerida ? 1 : 0,
          configuracion: q.configuracion,
          retirado: 0,
        })),
      });

      // Borrador inicial con Q_ANIMO = 'si' y Q_DETALLE_ANIMO respondida
      mockRepository.getOrCreateDailyDraft.mockResolvedValue({
        formId: SAMPLE_DECOUPLED_FORM.formularioId,
        version: SAMPLE_DECOUPLED_FORM.version,
        periodoClave: 'dia:2026-10-18',
        entregaId: 'del-decoupled-1',
        fechaSeguimiento: '2026-10-18',
        zonaHoraria: 'America/Santiago',
        iniciadoEn: '2026-10-18T10:00:00Z',
        ventanaDesde: '2026-10-17T10:00:00Z',
        ventanaHasta: '2026-10-18T10:00:00Z',
        pasoActual: 'sec-animo',
        respuestas: {
          Q_ANIMO: 'si',
          Q_DETALLE_ANIMO: 'descanso',
        },
        guardadoEn: '2026-10-18T10:00:00Z',
      });

      await render(<FormSectionScreen />);

      await waitFor(() => {
        expect(screen.getByText('Sección 1 de 2')).toBeTruthy();
      });

      // Ambas preguntas están visibles
      expect(screen.getByText(/¿Te has sentido con buen ánimo hoy\?/)).toBeTruthy();
      expect(screen.getByText('¿Qué actividad te ayudó a sentirte mejor?')).toBeTruthy();

      // Cambiar la madre a "no"
      const optionNo = screen.getByLabelText('No');
      fireEvent.press(optionNo);

      // Debe haber invocado Alert.alert solicitando confirmación
      expect(alertSpy).toHaveBeenCalledWith(
        'Cambiar respuesta',
        expect.stringContaining('Al cambiar esta respuesta se quitarán las respuestas'),
        expect.any(Array),
      );

      alertSpy.mockRestore();
    });
  });

  describe('DailyFormReviewScreen', () => {
    it('muestra únicamente preguntas visibles con sus respuestas y permite confirmar', async () => {
      mockUseLocalSearchParams.mockReturnValue({
        id: SAMPLE_DECOUPLED_FORM.formularioId,
        version: SAMPLE_DECOUPLED_FORM.version,
        periodoClave: 'dia:2026-10-18',
        deliveryId: 'del-rev-1',
      });

      mockRepository.getFormDefinition.mockResolvedValue({
        formulario_id: SAMPLE_DECOUPLED_FORM.formularioId,
        version: SAMPLE_DECOUPLED_FORM.version,
        titulo: SAMPLE_DECOUPLED_FORM.titulo,
        descripcion: SAMPLE_DECOUPLED_FORM.descripcion,
        duracion_estimada_min: SAMPLE_DECOUPLED_FORM.duracionEstimadaMin,
        configuracion: SAMPLE_DECOUPLED_FORM.configuracion,
        preguntas: SAMPLE_DECOUPLED_FORM.preguntas.map((q) => ({
          formulario_id: SAMPLE_DECOUPLED_FORM.formularioId,
          version: SAMPLE_DECOUPLED_FORM.version,
          pregunta_id: q.preguntaId,
          texto: q.texto,
          tipo: q.tipo,
          orden: q.orden,
          requerida: q.requerida ? 1 : 0,
          configuracion: q.configuracion,
          retirado: 0,
        })),
      });

      mockRepository.getDraft.mockResolvedValue({
        entregaId: 'del-rev-1',
        respuestas: {
          Q_ANIMO: 'no',
          Q_COMENTARIO: 'Todo tranquilo hoy.',
        },
        guardadoEn: '2026-10-18T10:00:00Z',
      });

      mockRepository.confirmDailySubmission.mockResolvedValue('del-rev-1');

      await render(<DailyFormReviewScreen />);

      await waitFor(() => {
        expect(screen.getByText('Revisa tus respuestas')).toBeTruthy();
      });

      // Q_ANIMO está visible y muestra la etiqueta
      expect(screen.getByText('¿Te has sentido con buen ánimo hoy?')).toBeTruthy();
      expect(screen.getByText('No')).toBeTruthy();

      // Q_DETALLE_ANIMO estaba oculta (porque Q_ANIMO = 'no'), por lo que NO debe aparecer en la revisión
      expect(screen.queryByText('¿Qué actividad te ayudó a sentirte mejor?')).toBeNull();

      // Q_COMENTARIO sí aparece
      expect(
        screen.getByText('Escribe un comentario breve sobre tu jornada (máximo 200 caracteres):'),
      ).toBeTruthy();
      expect(screen.getByText('Todo tranquilo hoy.')).toBeTruthy();

      // Confirmar
      const btnConfirmar = screen.getByText('Confirmar y registrar seguimiento');
      fireEvent.press(btnConfirmar);

      await waitFor(() => {
        expect(screen.getByText('Registro completado con éxito')).toBeTruthy();
        expect(screen.getByText('Guardado en este dispositivo · Pendiente de envío')).toBeTruthy();
      });
    });
  });
});
