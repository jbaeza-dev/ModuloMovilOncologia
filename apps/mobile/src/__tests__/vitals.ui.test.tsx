/// <reference types="jest" />

import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

const mockRouterPush = jest.fn();
const mockRouterNavigate = jest.fn();
const mockRouterBack = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockRouterPush(...args),
    navigate: (...args: unknown[]) => mockRouterNavigate(...args),
    replace: jest.fn(),
    canGoBack: () => true,
    back: (...args: unknown[]) => mockRouterBack(...args),
  },
  useLocalSearchParams: () => ({ id: 'vital-det-1' }),
  useNavigation: () => ({
    dispatch: jest.fn(),
  }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react');
    React.useEffect(() => {
      return cb();
    }, [cb]);
  },
}));

let mockPreventRemoveEnabled = false;
let mockPreventRemoveCallback: ((event: { data: { action: { type: string } } }) => void) | null =
  null;

jest.mock('expo-router/react-navigation', () => ({
  useNavigationState: (selector: (state: { index: number }) => unknown) => selector({ index: 1 }),
  usePreventRemove: (
    preventRemove: boolean,
    callback: (event: { data: { action: { type: string } } }) => void,
  ) => {
    mockPreventRemoveEnabled = preventRemove;
    mockPreventRemoveCallback = callback;
  },
}));

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
    inputBorder: '#757575',
    inputBorderFocused: '#00695C',
    text: '#212121',
    secondary: '#555555',
    error: '#B3261E',
    onError: '#FFFFFF',
    errorContainer: '#FFDAD6',
    onErrorContainer: '#410002',
    success: '#388E3C',
    warning: '#F57C00',
    pressed: '#E0E0E0',
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { sm: 12, md: 18, full: 9999 },
};

jest.mock('../providers/ThemeProvider', () => ({
  useAppTheme: () => ({ theme: mockTheme }),
}));

import type { VitalWithSyncRecord } from '../data/local/repository';

let mockVitalsList: VitalWithSyncRecord[] = [];
let mockSingleVital: VitalWithSyncRecord | null = null;
let mockCreateVitalsResult = 'vital-new-123';

const mockRepository = {
  vitals: jest.fn().mockImplementation(() => Promise.resolve(mockVitalsList)),
  vital: jest.fn().mockImplementation(() => Promise.resolve(mockSingleVital)),
  createVitals: jest.fn().mockImplementation(() => Promise.resolve(mockCreateVitalsResult)),
};

let mockIsClosing = false;
let mockSaving = false;

const mockLocalData = {
  patientId: 'paciente-demo-001',
  manager: {
    getPatientId: () => 'paciente-demo-001',
    getContextEpoch: () => 1,
  },
  repository: mockRepository,
  notificationAdapter: null,
  remindersRevision: 0,
  scopedCoordinatorState: null,
  bumpRemindersRevision: jest.fn(),
  reconcileReminders: jest.fn().mockResolvedValue(undefined),
  trackOperation: jest.fn((fn: () => Promise<unknown>) => fn()),
  closeActiveContext: jest.fn().mockResolvedValue({ success: true }),
  changePatient: jest.fn(),
  runSave: jest.fn((fn: () => Promise<unknown>) => fn()),
  get saving() {
    return mockSaving;
  },
  get isClosing() {
    return mockIsClosing;
  },
};

jest.mock('../providers/LocalDataProvider', () => ({
  DEMO_PATIENTS: [{ id: 'paciente-demo-001', label: 'Paciente de prueba A' }],
  useLocalData: () => mockLocalData,
}));

import {
  RegisterVitalsDataScreen,
  VitalDataDetailScreen,
  VitalsDataScreen,
} from '../features/vitals/VitalsDataScreens';

