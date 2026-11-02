/// <reference types="jest" />

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

import { QuestionInput } from '../features/medical-forms/components/QuestionInput';
import { DailyFollowUpScreen } from '../features/medical-forms/DailyFollowUpScreen';
import { FormSectionScreen } from '../features/medical-forms/FormSectionScreen';
import { DailyFormReviewScreen } from '../features/medical-forms/DailyFormReviewScreen';
import { MedicalFormSubmissionDetailScreen } from '../features/medical-forms/MedicalFormsScreens';
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
  getSubmission: jest.fn(),
};

jest.mock('../providers/LocalDataProvider', () => ({
  useLocalData: () => ({
    repository: mockRepository,
    patientId: 'patient-test-1',
    formStorageReady: true,
    trackOperation: jest.fn((fn: () => Promise<unknown>) => fn()),
  }),
}));

describe('Pruebas de UI: Componentes y Pantallas de Formularios Médicos', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalSearchParams.mockReturnValue({});
    mockRepository.saveDailyDraft.mockResolvedValue(undefined);
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

      await fireEvent.press(optionSi);
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
      await fireEvent.press(optionNinguna);

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
      await fireEvent.press(btn8);
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
      await fireEvent.changeText(input, 'Nuevo texto');
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

    it('muestra "Continuar mi registro" cuando existe un borrador activo', async () => {
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
        expect(screen.getByText('Continuar mi registro')).toBeTruthy();
      });
    });

    it('muestra "Ver mis respuestas de hoy" cuando el paciente ya confirmó su seguimiento', async () => {
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
        expect(screen.getByText('Ver mis respuestas de hoy')).toBeTruthy();
        expect(screen.getByText('Registrar otra actualización')).toBeTruthy();
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

    it('muestra aviso y opciones para borrador de hoy de versión previa (1.0.0 frente a 1.1.0 asignada)', async () => {
      mockRepository.listAssignedForms.mockResolvedValue([
        {
          formulario_id: 'seguimiento-domiciliario',
          version: '1.1.0',
          titulo: 'Seguimiento domiciliario',
          descripcion: 'Cuestionario diario',
          estado_conocido: 'activa',
          periodicidad: 'daily',
        },
      ]);

      mockRepository.getDailyFormStatus.mockResolvedValue({
        hasSubmittedToday: false,
        hasActiveDraft: true,
        hasOlderDraft: false,
        activeDraft: {
          formulario_id: 'seguimiento-domiciliario',
          version: '1.0.0',
          periodo_clave: 'dia:2026-10-18',
          fecha_seguimiento: '2026-10-18',
          entrega_id: 'draft-today-v1',
        },
        olderDraft: null,
        lastSubmission: null,
        todayTrackingDate: '2026-10-18',
      });

      mockRepository.getFormDefinition.mockResolvedValue({
        formulario_id: 'seguimiento-domiciliario',
        version: '1.1.0',
        titulo: 'Seguimiento domiciliario',
        descripcion: 'Cuestionario diario',
        duracion_estimada_min: 5,
        preguntas: [],
      });

      await render(<DailyFollowUpScreen />);

      await waitFor(() => {
        expect(screen.getByText(/Tu borrador conserva la edición anterior/)).toBeTruthy();
        expect(screen.getByText('Continuar mi registro')).toBeTruthy();
        expect(screen.getByText('Descartar este borrador')).toBeTruthy();
      });

      // Al presionar continuar, navega con la identidad del borrador (1.0.0)
      const btnContinue = screen.getByText('Continuar mi registro');
      await fireEvent.press(btnContinue);

      await waitFor(() => {
        expect(mockRepository.getOrCreateDailyDraft).toHaveBeenCalledWith(
          'seguimiento-domiciliario',
          '1.0.0',
          'dia:2026-10-18',
        );
        expect(mockRouterPush).toHaveBeenCalledWith({
          pathname: '/formulario/cuestionario',
          params: {
            id: 'seguimiento-domiciliario',
            version: '1.0.0',
            periodoClave: 'dia:2026-10-18',
          },
        });
      });
    });

    it('descartar borrador de hoy de versión previa (1.0.0) invoca discardDraft con la versión y período del borrador activo', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert');

      mockRepository.listAssignedForms.mockResolvedValue([
        {
          formulario_id: 'seguimiento-domiciliario',
          version: '1.1.0',
          titulo: 'Seguimiento domiciliario',
          descripcion: 'Cuestionario diario',
          estado_conocido: 'activa',
          periodicidad: 'daily',
        },
      ]);

      mockRepository.getDailyFormStatus.mockResolvedValue({
        hasSubmittedToday: false,
        hasActiveDraft: true,
        hasOlderDraft: false,
        activeDraft: {
          formulario_id: 'seguimiento-domiciliario',
          version: '1.0.0',
          periodo_clave: 'dia:2026-10-18',
          fecha_seguimiento: '2026-10-18',
          entrega_id: 'draft-today-v1',
        },
        olderDraft: null,
        lastSubmission: null,
        todayTrackingDate: '2026-10-18',
      });

      mockRepository.getFormDefinition.mockResolvedValue({
        formulario_id: 'seguimiento-domiciliario',
        version: '1.1.0',
        titulo: 'Seguimiento domiciliario',
        descripcion: 'Cuestionario diario',
        duracion_estimada_min: 5,
        preguntas: [],
      });

      await render(<DailyFollowUpScreen />);

      await waitFor(() => {
        expect(screen.getByText('Descartar este borrador')).toBeTruthy();
      });

      const btnDiscard = screen.getByText('Descartar este borrador');
      await fireEvent.press(btnDiscard);

      expect(alertSpy).toHaveBeenCalled();
      const alertCall = alertSpy.mock.calls[0];
      const buttons = alertCall[2];
      const discardBtn = buttons?.find((b: { text?: string }) => b.text === 'Descartar');
      expect(discardBtn).toBeTruthy();

      await act(async () => {
        await discardBtn?.onPress?.();
      });

      expect(mockRepository.discardDraft).toHaveBeenCalledWith(
        'seguimiento-domiciliario',
        '1.0.0',
        'dia:2026-10-18',
      );
    });

    it('descartar borrador anterior utiliza la versión y período del registro (1.0.0)', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert');

      mockRepository.listAssignedForms.mockResolvedValue([
        {
          formulario_id: 'seguimiento-domiciliario',
          version: '1.1.0',
          titulo: 'Seguimiento domiciliario',
          descripcion: 'Cuestionario diario',
          estado_conocido: 'activa',
          periodicidad: 'daily',
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
          entrega_id: 'draft-older-v1',
        },
        lastSubmission: null,
        todayTrackingDate: '2026-10-18',
      });

      mockRepository.getFormDefinition.mockResolvedValue({
        formulario_id: 'seguimiento-domiciliario',
        version: '1.1.0',
        titulo: 'Seguimiento domiciliario',
        descripcion: 'Cuestionario diario',
        duracion_estimada_min: 5,
        preguntas: [],
      });

      await render(<DailyFollowUpScreen />);

      await waitFor(() => {
        expect(screen.getByText('Descartar borrador anterior')).toBeTruthy();
      });

      const btnDiscard = screen.getByText('Descartar borrador anterior');
      await fireEvent.press(btnDiscard);

      expect(alertSpy).toHaveBeenCalled();
      const alertCall = alertSpy.mock.calls[0];
      const buttons = alertCall[2];
      const discardBtn = buttons?.find((b: { text?: string }) => b.text === 'Descartar');
      expect(discardBtn).toBeTruthy();

      await act(async () => {
        await discardBtn?.onPress?.();
      });

      expect(mockRepository.discardDraft).toHaveBeenCalledWith(
        'seguimiento-domiciliario',
        '1.0.0',
        'dia:2026-10-17',
      );
    });

    it('presenta las etiquetas contextuales correctas y confirmación horaria para los tres estados del seguimiento', async () => {
      mockRepository.listAssignedForms.mockResolvedValue([
        {
          formulario_id: 'seguimiento-domiciliario',
          version: '1.1.0',
          titulo: 'Seguimiento domiciliario',
          descripcion: 'Cuestionario diario',
          estado_conocido: 'activa',
          periodicidad: 'daily',
        },
      ]);

      mockRepository.getFormDefinition.mockResolvedValue({
        formulario_id: 'seguimiento-domiciliario',
        version: '1.1.0',
        titulo: 'Seguimiento domiciliario',
        descripcion: 'Cuestionario diario',
        duracion_estimada_min: 5,
        preguntas: [],
      });

      // 1. Estado: Completado hoy
      mockRepository.getDailyFormStatus.mockResolvedValueOnce({
        hasSubmittedToday: true,
        hasActiveDraft: false,
        hasOlderDraft: false,
        activeDraft: null,
        olderDraft: null,
        lastSubmission: {
          id: 'sub-today-1',
          fecha_confirmacion: '2026-10-18T12:30:00Z',
        },
        todayTrackingDate: '2026-10-18',
      });

      const { unmount: unmount1 } = await render(<DailyFollowUpScreen />);

      const expectedTime = new Date('2026-10-18T12:30:00Z').toLocaleTimeString('es-CL', {
        hour: '2-digit',
        minute: '2-digit',
      });

      await waitFor(() => {
        expect(screen.getByText('Ver mis respuestas de hoy')).toBeTruthy();
        expect(screen.getByText('Registrar otra actualización')).toBeTruthy();
        expect(screen.getByText(`Registro de hoy guardado · ${expectedTime}`)).toBeTruthy();
      });

      await unmount1();

      // 2. Estado: Sin responder hoy (pendiente)
      mockRepository.getDailyFormStatus.mockResolvedValueOnce({
        hasSubmittedToday: false,
        hasActiveDraft: false,
        hasOlderDraft: false,
        activeDraft: null,
        olderDraft: null,
        lastSubmission: null,
        todayTrackingDate: '2026-10-18',
      });

      const { unmount: unmount2 } = await render(<DailyFollowUpScreen />);

      await waitFor(() => {
        expect(screen.getByText('Responder seguimiento de hoy')).toBeTruthy();
      });

      await unmount2();

      // 3. Estado: Borrador en curso
      mockRepository.getDailyFormStatus.mockResolvedValueOnce({
        hasSubmittedToday: false,
        hasActiveDraft: true,
        hasOlderDraft: false,
        activeDraft: {
          formulario_id: 'seguimiento-domiciliario',
          version: '1.1.0',
          periodo_clave: 'dia:2026-10-18',
          entrega_id: 'draft-active-1',
        },
        olderDraft: null,
        lastSubmission: null,
        todayTrackingDate: '2026-10-18',
      });

      const { unmount: unmount3 } = await render(<DailyFollowUpScreen />);

      await waitFor(() => {
        expect(screen.getByText('Continuar mi registro')).toBeTruthy();
      });

      await unmount3();
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

      const { unmount } = await render(<FormSectionScreen />);

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
      await fireEvent.press(optionSi);

      // Ahora Q_DETALLE_ANIMO debe aparecer dinámicamente
      await waitFor(() => {
        expect(screen.getByText('¿Qué actividad te ayudó a sentirte mejor?')).toBeTruthy();
      });

      // Avanzar a la sección 2
      const btnContinuar = screen.getByText('Continuar');
      await fireEvent.press(btnContinuar);

      // Debe anunciar "Sección 2 de 2" y mostrar Q_COMENTARIO con límite de 200 caracteres
      await waitFor(() => {
        expect(screen.getByText('Sección 2 de 2')).toBeTruthy();
        expect(screen.getByText('Comentario breve')).toBeTruthy();
      });

      expect(screen.getByText('0 de 200 caracteres')).toBeTruthy();
      await unmount();
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

      const { unmount } = await render(<FormSectionScreen />);

      await waitFor(() => {
        expect(screen.getByText('Sección 1 de 2')).toBeTruthy();
      });

      // Ambas preguntas están visibles
      expect(screen.getByText(/¿Te has sentido con buen ánimo hoy\?/)).toBeTruthy();
      expect(screen.getByText('¿Qué actividad te ayudó a sentirte mejor?')).toBeTruthy();

      // Cambiar la madre a "no"
      const optionNo = screen.getByLabelText('No');
      await fireEvent.press(optionNo);

      // Debe haber invocado Alert.alert solicitando confirmación
      expect(alertSpy).toHaveBeenCalledWith(
        'Cambiar respuesta',
        expect.stringContaining('Al cambiar esta respuesta se quitarán las respuestas'),
        expect.any(Array),
      );

      alertSpy.mockRestore();
      await unmount();
    });

    it('al fallar el guardado durante Guardar y salir, no navega fuera de la pantalla, conserva las respuestas y alerta del error', async () => {
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

      // Simular fallo en saveDailyDraft únicamente en este intento
      mockRepository.saveDailyDraft.mockRejectedValueOnce(new Error('Fallo simulado de disco'));

      const { unmount } = await render(<FormSectionScreen />);

      await waitFor(() => {
        expect(screen.getByText('Sección 1 de 2')).toBeTruthy();
      });

      // Responder una pregunta
      const optionSi = screen.getByLabelText('Sí');
      await fireEvent.press(optionSi);

      // Presionar "Guardar y salir"
      const btnGuardarSalir = screen.getByRole('button', { name: 'Pausar y seguir más tarde' });
      await fireEvent.press(btnGuardarSalir);

      // Esperar a que se procese el flush fallido
      await waitFor(() => {
        expect(alertSpy).toHaveBeenCalledWith(
          'Error al guardar',
          expect.stringContaining('No se pudieron guardar los cambios en el borrador'),
        );
      });

      // No debe haber navegado fuera de la pantalla
      expect(mockRouterReplace).not.toHaveBeenCalled();

      // La sección sigue visible
      expect(screen.getByText('Sección 1 de 2')).toBeTruthy();

      alertSpy.mockRestore();
      await unmount();
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

      const { unmount } = await render(<DailyFormReviewScreen />);

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
      await fireEvent.press(btnConfirmar);

      await waitFor(() => {
        expect(screen.getByText('Registro completado con éxito')).toBeTruthy();
        expect(screen.getByText('Guardado en este dispositivo · Pendiente de envío')).toBeTruthy();
      });

      await unmount();
    });
  });

  describe('MedicalFormSubmissionDetailScreen', () => {
    it('renderiza el detalle de la entrega con etiquetas comprensibles y sin identificadores técnicos', async () => {
      mockUseLocalSearchParams.mockReturnValue({ id: 'sub-test-123' });

      mockRepository.getSubmission.mockResolvedValue({
        id: 'sub-test-123',
        formulario_id: SAMPLE_DECOUPLED_FORM.formularioId,
        version: SAMPLE_DECOUPLED_FORM.version,
        titulo: SAMPLE_DECOUPLED_FORM.titulo,
        respuestas: {
          Q_ANIMO: 'si',
          Q_DETALLE_ANIMO: 'paseo',
        },
        fecha_confirmacion: '2026-10-18T14:30:00Z',
        fecha_seguimiento: '2026-10-18',
        zona_horaria: 'America/Santiago',
        ventana_desde: '2026-10-17T14:30:00Z',
        ventana_hasta: '2026-10-18T14:30:00Z',
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

      const { unmount } = await render(<MedicalFormSubmissionDetailScreen />);

      // Esperar a que pase el estado de carga y renderice el detalle
      await waitFor(() => {
        expect(screen.getByText(`Entrega: ${SAMPLE_DECOUPLED_FORM.titulo}`)).toBeTruthy();
      });

      expect(screen.getByText('Respuestas registradas')).toBeTruthy();
      expect(screen.getByText('¿Te has sentido con buen ánimo hoy?')).toBeTruthy();
      // Debe mostrar la etiqueta humana de la opción, no el valor slug 'si'
      expect(screen.getByText('Sí')).toBeTruthy();

      expect(screen.getByText('¿Qué actividad te ayudó a sentirte mejor?')).toBeTruthy();
      // Debe mostrar la etiqueta humana 'Caminar o tomar aire fresco' en vez de 'paseo'
      expect(screen.getByText('Caminar o tomar aire fresco')).toBeTruthy();

      // No debe exponer el UUID técnico ni el rótulo de Identificador local
      expect(screen.queryByText('sub-test-123')).toBeNull();
      expect(screen.queryByText('Identificador local')).toBeNull();

      // Versión en bloque informativo secundario
      expect(screen.getByText('Versión del cuestionario: 1.0.0')).toBeTruthy();

      await unmount();
    });
  });
});
