/// <reference types="jest" />

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

// Mock expo-router
const mockUseLocalSearchParams = jest.fn();
const mockRouterPush = jest.fn();
const mockRouterBack = jest.fn();

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    router: {
      push: (...args: unknown[]) => mockRouterPush(...args),
      replace: jest.fn(),
      back: (...args: unknown[]) => mockRouterBack(...args),
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
  radius: { sm: 12, md: 18, full: 9999 },
};

jest.mock('../providers/ThemeProvider', () => ({
  useAppTheme: () => ({ theme: mockTheme }),
}));

// Mock adapter
const mockAdapter = {
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
  listScheduled: jest.fn().mockResolvedValue([]),
  schedule: jest.fn().mockResolvedValue({ nativeId: 'mock-native-id' }),
  cancel: jest.fn().mockResolvedValue(undefined),
};

jest.mock('../services/notifications/expo-notification-adapter', () => ({
  ExpoNotificationAdapter: jest.fn().mockImplementation(() => mockAdapter),
}));

// Mock coordinator
const mockCoordinatorReconcile = jest.fn().mockResolvedValue({
  status: 'programada',
  totalDeseadas: 2,
  programadasConfirmadas: 2,
  cubiertoHastaIso: '2026-10-27T00:00:00Z',
  truncadas: 0,
  reglasAfectadas: 1,
  incidencias: [],
  permission: { status: 'granted', canAskAgain: true, channelStatus: 'ok' },
});

jest.mock('../services/reminders/notification-coordinator', () => ({
  NotificationCoordinator: jest.fn().mockImplementation(() => ({
    reconcile: (...args: unknown[]) => mockCoordinatorReconcile(...args),
  })),
}));

// Mock repository
const mockReminderRepo = {
  getPreferences: jest.fn().mockResolvedValue({ enabled: true, updatedAt: '2026-10-13T10:00:00Z' }),
  setPreferences: jest.fn().mockResolvedValue(undefined),
  listRules: jest.fn().mockResolvedValue([]),
  getRule: jest.fn().mockResolvedValue(null),
  saveRule: jest.fn().mockResolvedValue({ id: 'rule-1' }),
  toggleRuleEnabled: jest.fn().mockResolvedValue({ id: 'rule-1', habilitado: false }),
  deleteRule: jest.fn().mockResolvedValue(undefined),
  listNotifications: jest.fn().mockResolvedValue([]),
  getNotification: jest.fn().mockResolvedValue(null),
};

const mockRepository = {
  reminders: mockReminderRepo,
  activeMedications: jest.fn().mockResolvedValue([{ id: 'med-1', nombre: 'Ciclofosfamida 500mg' }]),
};

const mockDatabase = {
  all: jest.fn().mockResolvedValue([]),
  first: jest.fn().mockResolvedValue(null),
  run: jest.fn().mockResolvedValue({ changes: 1 }),
  transaction: jest
    .fn()
    .mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(mockDatabase)),
};

const mockCoordinator = {
  reconcile: jest
    .fn()
    .mockImplementation((...args: unknown[]) => mockCoordinatorReconcile(...args)),
  cancelPatientSchedule: jest.fn().mockResolvedValue(undefined),
};

const mockReconcileReminders = jest
  .fn()
  .mockImplementation((...args: unknown[]) => mockCoordinatorReconcile(...args));

const mockUseLocalData = jest.fn().mockReturnValue({
  patientId: 'paciente-a',
  database: mockDatabase,
  repository: mockRepository,
  coordinator: mockCoordinator,
  reconcileReminders: (...args: unknown[]) => mockReconcileReminders(...args),
  runSave: (fn: () => Promise<unknown>) => fn(),
  saving: false,
});

jest.mock('../providers/LocalDataProvider', () => ({
  useLocalData: () => mockUseLocalData(),
}));

import { NoticesTrayScreen } from '../features/reminders/NoticesTrayScreen';
import { ReminderEditScreen } from '../features/reminders/ReminderEditScreen';
import { RemindersListScreen } from '../features/reminders/RemindersListScreen';