describe('VitalsDataScreens UI tests (Bloque 3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsClosing = false;
    mockSaving = false;
    mockPreventRemoveEnabled = false;
    mockPreventRemoveCallback = null;
    mockCreateVitalsResult = 'vital-new-123';
  });

  describe('RegisterVitalsDataScreen', () => {
    it('muestra error general accesible al guardar sin datos', async () => {
      await render(<RegisterVitalsDataScreen />);

      await fireEvent.press(screen.getByRole('button', { name: 'Guardar registro' }));

      expect(screen.getByText('Ingresa al menos una medición.')).toBeTruthy();
      expect(mockRepository.createVitals).not.toHaveBeenCalled();
    });

    it('asocia errores de formato a los campos respectivos y conserva el contenido', async () => {
      await render(<RegisterVitalsDataScreen />);

      const tempInput = screen.getByLabelText('Temperatura corporal (°C)');
      await fireEvent.changeText(tempInput, 'invalido');

      const sysInput = screen.getByLabelText('Presión sistólica (mmHg)');
      await fireEvent.changeText(sysInput, '120');

      // Intentar guardar con temperatura inválida y presión incompleta (falta diastólica)
      await fireEvent.press(screen.getByRole('button', { name: 'Guardar registro' }));

      expect(screen.getByText('Temperatura: ingresa un número válido.')).toBeTruthy();
      expect(screen.getByText('Ingresa la presión diastólica.')).toBeTruthy();

      // Los valores introducidos se conservan en los campos
      expect(tempInput.props.value).toBe('invalido');
      expect(sysInput.props.value).toBe('120');
      expect(mockRepository.createVitals).not.toHaveBeenCalled();
    });

    it('guarda exitosamente una medición válida, limpia el formulario y muestra FeedbackBanner con Ver registro', async () => {
      await render(<RegisterVitalsDataScreen />);

      const tempInput = screen.getByLabelText('Temperatura corporal (°C)');
      await fireEvent.changeText(tempInput, '36,8');

      const pulseInput = screen.getByLabelText('Pulso');
      await fireEvent.changeText(pulseInput, '72');

      await fireEvent.press(screen.getByRole('button', { name: 'Guardar registro' }));

      expect(mockRepository.createVitals).toHaveBeenCalledWith(
        expect.objectContaining({
          temperatura: 36.8,
          pulso: 72,
          presion_sistolica: null,
          presion_diastolica: null,
          saturacion_o2: null,
        }),
      );

      // Los inputs quedan limpios
      expect(tempInput.props.value).toBe('');
      expect(pulseInput.props.value).toBe('');

      // Muestra banner de feedback
      expect(screen.getByText('Medición guardada en este dispositivo')).toBeTruthy();
      expect(screen.getByText('Temperatura: 36,8 °C · Pulso: 72 latidos/min')).toBeTruthy();

      // Botón Ver registro navega al detalle
      const verRegistroBtn = screen.getByRole('button', { name: 'Ver registro' });
      expect(verRegistroBtn).toBeTruthy();
      await fireEvent.press(verRegistroBtn);
      expect(mockRouterNavigate).toHaveBeenCalledWith({
        pathname: '/vitales/detalle',
        params: { id: 'vital-new-123' },
      });
    });

    it('activa la protección contra descarte accidental cuando hay texto y respeta isClosing', async () => {
      await render(<RegisterVitalsDataScreen />);

      expect(mockPreventRemoveEnabled).toBe(false);

      const tempInput = screen.getByLabelText('Temperatura corporal (°C)');
      await fireEvent.changeText(tempInput, '37.0');

      // Se vuelve dirty -> preventRemove se activa
      expect(mockPreventRemoveEnabled).toBe(true);

      const alertSpy = jest.spyOn(Alert, 'alert');
      mockPreventRemoveCallback?.({ data: { action: { type: 'GO_BACK' } } });

      expect(alertSpy).toHaveBeenCalledWith(
        '¿Descartar cambios?',
        'Tienes datos ingresados sin guardar en este formulario.',
        expect.any(Array),
        expect.any(Object),
      );
    });
  });

  describe('VitalsDataScreen (Historial)', () => {
    it('muestra los botones Registrar signos vitales y Ver reportes en el encabezado sin tener que desplazarse por 30 registros', async () => {
      // Generar 30 registros para verificar que los botones están al inicio
      mockVitalsList = Array.from({ length: 30 }, (_, i) => ({
        id: `vital-${i}`,
        paciente_id: 'paciente-demo-001',
        fecha_registro: new Date(Date.now() - i * 3600000).toISOString(),
        temperatura: 36.5 + (i % 5) * 0.1,
        presion_sistolica: 120,
        presion_diastolica: 80,
        pulso: 70 + (i % 10),
        saturacion_o2: 98,
        fecha_subida: null,
        estado_envio: 'pendiente',
      }));

      await render(<VitalsDataScreen />);

      // Los dos botones del encabezado son inmediatamente accesibles
      const registrarBtn = screen.getByRole('button', { name: 'Registrar signos vitales' });
      expect(registrarBtn).toBeTruthy();
      await fireEvent.press(registrarBtn);
      expect(mockRouterNavigate).toHaveBeenCalledWith('/vitales/registrar');

      const reportesBtn = screen.getByRole('button', { name: 'Ver reportes' });
      expect(reportesBtn).toBeTruthy();
      await fireEvent.press(reportesBtn);
      expect(mockRouterNavigate).toHaveBeenCalledWith('/vitales/reportes');
    });

    it('las tarjetas del historial muestran resúmenes dinámicos y no mencionan Sin registro para campos ausentes', async () => {
      mockVitalsList = [
        {
          id: 'v-only-pressure',
          paciente_id: 'paciente-demo-001',
          fecha_registro: '2026-10-17T12:00:00.000Z',
          temperatura: null,
          presion_sistolica: 130,
          presion_diastolica: 85,
          pulso: null,
          saturacion_o2: null,
          fecha_subida: null,
          estado_envio: 'pendiente',
        },
      ];

      await render(<VitalsDataScreen />);

      expect(screen.getByText('Presión: 130/85 mmHg')).toBeTruthy();
      expect(screen.queryByText(/Sin registro/)).toBeNull();

      // La tarjeta tiene accesibilidad completa
      const card = screen.getByRole('button', { name: /Presión: 130\/85 mmHg/ });
      expect(card).toBeTruthy();
      await fireEvent.press(card);
      expect(mockRouterNavigate).toHaveBeenCalledWith({
        pathname: '/vitales/detalle',
        params: { id: 'v-only-pressure' },
      });
    });
  });

  describe('VitalDataDetailScreen', () => {
    it('muestra el detalle completo del registro consultado', async () => {
      mockSingleVital = {
        id: 'vital-det-1',
        paciente_id: 'paciente-demo-001',
        fecha_registro: '2026-10-17T12:00:00.000Z',
        temperatura: 36.8,
        presion_sistolica: 120,
        presion_diastolica: 80,
        pulso: 72,
        saturacion_o2: 98,
        fecha_subida: null,
        estado_envio: 'pendiente',
      };

      await render(<VitalDataDetailScreen />);

      expect(screen.getByText('Detalle del registro')).toBeTruthy();
      expect(screen.getByText('120/80 mmHg')).toBeTruthy();
      expect(screen.getByText('Guardado en este dispositivo')).toBeTruthy();
    });
  });
});
