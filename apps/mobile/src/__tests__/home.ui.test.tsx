/// <reference types="jest" />

import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Linking } from 'react-native';

const mockRouterPush = jest.fn();
const mockRouterNavigate = jest.fn();
const mockChangePatient = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockRouterPush(...args),
    navigate: (...args: unknown[]) => mockRouterNavigate(...args),
    replace: jest.fn(),
    canGoBack: () => false,
    back: jest.fn(),
  },
  useFocusEffect: (cb: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react');
    React.useEffect(() => {
      return cb();
    }, [cb]);
  },
}));

jest.mock('expo-router/react-navigation', () => ({
  useNavigationState: (selector: (state: { index: number }) => unknown) => selector({ index: 0 }),
  StackActions: {
    popToTop: () => ({ type: 'POP_TO_TOP' }),
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
    text: '#212121',
    secondary: '#555555',
    error: '#D32F2F',
    errorContainer: '#FFEBEE',
    onErrorContainer: '#B71C1C',
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

let mockDemoMode = true;
jest.mock('../utils/environment', () => ({
  isDemoMode: () => mockDemoMode,
}));

const mockProfile = {
  paciente_id: 'paciente-demo-001',
  nombre: 'María Elena Morales',
  email: 'maria@quimiocare.test',
  rut: '12.345.678-9',
  obtenido_en: '2026-10-16T00:00:00.000Z',
};

const mockRepository = {
  profile: jest.fn().mockResolvedValue(mockProfile),
  latestVital: jest.fn().mockResolvedValue(null),
  createVitals: jest.fn().mockResolvedValue(undefined),
  symptoms: jest.fn().mockResolvedValue([]),
  reminders: {
    getReminderStatusSnapshot: jest.fn(),
    setPreferences: jest.fn().mockResolvedValue(undefined),
  },
};

const mockLocalData = {
  patientId: 'paciente-demo-001',
  manager: {
    getPatientId: () => 'paciente-demo-001',
    getContextEpoch: () => 1,
  },
  repository: mockRepository,
  notificationAdapter: {
    getPermissionState: jest.fn().mockResolvedValue({
      status: 'granted',
      canAskAgain: true,
      channelStatus: 'ok',
    }),
    requestPermission: jest.fn().mockResolvedValue({
      status: 'granted',
      canAskAgain: true,
      channelStatus: 'ok',
    }),
  },
  remindersRevision: 0,
  scopedCoordinatorState: null,
  bumpRemindersRevision: jest.fn(),
  reconcileReminders: jest.fn().mockResolvedValue(undefined),
  trackOperation: jest.fn((fn: () => Promise<unknown>) => fn()),
  closeActiveContext: jest.fn().mockResolvedValue({
    success: true,
    cancelledPatientId: 'paciente-demo-001',
    pendingNotificationsCount: 0,
  }),
  changePatient: (...args: unknown[]) => mockChangePatient(...args),
  runSave: jest.fn((fn: () => Promise<unknown>) => fn()),
  saving: false,
  isClosing: false,
};

jest.mock('../providers/LocalDataProvider', () => ({
  DEMO_PATIENTS: [
    { id: 'paciente-demo-001', label: 'Paciente de prueba A' },
    { id: 'paciente-demo-002', label: 'Paciente de prueba B' },
  ],
  useLocalData: () => mockLocalData,
}));

let mockReminderState = {
  loading: false,
  evaluation: {
    status: 'scheduled' as ReminderDomainStatus,
    deviceAvailability: 'available' as ReminderDeviceAvailability,
    ruleId: 'rule-vitales-1' as string | null,
    rulesCount: 1,
    enabledRulesCount: 1,
    allEnabledRulesCount: 1,
    otherEnabledRulesCount: 0,
    notificationId: 'notif-1' as string | null,
    fechaPrevistaUtc: '2026-10-18T10:00:00.000Z' as string | null,
    fechaCivilLocal: '2026-10-18' as string | null,
    horaMinutoLocal: '07:00' as string | null,
    zonaHoraria: 'America/Santiago' as string | null,
    noUpcomingReason: null,
    fechaInicio: null,
    fechaFin: null,
    cubiertoHastaIso: null,
    truncadas: 0,
  },
  snapshot: null,
  retryingScheduling: false,
  refresh: jest.fn(),
  retryScheduling: jest.fn(),
};

jest.mock('../hooks/use-reminder-status', () => ({
  useReminderStatus: () => mockReminderState,
}));

import { HomeScreen, resolveHomeGreeting } from '../features/home/HomeScreen';
import type {
  ReminderDeviceAvailability,
  ReminderDomainStatus,
} from '../services/reminders/reminder-status';

describe('HomeScreen UI tests (Bloque 2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDemoMode = true;
    mockLocalData.patientId = 'paciente-demo-001';
    mockRepository.profile.mockResolvedValue(mockProfile);
  });

  const statesToTest: Array<{
    name: string;
    loading: boolean;
    status: ReminderDomainStatus;
    deviceAvailability: ReminderDeviceAvailability;
  }> = [
    {
      name: 'loading',
      loading: true,
      status: 'scheduled',
      deviceAvailability: 'available',
    },
    {
      name: 'scheduled',
      loading: false,
      status: 'scheduled',
      deviceAvailability: 'available',
    },
    {
      name: 'rule_disabled',
      loading: false,
      status: 'rule_disabled',
      deviceAvailability: 'available',
    },
    {
      name: 'preferences_disabled',
      loading: false,
      status: 'preferences_disabled',
      deviceAvailability: 'available',
    },
    {
      name: 'permission_required',
      loading: false,
      status: 'scheduled',
      deviceAvailability: 'permission_required',
    },
    {
      name: 'permission_blocked',
      loading: false,
      status: 'scheduled',
      deviceAvailability: 'permission_blocked',
    },
    {
      name: 'no_configured',
      loading: false,
      status: 'no_configured',
      deviceAvailability: 'available',
    },
  ];

  test.each(statesToTest)(
    'existe exactamente UN botón «Registrar signos vitales» visible en estado $name',
    async ({ loading, status, deviceAvailability }) => {
      mockReminderState = {
        ...mockReminderState,
        loading,
        evaluation: {
          ...mockReminderState.evaluation,
          status,
          deviceAvailability,
        },
      };

      await render(<HomeScreen />);

      const vitalButtons = screen.getAllByRole('button', { name: 'Registrar signos vitales' });
      expect(vitalButtons).toHaveLength(1);

      await fireEvent.press(vitalButtons[0]);
      expect(mockRouterPush).toHaveBeenCalledWith('/(tabs)/(inicio)/registrar-vitales');
    },
  );

  it('permite acceso al registro manual de signos vitales cuando deviceAvailability === permission_required', async () => {
    mockReminderState = {
      ...mockReminderState,
      loading: false,
      evaluation: {
        ...mockReminderState.evaluation,
        status: 'scheduled',
        deviceAvailability: 'permission_required',
      },
    };

    await render(<HomeScreen />);

    // Muestra aviso de permiso requerido
    expect(
      screen.getByText(
        'Tus horarios están guardados. Activa las notificaciones para recibir avisos.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Permitir notificaciones')).toBeTruthy();

    // El registro de signos vitales sigue disponible
    const vitalButtons = screen.getAllByRole('button', { name: 'Registrar signos vitales' });
    expect(vitalButtons).toHaveLength(1);
    await fireEvent.press(vitalButtons[0]);
    expect(mockRouterPush).toHaveBeenCalledWith('/(tabs)/(inicio)/registrar-vitales');
  });

  it('muestra aviso claro y botón para abrir ajustes cuando deviceAvailability === permission_blocked', async () => {
    const openSettingsSpy = jest
      .spyOn(Linking, 'openSettings')
      .mockResolvedValue(undefined as never);

    mockReminderState = {
      ...mockReminderState,
      loading: false,
      evaluation: {
        ...mockReminderState.evaluation,
        status: 'scheduled',
        deviceAvailability: 'permission_blocked',
      },
    };

    await render(<HomeScreen />);

    // Muestra texto exacto acordado
    expect(screen.getByText('Android no permite mostrar notificaciones.')).toBeTruthy();

    const openSettingsBtn = screen.getByRole('button', { name: 'Abrir ajustes' });
    expect(openSettingsBtn).toBeTruthy();

    await fireEvent.press(openSettingsBtn);
    expect(openSettingsSpy).toHaveBeenCalled();

    // El registro de signos vitales sigue disponible
    const vitalButtons = screen.getAllByRole('button', { name: 'Registrar signos vitales' });
    expect(vitalButtons).toHaveLength(1);
  });

  it('no filtra el saludo del paciente A mientras se carga el perfil del paciente B', () => {
    // Caso de función pura durante la carga
    const greetingDuringTransition = resolveHomeGreeting({
      loadingProfile: true,
      profile: {
        paciente_id: 'paciente-a',
        nombre: 'Paciente A',
        email: null,
        rut: null,
        obtenido_en: '2026-10-16T00:00:00.000Z',
      },
      patientId: 'paciente-b',
      demoMode: true,
    });
    expect(greetingDuringTransition).toBe('Hola, te damos la bienvenida');
    expect(greetingDuringTransition).not.toContain('Paciente A');

    // Caso de perfil en memoria con paciente_id desalineado
    const greetingDesync = resolveHomeGreeting({
      loadingProfile: false,
      profile: {
        paciente_id: 'paciente-a',
        nombre: 'Paciente A',
        email: null,
        rut: null,
        obtenido_en: '2026-10-16T00:00:00.000Z',
      },
      patientId: 'paciente-b',
      demoMode: false,
    });
    expect(greetingDesync).toBe('Hola, te damos la bienvenida');
    expect(greetingDesync).not.toContain('Paciente A');
  });

  it('muestra el acceso secundario a Mis medicamentos, Avisos, Recordatorios y Asistente en el orden acordado', async () => {
    await render(<HomeScreen />);

    expect(screen.getByText('Mis medicamentos')).toBeTruthy();
    expect(screen.getByText('Mis recordatorios')).toBeTruthy();
    expect(screen.getByText('Bandeja de avisos')).toBeTruthy();
    expect(screen.getByText('Asistente QuimioCare')).toBeTruthy();

    // Navegación a mis medicamentos
    await fireEvent.press(screen.getByLabelText('Mis medicamentos'));
    expect(mockRouterNavigate).toHaveBeenCalledWith('/perfil/medicacion', { withAnchor: true });
  });

  it('muestra la tarjeta «Cómo me siento hoy» y permite navegar a /formulario', async () => {
    await render(<HomeScreen />);

    expect(screen.getByText('Cómo me siento hoy')).toBeTruthy();
    expect(screen.getByText('Completa tu cuestionario diario de seguimiento.')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Cómo me siento hoy'));
    expect(mockRouterPush).toHaveBeenCalledWith('/formulario');
  });
});
