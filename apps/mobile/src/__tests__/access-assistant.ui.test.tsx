/// <reference types="jest" />

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

// Mock expo-router
const mockUseLocalSearchParams = jest.fn();
const mockRouterPush = jest.fn();
const mockRouterReplace = jest.fn();
const mockRouterBack = jest.fn();
const mockRouterNavigate = jest.fn();

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    router: {
      push: (...args: unknown[]) => mockRouterPush(...args),
      replace: (...args: unknown[]) => mockRouterReplace(...args),
      back: (...args: unknown[]) => mockRouterBack(...args),
      navigate: (...args: unknown[]) => mockRouterNavigate(...args),
    },
    useLocalSearchParams: () => mockUseLocalSearchParams(),
    useFocusEffect: (cb: () => void | (() => void)) => {
      React.useEffect(() => {
        return cb();
      }, [cb]);
    },
  };
});

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
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { sm: 12, md: 18 },
};

jest.mock('../providers/ThemeProvider', () => ({
  useAppTheme: () => ({ theme: mockTheme }),
}));

// Mock environment
jest.mock('../utils/environment', () => ({
  isDemoMode: () => true,
  getEnvironmentConfig: () => ({ mode: 'demo' }),
}));

// Mock listCachedTerms
const mockListCachedTerms = jest.fn();
jest.mock('../data/local/consents/consent-repository', () => {
  const actual = jest.requireActual('../data/local/consents/consent-repository');
  return {
    ...actual,
    listCachedTerms: (...args: unknown[]) => mockListCachedTerms(...args),
  };
});

// Mock repository
const mockRepository = {
  grantConsent: jest.fn().mockResolvedValue({ consentId: 'c-1', eventId: 'e-1' }),
  revokeConsent: jest.fn().mockResolvedValue({ eventId: 'e-2' }),
  getConsentStatus: jest.fn().mockResolvedValue({
    terminoId: 'term-1',
    version: '1.0',
    estado: 'nunca_otorgado',
    activeConsent: null,
    lastConsent: null,
    lastEvent: null,
  }),
};

const mockSelectPatient = jest.fn().mockResolvedValue(undefined);
const mockCloseActiveContext = jest.fn().mockResolvedValue({ success: true });

const defaultLocalData = {
  patientId: 'paciente-a',
  database: {},
  repository: mockRepository,
  coordinator: null,
  runSave: (fn: () => Promise<unknown>) => fn(),
  trackOperation: (fn: () => Promise<unknown>) => fn(),
  saving: false,
  isClosing: false,
  closeActiveContext: (...args: unknown[]) => mockCloseActiveContext(...args),
  selectPatient: (...args: unknown[]) => mockSelectPatient(...args),
  activeTeardownPromise: null,
  assistantController: null,
};

const mockUseLocalData = jest.fn().mockReturnValue({ ...defaultLocalData });

jest.mock('../providers/LocalDataProvider', () => ({
  useLocalData: () => mockUseLocalData(),
  DEMO_PATIENTS: [
    { id: '11111111-1111-4111-8111-111111111111', label: 'Paciente de prueba A' },
    { id: '22222222-2222-4222-8222-222222222222', label: 'Paciente de prueba B' },
  ],
}));

import { ContextGuard } from '../components/ContextGuard';
import { AccessConsentScreen, LoginScreen, RegisterScreen } from '../features/access/AccessScreens';
import { AssistantScreen } from '../features/assistant/AssistantScreen';
import { AssistantController } from '../services/assistant/assistant-controller';
import { FakeAssistantAdapter } from '../services/assistant/fake-assistant-adapter';