describe('Incremento 5: UI de Recordatorios y Avisos Locales', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalSearchParams.mockReturnValue({});
  });

  describe('RemindersListScreen', () => {
    it('muestra el estado vacío cuando el paciente no tiene recordatorios registrados', async () => {
      mockReminderRepo.listRules.mockResolvedValueOnce([]);

      await render(<RemindersListScreen />);

      await waitFor(() => {
        expect(screen.getByText('Sin recordatorios configurados')).toBeTruthy();
      });
      expect(
        screen.getByText(
          'Crea recordatorios para el registro de signos vitales o la consulta de medicamentos.',
        ),
      ).toBeTruthy();
    });

    it('muestra las reglas activas de signos vitales y medicación', async () => {
      mockReminderRepo.listRules.mockResolvedValueOnce([
        {
          id: 'rule-vitales',
          pacienteId: 'paciente-a',
          tipo: 'registro_vitales',
          medicamentoId: null,
          diasSemana: [1, 2, 3, 4, 5, 6, 7],
          horasMinutos: ['09:00', '21:00'],
          zonaHoraria: 'America/Santiago',
          fechaInicio: null,
          fechaFin: null,
          habilitado: true,
          revision: 1,
          creadoEl: '2026-10-13T10:00:00Z',
          actualizadoEl: '2026-10-13T10:00:00Z',
          eliminadoEl: null,
        },
      ]);

      await render(<RemindersListScreen />);

      await waitFor(() => {
        expect(screen.getByText('Registro de signos vitales')).toBeTruthy();
      });
      expect(screen.getByText(/09:00, 21:00/)).toBeTruthy();
      expect(screen.getByText(/Lun, Mar, Mié, Jue, Vie, Sáb, Dom/)).toBeTruthy();
    });

    it('permite alternar el interruptor maestro de avisos', async () => {
      mockReminderRepo.getPreferences.mockResolvedValueOnce({
        enabled: true,
        updatedAt: '2026-10-13T10:00:00Z',
      });
      mockReminderRepo.listRules.mockResolvedValueOnce([]);

      await render(<RemindersListScreen />);

      await waitFor(() => {
        expect(screen.getByRole('switch', { name: 'Activar recordatorios locales' })).toBeTruthy();
      });

      const masterSwitch = screen.getByRole('switch', { name: 'Activar recordatorios locales' });
      fireEvent.press(masterSwitch);

      await waitFor(() => {
        expect(mockReminderRepo.setPreferences).toHaveBeenCalledWith(false);
      });
    });

    it('muestra aviso de permiso bloqueado cuando el sistema lo deniega', async () => {
      mockAdapter.getPermissionState.mockResolvedValueOnce({
        status: 'denied',
        canAskAgain: false,
        channelStatus: 'ok',
      });
      mockReminderRepo.listRules.mockResolvedValueOnce([]);

      await render(<RemindersListScreen />);

      await waitFor(() => {
        expect(screen.getByText('Permiso bloqueado')).toBeTruthy();
      });
      expect(screen.getByText('Abrir Ajustes de Android')).toBeTruthy();
    });

    it('muestra aviso de canal bloqueado cuando channelStatus es blocked', async () => {
      mockAdapter.getPermissionState.mockResolvedValueOnce({
        status: 'granted',
        canAskAgain: true,
        channelStatus: 'blocked',
      });
      mockReminderRepo.listRules.mockResolvedValueOnce([]);

      await render(<RemindersListScreen />);

      await waitFor(() => {
        expect(screen.getByText('Canal de notificaciones bloqueado')).toBeTruthy();
      });
      expect(screen.getByText('Abrir Ajustes de Android')).toBeTruthy();
    });

    it('distingue visualmente la cobertura parcial cuando faltan ocurrencias por programar', async () => {
      mockReminderRepo.getPreferences.mockResolvedValueOnce({ enabled: true, updatedAt: null });
      mockAdapter.getPermissionState.mockResolvedValueOnce({
        status: 'granted',
        canAskAgain: true,
        channelStatus: 'granted',
      });
      mockCoordinatorReconcile.mockResolvedValueOnce({
        status: 'programacion_pendiente',
        motivoPendiente: 'programacion_parcial',
        totalDeseadas: 14,
        programadasConfirmadas: 7,
        cubiertoHastaIso: '2026-10-19T12:00:00.000Z',
        truncadas: 0,
        reglasAfectadas: [],
        incidencias: [],
      });
      mockReminderRepo.listRules.mockResolvedValueOnce([]);

      await render(<RemindersListScreen />);

      await waitFor(() => {
        expect(screen.getByText('Parcial: 7 de 14 confirmadas')).toBeTruthy();
      });
      expect(screen.getByText(/Programados hasta:/)).toBeTruthy();
    });

    it('distingue visualmente el estado pausado cuando se resuelven cancelaciones del contexto anterior', async () => {
      mockReminderRepo.getPreferences.mockResolvedValueOnce({ enabled: true, updatedAt: null });
      mockAdapter.getPermissionState.mockResolvedValueOnce({
        status: 'granted',
        canAskAgain: true,
        channelStatus: 'granted',
      });
      mockCoordinatorReconcile.mockResolvedValueOnce({
        status: 'programacion_pendiente',
        motivoPendiente: 'contexto_anterior',
        totalDeseadas: 0,
        programadasConfirmadas: 0,
        cubiertoHastaIso: null,
        truncadas: 0,
        reglasAfectadas: [],
        incidencias: [
          'La programación permanece pausada esperando resolver cancelaciones del contexto anterior.',
        ],
      });
      mockReminderRepo.listRules.mockResolvedValueOnce([]);

      await render(<RemindersListScreen />);

      await waitFor(() => {
        expect(screen.getByText('Pausada (resolviendo contexto anterior)')).toBeTruthy();
      });
    });
  });

  describe('ReminderEditScreen', () => {
    it('muestra el formulario de creación para signos vitales por defecto', async () => {
      await render(<ReminderEditScreen />);

      await waitFor(() => {
        expect(screen.getByText('Nuevo recordatorio')).toBeTruthy();
      });
      expect(screen.getByLabelText('Registro de signos vitales')).toBeTruthy();
      expect(screen.getByText('09:00')).toBeTruthy();
    });

    it('muestra selector de medicamentos al cambiar el tipo a medicación', async () => {
      mockRepository.activeMedications.mockResolvedValueOnce([
        { id: 'med-1', nombre: 'Ciclofosfamida 500mg' },
      ]);

      await render(<ReminderEditScreen />);

      await waitFor(() => {
        expect(screen.getByLabelText('Consulta de medicación')).toBeTruthy();
      });

      fireEvent.press(screen.getByLabelText('Consulta de medicación'));

      await waitFor(() => {
        expect(screen.getByText('Medicamento vinculado')).toBeTruthy();
      });
      expect(screen.getByText('Ciclofosfamida 500mg')).toBeTruthy();
    });

    it('guarda una regla válida y regresa a la pantalla anterior', async () => {
      await render(<ReminderEditScreen />);

      await waitFor(() => {
        expect(screen.getByText('Guardar recordatorio')).toBeTruthy();
      });

      // Seleccionar una hora de los preajustes y activar la regla
      fireEvent.press(screen.getByLabelText('Hora preajuste 09:00'));
      await waitFor(() => {
        expect(screen.getByLabelText('Eliminar hora 09:00')).toBeTruthy();
      });
      fireEvent.press(screen.getByLabelText('Habilitar este recordatorio'));
      await waitFor(() => {
        expect(
          screen.getByLabelText('Habilitar este recordatorio').props.accessibilityState.checked,
        ).toBe(true);
      });

      fireEvent.press(screen.getByText('Guardar recordatorio'));

      await waitFor(() => {
        expect(mockReminderRepo.saveRule).toHaveBeenCalledWith(
          expect.objectContaining({
            tipo: 'registro_vitales',
            horasMinutos: ['09:00'],
            habilitado: true,
          }),
        );
      });
      expect(mockRouterBack).toHaveBeenCalled();
    });

    it('valida que existan horas seleccionadas antes de guardar', async () => {
      await render(<ReminderEditScreen />);

      await waitFor(() => {
        expect(screen.getByText('Guardar recordatorio')).toBeTruthy();
      });

      // Intentar guardar sin haber seleccionado horas
      fireEvent.press(screen.getByText('Guardar recordatorio'));

      await waitFor(() => {
        expect(
          screen.getByText('Debes añadir al menos una hora para el recordatorio.'),
        ).toBeTruthy();
      });
      expect(mockReminderRepo.saveRule).not.toHaveBeenCalled();
    });

    it('permite añadir una hora personalizada en formato HH:mm', async () => {
      await render(<ReminderEditScreen />);

      await waitFor(() => {
        expect(screen.getByLabelText('Hora personalizada formato HH:mm')).toBeTruthy();
      });

      const timeInput = screen.getByLabelText('Hora personalizada formato HH:mm');
      fireEvent.changeText(timeInput, '08:30');
      await waitFor(() => {
        expect(timeInput.props.value).toBe('08:30');
      });
      fireEvent.press(screen.getByText('Añadir hora'));

      await waitFor(() => {
        expect(screen.getByLabelText('Eliminar hora 08:30')).toBeTruthy();
      });
    });

    it('permite eliminar lógicamente una regla existente', async () => {
      mockUseLocalSearchParams.mockReturnValue({ id: 'rule-vitales' });
      mockReminderRepo.getRule.mockResolvedValueOnce({
        id: 'rule-vitales',
        pacienteId: 'paciente-a',
        tipo: 'registro_vitales',
        medicamentoId: null,
        diasSemana: [1, 2, 3],
        horasMinutos: ['08:00'],
        zonaHoraria: 'America/Santiago',
        fechaInicio: null,
        fechaFin: null,
        habilitado: true,
        revision: 1,
        creadoEl: '2026-10-13T10:00:00Z',
        actualizadoEl: '2026-10-13T10:00:00Z',
        eliminadoEl: null,
      });

      await render(<ReminderEditScreen />);

      await waitFor(() => {
        expect(screen.getByText('Eliminar recordatorio')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Eliminar recordatorio'));

      await waitFor(() => {
        expect(mockReminderRepo.deleteRule).toHaveBeenCalledWith('rule-vitales');
      });
      expect(mockRouterBack).toHaveBeenCalled();
    });
  });

  describe('NoticesTrayScreen', () => {
    it('muestra el estado vacío cuando no hay avisos en la bandeja', async () => {
      mockReminderRepo.listNotifications.mockResolvedValueOnce([]);

      await render(<NoticesTrayScreen />);

      await waitFor(() => {
        expect(screen.getByText('Sin avisos en esta vista')).toBeTruthy();
      });
    });

    it('muestra avisos programados con sus fechas y estados', async () => {
      mockReminderRepo.listNotifications.mockResolvedValueOnce([
        {
          id: 'notif-1',
          pacienteId: 'paciente-a',
          recordatorioId: 'rule-1',
          revision: 1,
          tipo: 'registro_vitales',
          fechaPrevistaUtc: '2026-10-14T12:00:00Z',
          idNativo: 'native-1',
          estado: 'programada',
          payload: {
            version: 1,
            notificacionId: 'notif-1',
            revision: 1,
            pacienteId: 'paciente-a',
            recordatorioId: 'rule-1',
            tipo: 'registro_vitales',
            destino: '/vitales/registrar',
          },
          error: null,
          recibidaObservadaEn: null,
          abiertaEn: null,
          creadoEl: '2026-10-13T10:00:00Z',
          actualizadoEl: '2026-10-13T10:00:00Z',
        },
      ]);

      await render(<NoticesTrayScreen />);

      await waitFor(() => {
        expect(screen.getByText('Signos vitales')).toBeTruthy();
      });
      expect(screen.getByText('Programada en el sistema')).toBeTruthy();
      expect(screen.getByText('Registrar signos vitales')).toBeTruthy();
    });

    it('permite filtrar por estado en la bandeja de avisos', async () => {
      mockReminderRepo.listNotifications.mockResolvedValue([]);

      await render(<NoticesTrayScreen />);

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: 'Filtrar por Programados' })).toBeTruthy();
      });

      fireEvent.press(screen.getByRole('tab', { name: 'Filtrar por Programados' }));

      await waitFor(() => {
        expect(mockReminderRepo.listNotifications).toHaveBeenCalledWith(
          expect.objectContaining({ estado: 'programada' }),
        );
      });
    });
  });
});