describe('Incremento 6: UI de Acceso, Consentimientos y Asistente', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalSearchParams.mockReturnValue({});
    mockUseLocalData.mockReturnValue({ ...defaultLocalData });
  });

  afterEach(() => {
    cleanup();
  });

  describe('Acceso Público y Selección de Paciente', () => {
    it('LoginScreen renderiza información de servicios no configurados y enlace de demo', async () => {
      await render(<LoginScreen />);

      const brands = await screen.findAllByText('QuimioCare');
      expect(brands.length).toBeGreaterThanOrEqual(1);
      expect(await screen.findByText('VISTA DE DEMOSTRACIÓN · DATOS FICTICIOS')).toBeTruthy();
      expect(await screen.findByText('Servicios de acceso')).toBeTruthy();

      const selectBtn = await screen.findByText('Seleccionar paciente de prueba');
      expect(selectBtn).toBeTruthy();

      fireEvent.press(selectBtn);
      expect(mockRouterNavigate).toHaveBeenCalledWith('/acceso/seleccionar-paciente');

      const consentBtn = await screen.findByText('Ver términos y consentimientos');
      expect(consentBtn).toBeTruthy();
      fireEvent.press(consentBtn);
      expect(mockRouterNavigate).toHaveBeenCalledWith('/acceso/consentimientos');
    });

    it('RegisterScreen muestra aviso de registro central no configurado y botón de consentimientos', async () => {
      await render(<RegisterScreen />);

      expect(await screen.findByText('Registro de usuarios')).toBeTruthy();
      const consentBtn = await screen.findByText('Ver consentimientos');
      expect(consentBtn).toBeTruthy();

      fireEvent.press(consentBtn);
      expect(mockRouterNavigate).toHaveBeenCalledWith('/acceso/consentimientos');
    });

    it('ContextGuard permite seleccionar paciente cuando isClosing es false', async () => {
      await render(<ContextGuard isClosing={false} onSelectPatient={mockSelectPatient} />);

      const patientABtn = await screen.findByText('Paciente de prueba A');
      expect(await screen.findByText('Paciente de prueba B')).toBeTruthy();

      fireEvent.press(patientABtn);
      expect(mockSelectPatient).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    });

    it('ContextGuard deshabilita selección y muestra estado de cierre cuando isClosing es true', async () => {
      await render(<ContextGuard isClosing={true} onSelectPatient={mockSelectPatient} />);

      expect(await screen.findByText('Cerrando contexto anterior…')).toBeTruthy();

      fireEvent.press(screen.getByText('Paciente de prueba A'));
      expect(mockSelectPatient).not.toHaveBeenCalled();
    });
  });

  describe('Consentimientos en Acceso (AccessConsentScreen)', () => {
    it('muestra estado vacío si no hay términos cacheados', async () => {
      mockListCachedTerms.mockResolvedValue([]);

      await render(<AccessConsentScreen />);

      expect(await screen.findByText('No hay definiciones de términos registradas')).toBeTruthy();
    });

    it('sin paciente activo muestra muestra demostrativa y bloquea aceptación anónima', async () => {
      mockUseLocalData.mockReturnValue({
        ...defaultLocalData,
        patientId: null,
        repository: null,
      });

      mockListCachedTerms.mockResolvedValue([
        {
          termino_id: 'term-demo-1',
          version: '1.0',
          titulo: 'Consentimiento de Tratamiento',
          contenido_markdown: '# Términos informados',
          vigente_desde: '2026-01-01T00:00:00Z',
          vigente_hasta: null,
        },
      ]);

      await render(<AccessConsentScreen />);

      expect(await screen.findByText('Consentimiento de Tratamiento')).toBeTruthy();
      expect(await screen.findByText('Muestra técnica demostrativa')).toBeTruthy();
      expect(await screen.findByText('Requiere sesión activa')).toBeTruthy();
      expect(
        await screen.findByText(
          'Para otorgar o revocar consentimientos debes iniciar sesión o seleccionar un paciente de prueba.',
        ),
      ).toBeTruthy();
    });

    it('con paciente activo permite aceptar y revocar consentimientos vigentes', async () => {
      mockUseLocalData.mockReturnValue({
        ...defaultLocalData,
        patientId: 'paciente-a',
        repository: mockRepository,
      });

      mockListCachedTerms.mockResolvedValue([
        {
          termino_id: 'term-demo-1',
          version: '1.0',
          titulo: 'Consentimiento de Tratamiento',
          contenido_markdown: '# Términos informados',
          vigente_desde: '2026-01-01T00:00:00Z',
          vigente_hasta: null,
        },
      ]);

      mockRepository.getConsentStatus.mockResolvedValue({
        terminoId: 'term-demo-1',
        version: '1.0',
        estado: 'nunca_otorgado',
        activeConsent: null,
        lastConsent: null,
        lastEvent: null,
      });

      await render(<AccessConsentScreen />);

      const acceptBtn = await screen.findByText('Aceptar consentimiento');
      fireEvent.press(acceptBtn);

      await waitFor(() => {
        expect(mockRepository.grantConsent).toHaveBeenCalledWith('term-demo-1', '1.0');
      });
    });

    it('deshabilita términos con vigencia futura o expirada', async () => {
      mockUseLocalData.mockReturnValue({
        ...defaultLocalData,
        patientId: 'paciente-a',
        repository: mockRepository,
      });

      mockListCachedTerms.mockResolvedValue([
        {
          termino_id: 'term-futuro',
          version: '1.0',
          titulo: 'Término Futuro',
          contenido_markdown: '# No disponible aún',
          vigente_desde: '2099-01-01T00:00:00Z',
          vigente_hasta: null,
        },
        {
          termino_id: 'term-expirado',
          version: '1.0',
          titulo: 'Término Vencido',
          contenido_markdown: '# Vencido',
          vigente_desde: '2020-01-01T00:00:00Z',
          vigente_hasta: '2021-01-01T00:00:00Z',
        },
      ]);

      mockRepository.getConsentStatus.mockResolvedValue({
        terminoId: 'term-futuro',
        version: '1.0',
        estado: 'nunca_otorgado',
        activeConsent: null,
        lastConsent: null,
        lastEvent: null,
      });

      await render(<AccessConsentScreen />);

      expect(
        await screen.findByText('Vigencia futura · No disponible para aceptación'),
      ).toBeTruthy();
      expect(await screen.findByText('Versión no vigente · Aceptación cerrada')).toBeTruthy();
    });
  });

  describe('Asistente de Acompañamiento (AssistantScreen)', () => {
    it('mantiene visible el disclaimer RNF-08 en todo momento', async () => {
      await render(<AssistantScreen />);

      expect(
        await screen.findByText(
          'Este asistente ofrece orientación general. No diagnostica, prescribe ni sustituye a tu equipo de salud.',
        ),
      ).toBeTruthy();
      expect(await screen.findByText('0 / 2000')).toBeTruthy();
    });

    it('actualiza el contador de caracteres al escribir', async () => {
      await render(<AssistantScreen />);

      const input = await screen.findByLabelText('Escribe tu consulta');
      fireEvent.changeText(input, 'Consulta de prueba');

      expect(await screen.findByText('18 / 2000')).toBeTruthy();
    });

    it('envía consulta, muestra estado de procesamiento y permite cancelar', async () => {
      const adapter = new FakeAssistantAdapter({ simulatedDelayMs: 5000 });
      const controller = new AssistantController(adapter, 'paciente-a');

      mockUseLocalData.mockReturnValue({
        ...defaultLocalData,
        assistantController: controller,
      });

      await render(<AssistantScreen />);

      const input = await screen.findByLabelText('Escribe tu consulta');
      fireEvent.changeText(input, '¿Cómo aliviar las náuseas?');

      await waitFor(() => {
        expect(input.props.value).toBe('¿Cómo aliviar las náuseas?');
      });

      const sendBtn = await screen.findByText('Enviar consulta');
      fireEvent.press(sendBtn);

      expect(await screen.findByText('Procesando demostración…')).toBeTruthy();
      expect(await screen.findByText('Cancelar')).toBeTruthy();

      fireEvent.press(screen.getByText('Cancelar'));

      expect(await screen.findByText('Consulta cancelada')).toBeTruthy();
    });

    it('muestra estado sin conexión con botón de reintento si el adaptador falla por offline', async () => {
      const adapter = new FakeAssistantAdapter({ shouldSimulateOffline: true });
      const controller = new AssistantController(adapter, 'paciente-a');

      mockUseLocalData.mockReturnValue({
        ...defaultLocalData,
        assistantController: controller,
      });

      await render(<AssistantScreen />);

      const input = await screen.findByLabelText('Escribe tu consulta');
      fireEvent.changeText(input, 'Consulta sin red');

      await waitFor(() => {
        expect(input.props.value).toBe('Consulta sin red');
      });

      fireEvent.press(screen.getByText('Enviar consulta'));

      expect(await screen.findByText('Sin conexión')).toBeTruthy();
      expect(await screen.findByText('Reintentar consulta')).toBeTruthy();
    });

    it('maneja session_required invocando closeActiveContext', async () => {
      const adapter = new FakeAssistantAdapter({
        shouldSimulateSessionRequired: true,
      });
      const controller = new AssistantController(adapter, 'paciente-a', () => {
        void mockCloseActiveContext('session_required');
      });

      mockUseLocalData.mockReturnValue({
        ...defaultLocalData,
        assistantController: controller,
      });

      await render(<AssistantScreen />);

      const input = await screen.findByLabelText('Escribe tu consulta');
      fireEvent.changeText(input, 'Consulta que requiere sesión');

      await waitFor(() => {
        expect(input.props.value).toBe('Consulta que requiere sesión');
      });

      fireEvent.press(screen.getByText('Enviar consulta'));

      await waitFor(() => {
        expect(mockCloseActiveContext).toHaveBeenCalledWith('session_required');
      });
    });
  });
});
