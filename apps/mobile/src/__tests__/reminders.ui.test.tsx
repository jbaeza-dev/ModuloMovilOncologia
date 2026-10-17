/// <reference types="jest" />

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

import {
  consumeHomeScrollToTop,
  requestHomeScrollToTop,
} from '../features/home/home-scroll-signal';

// Mock expo-router
const mockUseLocalSearchParams = jest.fn();
const mockRouterPush = jest.fn();
const mockRouterBack = jest.fn();
const mockNavigationDispatch = jest.fn();

let mockPreventRemoveEnabled = false;
let mockPreventRemoveCallback: ((event: { data: { action: { type: string } } }) => void) | null =
  null;

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    router: {
      push: (...args: unknown[]) => mockRouterPush(...args),
      replace: jest.fn(),
      back: (...args: unknown[]) => {
        if (mockPreventRemoveEnabled && mockPreventRemoveCallback) {
          mockPreventRemoveCallback({ data: { action: { type: 'GO_BACK' } } });
          return;
        }
        mockRouterBack(...args);
      },
      canGoBack: jest.fn().mockReturnValue(true),
    },
    useNavigation: () => ({
      dispatch: (...args: unknown[]) => mockNavigationDispatch(...args),
    }),
    useLocalSearchParams: () => mockUseLocalSearchParams(),
    useFocusEffect: (cb: () => void | (() => void)) => {
      React.useEffect(() => {
        return cb();
      }, [cb]);
    },
  };
});

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

jest.mock('@react-native-community/datetimepicker', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return function MockDateTimePicker(props: Record<string, unknown>) {
    return React.createElement(View, props);
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
const mockDefaultRule = {
  id: 'rule-1',
  pacienteId: 'paciente-a',
  tipo: 'registro_vitales',
  medicamentoId: null,
  diasSemana: [1, 2, 3, 4, 5, 6, 7],
  horasMinutos: ['07:00'],
  zonaHoraria: 'America/Santiago',
  fechaInicio: null,
  fechaFin: null,
  habilitado: true,
  revision: 1,
  creadoEl: '2026-10-13T10:00:00Z',
  actualizadoEl: '2026-10-13T10:00:00Z',
  eliminadoEl: null,
};

const mockReminderRepo = {
  getPreferences: jest.fn().mockResolvedValue({ enabled: true, updatedAt: '2026-10-13T10:00:00Z' }),
  setPreferences: jest.fn().mockResolvedValue(undefined),
  listRules: jest.fn().mockResolvedValue([]),
  getRule: jest.fn().mockResolvedValue(null),
  saveRule: jest
    .fn()
    .mockImplementation(
      async (input: {
        id?: string;
        tipo: string;
        horasMinutos: string[];
        diasSemana: number[];
        habilitado?: boolean;
      }) => ({
        ...mockDefaultRule,
        ...input,
        id: input.id ?? 'rule-1',
        habilitado: input.habilitado ?? true,
      }),
    ),
  saveRuleWithActivationIntent: jest.fn().mockImplementation(
    async (
      input: {
        id?: string;
        tipo: string;
        horasMinutos: string[];
        diasSemana: number[];
        habilitado?: boolean;
      },
      intent = 'keep_existing',
    ) => {
      const saved = {
        ...mockDefaultRule,
        ...input,
        id: input.id ?? 'rule-1',
        habilitado: intent === 'save_disabled' ? false : (input.habilitado ?? true),
      };
      return {
        rule: saved,
        preferencesEnabled: intent !== 'save_disabled',
        resumedGeneralPreference: false,
        pausedByGeneralPreference: false,
        otherEnabledRulesCount: 0,
      };
    },
  ),
  getReminderStatusSnapshot: jest.fn().mockImplementation(async (nowIso?: string) => ({
    patientId: 'paciente-a',
    nowIso: nowIso ?? '2026-10-16T10:00:00.000Z',
    preferences: { enabled: true, updatedAt: '2026-10-13T10:00:00Z' },
    rules: [mockDefaultRule],
    futureNotifications: [
      {
        id: 'notif-1',
        pacienteId: 'paciente-a',
        recordatorioId: 'rule-1',
        revision: 1,
        tipo: 'registro_vitales',
        fechaPrevistaUtc: '2026-10-17T10:00:00.000Z',
        idNativo: 'mock-native-1',
        estado: 'programada',
        payloadMinimo: {
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
        creadoEl: '2026-10-16T00:00:00.000Z',
        actualizadoEl: '2026-10-16T00:00:00.000Z',
      },
      {
        id: 'notif-2',
        pacienteId: 'paciente-a',
        recordatorioId: 'rule-1',
        revision: 1,
        tipo: 'registro_vitales',
        fechaPrevistaUtc: '2026-10-18T10:00:00.000Z',
        idNativo: 'mock-native-2',
        estado: 'programada',
        payloadMinimo: {
          version: 1,
          notificacionId: 'notif-2',
          revision: 1,
          pacienteId: 'paciente-a',
          recordatorioId: 'rule-1',
          tipo: 'registro_vitales',
          destino: '/vitales/registrar',
        },
        error: null,
        recibidaObservadaEn: null,
        abiertaEn: null,
        creadoEl: '2026-10-16T00:00:00.000Z',
        actualizadoEl: '2026-10-16T00:00:00.000Z',
      },
      {
        id: 'notif-3',
        pacienteId: 'paciente-a',
        recordatorioId: 'rule-1',
        revision: 1,
        tipo: 'registro_vitales',
        fechaPrevistaUtc: '2026-10-19T10:00:00.000Z',
        idNativo: 'mock-native-3',
        estado: 'programada',
        payloadMinimo: {
          version: 1,
          notificacionId: 'notif-3',
          revision: 1,
          pacienteId: 'paciente-a',
          recordatorioId: 'rule-1',
          tipo: 'registro_vitales',
          destino: '/vitales/registrar',
        },
        error: null,
        recibidaObservadaEn: null,
        abiertaEn: null,
        creadoEl: '2026-10-16T00:00:00.000Z',
        actualizadoEl: '2026-10-16T00:00:00.000Z',
      },
    ],
    medications: [],
    allEnabledRulesCount: 1,
  })),
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
  notificationAdapter: mockAdapter,
  reconcileReminders: (...args: unknown[]) => mockReconcileReminders(...args),
  runSave: (fn: () => Promise<unknown>) => fn(),
  trackOperation: (fn: () => Promise<unknown>) => fn(),
  saving: false,
  isClosing: false,
  closeActiveContext: jest.fn().mockResolvedValue({ success: true }),
  selectPatient: jest.fn().mockResolvedValue(undefined),
  activeTeardownPromise: null,
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
    it('separa Mediciones y Medicamentos y muestra sus estados iniciales cuando no hay horarios configurados', async () => {
      mockReminderRepo.listRules.mockResolvedValueOnce([]);
      mockRepository.activeMedications.mockResolvedValueOnce([
        {
          id: 'med-1',
          paciente_id: 'paciente-a',
          nombre: 'Ciclofosfamida 500mg',
          dosis: '500 mg',
          frecuencia: 'Cada 12 horas',
          via: 'Oral',
          indicaciones: null,
          fecha_inicio: '2026-10-01',
          fecha_fin: '2026-10-20',
          activo: 1,
          obtenido_en: '2026-10-01T00:00:00Z',
        },
      ]);

      await render(<RemindersListScreen />);

      await waitFor(() => {
        expect(screen.getByText('Mediciones')).toBeTruthy();
      });
      expect(screen.getByText('Medicamentos')).toBeTruthy();
      expect(screen.getByText('Sin recordatorio configurado.')).toBeTruthy();
      expect(screen.getByText('Configurar aviso')).toBeTruthy();
      expect(screen.getByText('Ciclofosfamida 500mg')).toBeTruthy();
      expect(screen.getByText('Sin horarios configurados')).toBeTruthy();
      expect(screen.getByText('Configurar horarios')).toBeTruthy();
    });

    it('muestra mensaje específico cuando el catálogo de medicamentos está vacío', async () => {
      mockReminderRepo.listRules.mockResolvedValueOnce([]);
      mockRepository.activeMedications.mockResolvedValueOnce([]);

      await render(<RemindersListScreen />);
      await waitFor(() => {
        expect(screen.getByText('Aún no hay medicamentos disponibles en tu perfil')).toBeTruthy();
      });
    });

    it('distingue error de lectura SQL de medicamentos y ofrece botón Reintentar', async () => {
      mockReminderRepo.listRules.mockResolvedValueOnce([]);
      mockRepository.activeMedications.mockRejectedValueOnce(new Error('SQLite read error'));

      await render(<RemindersListScreen />);

      await waitFor(() => {
        expect(screen.getByText('No se pudieron cargar tus medicamentos')).toBeTruthy();
      });
      expect(screen.getByText('Reintentar')).toBeTruthy();
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

    it('T-18: conserva múltiples pautas existentes por medicamento con Ver horarios sin fusionarlas ni eliminarlas', async () => {
      mockRepository.activeMedications.mockResolvedValueOnce([
        {
          id: 'med-1',
          paciente_id: 'paciente-a',
          nombre: 'Ciclofosfamida 500mg',
          dosis: '500 mg',
          frecuencia: 'Cada 12 horas',
          via: 'Oral',
          indicaciones: null,
          fecha_inicio: null,
          fecha_fin: null,
          activo: 1,
          obtenido_en: '2026-10-01T00:00:00Z',
        },
      ]);
      mockReminderRepo.listRules.mockResolvedValueOnce([
        {
          id: 'rule-med-a',
          pacienteId: 'paciente-a',
          tipo: 'medicacion',
          medicamentoId: 'med-1',
          diasSemana: [1, 3, 5],
          horasMinutos: ['08:00'],
          zonaHoraria: 'America/Santiago',
          fechaInicio: null,
          fechaFin: null,
          habilitado: true,
          revision: 1,
          creadoEl: '2026-10-13T10:00:00Z',
          actualizadoEl: '2026-10-13T10:00:00Z',
          eliminadoEl: null,
        },
        {
          id: 'rule-med-b',
          pacienteId: 'paciente-a',
          tipo: 'medicacion',
          medicamentoId: 'med-1',
          diasSemana: [2, 4],
          horasMinutos: ['20:00'],
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
        expect(
          screen.getByText('Tienes 2 horarios configurados para este medicamento.'),
        ).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Ver horarios'));

      await waitFor(() => {
        expect(screen.getByText(/08:00/)).toBeTruthy();
        expect(screen.getByText(/20:00/)).toBeTruthy();
      });
      expect(mockReminderRepo.deleteRule).not.toHaveBeenCalled();
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

    it('distingue visualmente la cobertura parcial y muestra «Avisos preparados hasta:»', async () => {
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
      expect(screen.getByText(/Avisos preparados hasta:/)).toBeTruthy();
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
    it('muestra el formulario de creación para signos vitales con 07:00 y Todos los días por defecto', async () => {
      await render(<ReminderEditScreen />);

      await waitFor(() => {
        expect(screen.getByText('Nuevo recordatorio')).toBeTruthy();
      });
      expect(screen.getByLabelText('Registro de signos vitales')).toBeTruthy();
      expect(screen.getByText('07:00')).toBeTruthy();
      expect(screen.getByLabelText('Todos los días')).toBeTruthy();
      expect(screen.getByLabelText('Personalizar')).toBeTruthy();
    });

    it('T-18: conserva la hora previa cuando el selector nativo de hora se cancela con dismissed', async () => {
      await render(<ReminderEditScreen />);

      await waitFor(() => {
        expect(screen.getByLabelText('Seleccionar hora del aviso de medición')).toBeTruthy();
      });

      fireEvent.press(screen.getByLabelText('Seleccionar hora del aviso de medición'));
      await waitFor(() => {
        expect(screen.getByTestId('native-time-picker')).toBeTruthy();
      });
      const picker = screen.getByTestId('native-time-picker');

      // Simular cancelación del diálogo nativo (dismissed)
      fireEvent(picker, 'onChange', { type: 'dismissed' }, undefined);

      expect(screen.getByText('07:00')).toBeTruthy();
    });

    it('muestra encabezado clínico en solo lectura cuando medicamentoId válido viene por parámetro y plantillas desde las 07:00', async () => {
      mockUseLocalSearchParams.mockReturnValue({
        tipo: 'medicacion',
        medicamentoId: 'med-1',
      });
      mockRepository.activeMedications.mockResolvedValueOnce([
        {
          id: 'med-1',
          paciente_id: 'paciente-a',
          nombre: 'Ciclofosfamida 500mg',
          dosis: '500 mg',
          frecuencia: 'Cada 12 horas',
          via: 'Oral',
          indicaciones: null,
          fecha_inicio: '2026-10-10',
          fecha_fin: '2026-10-30',
          activo: 1,
          obtenido_en: '2026-10-10T00:00:00Z',
        },
      ]);

      await render(<ReminderEditScreen />);

      await waitFor(() => {
        expect(screen.getByText('Ciclofosfamida 500mg')).toBeTruthy();
      });
      expect(screen.getByLabelText('Horario de mañana')).toBeTruthy();
      expect(screen.getByLabelText('Dos horarios diarios')).toBeTruthy();
      expect(screen.getByLabelText('Tres horarios diarios')).toBeTruthy();

      fireEvent.press(screen.getByLabelText('Dos horarios diarios'));

      await waitFor(() => {
        expect(screen.getByText('19:00')).toBeTruthy();
      });
    });

    it('T-18: exige selección explícita cuando medicamentoId falta o no existe en el catálogo (sin auto-seleccionar el primero)', async () => {
      mockUseLocalSearchParams.mockReturnValue({
        tipo: 'medicacion',
        medicamentoId: 'med-inexistente',
      });
      mockRepository.activeMedications.mockResolvedValueOnce([
        { id: 'med-1', nombre: 'Ciclofosfamida 500mg' },
      ]);

      await render(<ReminderEditScreen />);

      await waitFor(() => {
        expect(screen.getByText('Medicamento vinculado')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Guardar y activar'));

      await waitFor(() => {
        expect(
          screen.getByText(
            'Debes seleccionar un medicamento explícitamente para este recordatorio.',
          ),
        ).toBeTruthy();
      });
      expect(mockReminderRepo.saveRuleWithActivationIntent).not.toHaveBeenCalled();
    });

    it('guarda una regla válida y regresa a la pantalla anterior', async () => {
      await render(<ReminderEditScreen />);

      await waitFor(() => {
        expect(screen.getByText('Guardar y activar')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Guardar y activar'));

      await waitFor(() => {
        expect(mockReminderRepo.saveRuleWithActivationIntent).toHaveBeenCalledWith(
          expect.objectContaining({
            tipo: 'registro_vitales',
            horasMinutos: ['07:00'],
            habilitado: true,
          }),
          'save_and_activate',
        );
        expect(mockRouterBack).toHaveBeenCalled();
      });
    });

    it('permite cambiar la hora mediante la opción accesible por teclado disponible para cualquier usuario', async () => {
      await render(<ReminderEditScreen />);

      await waitFor(() => {
        expect(screen.getByLabelText('Escribir hora con teclado para Hora del aviso')).toBeTruthy();
      });

      fireEvent.press(screen.getByLabelText('Escribir hora con teclado para Hora del aviso'));
      await waitFor(() => {
        expect(screen.getByLabelText('Campo de texto hora para Hora del aviso')).toBeTruthy();
      });
      const timeInput = screen.getByLabelText('Campo de texto hora para Hora del aviso');
      fireEvent.changeText(timeInput, '08:30');
      await waitFor(() => {
        expect(timeInput.props.value).toBe('08:30');
      });
      fireEvent.press(screen.getByText('Aplicar hora'));

      await waitFor(() => {
        expect(screen.getByText('08:30')).toBeTruthy();
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
        expect(mockRouterBack).toHaveBeenCalled();
      });
    });

    it('Ajuste 4 (T-18): guardar -> permanecer por una incidencia nativa -> modificar nuevamente -> pulsar Atrás -> aparece confirmación', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

      // 1. El primer guardado persiste en SQLite pero falla la confirmación nativa -> permanece en pantalla
      mockCoordinatorReconcile.mockResolvedValueOnce({
        status: 'error',
        totalDeseadas: 14,
        programadasConfirmadas: 0,
        cubiertoHastaIso: null,
        truncadas: 0,
        reglasAfectadas: ['rule-1'],
        incidencias: ['Fallo del programador nativo'],
      });

      await render(<ReminderEditScreen />);

      await waitFor(() => {
        expect(screen.getByText('Guardar y activar')).toBeTruthy();
      });

      // Cambiar días (Personalizar -> desmarcar Lunes) y guardar
      fireEvent.press(screen.getByLabelText('Personalizar'));
      await waitFor(() => {
        expect(screen.getByLabelText('Lunes')).toBeTruthy();
      });
      fireEvent.press(screen.getByLabelText('Lunes'));
      await waitFor(() => {
        expect(screen.getByLabelText('Lunes').props.accessibilityState.selected).toBe(false);
      });

      fireEvent.press(screen.getByText('Guardar y activar'));

      // Permanece en pantalla mostrando la tarjeta de incidencia nativa
      await waitFor(() => {
        expect(screen.getByText('Horario guardado en este teléfono')).toBeTruthy();
      });
      expect(mockRouterBack).not.toHaveBeenCalled();

      // 2. Sin cambios posteriores, confirmedSnapshot coincide con el estado guardado (isDirty === false)
      expect(mockPreventRemoveEnabled).toBe(false);

      // 3. Modificar nuevamente un campo (desmarcar Martes) -> vuelve a estar sucio respecto a confirmedSnapshot
      fireEvent.press(screen.getByLabelText('Martes'));
      await waitFor(() => {
        expect(screen.getByLabelText('Martes').props.accessibilityState.selected).toBe(false);
      });
      expect(mockPreventRemoveEnabled).toBe(true);

      // 4. Pulsar Atrás (Volver) -> aparece la confirmación "¿Salir sin guardar los cambios?"
      fireEvent.press(screen.getByLabelText('Volver'));

      expect(alertSpy).toHaveBeenCalledWith(
        '¿Salir sin guardar los cambios?',
        'Tienes modificaciones sin guardar en este recordatorio.',
        expect.any(Array),
        expect.anything(),
      );
      expect(mockRouterBack).not.toHaveBeenCalled();

      alertSpy.mockRestore();
    });

    it('T-17: cuando la pausa general está activa y existen otros horarios, ofrece reanudar todos o mantener la pausa', async () => {
      mockReminderRepo.getPreferences.mockResolvedValueOnce({
        enabled: false,
        updatedAt: '2026-10-16T00:00:00.000Z',
      });
      const originalSaveWithIntent = mockReminderRepo.saveRuleWithActivationIntent;
      const saveWithIntentMock = jest
        .fn()
        .mockResolvedValueOnce({
          rule: { ...mockDefaultRule, id: 'rule-1' },
          preferencesEnabled: false,
          otherEnabledRulesCount: 2,
          resumedGeneralPreference: false,
          pausedByGeneralPreference: true,
        })
        .mockResolvedValueOnce({
          rule: { ...mockDefaultRule, id: 'rule-1' },
          preferencesEnabled: true,
          otherEnabledRulesCount: 2,
          resumedGeneralPreference: true,
          pausedByGeneralPreference: false,
        });
      mockReminderRepo.saveRuleWithActivationIntent = saveWithIntentMock;

      await render(<ReminderEditScreen />);

      await waitFor(() => {
        expect(screen.getByText('Guardar y activar')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Guardar y activar'));

      await waitFor(() => {
        expect(screen.getByText('Tus avisos generales están en pausa')).toBeTruthy();
      });
      expect(screen.getByText(/2 otros horarios activos/)).toBeTruthy();

      fireEvent.press(screen.getByText('Activar avisos y este horario'));

      await waitFor(() => {
        expect(saveWithIntentMock).toHaveBeenLastCalledWith(
          expect.objectContaining({ id: 'rule-1' }),
          'save_and_resume_all',
        );
        expect(mockRouterBack).toHaveBeenCalled();
      });

      mockReminderRepo.saveRuleWithActivationIntent = originalSaveWithIntent;
    });

    it('bloquea la edición y el guardado mientras getRule está cargando', async () => {
      let resolveGetRule: (rule: unknown) => void;
      const getRulePromise = new Promise((resolve) => {
        resolveGetRule = resolve;
      });
      mockUseLocalSearchParams.mockReturnValue({ id: 'rule-delayed' });
      mockReminderRepo.getRule.mockImplementationOnce(() => getRulePromise);

      await render(<ReminderEditScreen />);

      // Muestra estado explícito de carga y no permite guardar
      expect(screen.getByText('Cargando recordatorio...')).toBeTruthy();
      expect(screen.queryByText('Guardar cambios')).toBeNull();
      expect(screen.queryByText('Guardar y activar')).toBeNull();
      expect(mockReminderRepo.saveRuleWithActivationIntent).not.toHaveBeenCalled();

      // Cuando termina la carga con una regla válida, pasa a disponible y muestra "Guardar cambios"
      await act(async () => {
        resolveGetRule!({
          ...mockDefaultRule,
          id: 'rule-delayed',
          horasMinutos: ['08:00'],
        });
      });

      await waitFor(() => {
        expect(screen.getByText('Editar recordatorio')).toBeTruthy();
        expect(screen.getByText('Guardar cambios')).toBeTruthy();
      });
    });

    it('rechaza registros eliminados y muestra recordatorio no encontrado', async () => {
      mockUseLocalSearchParams.mockReturnValue({ id: 'rule-deleted' });
      mockReminderRepo.getRule.mockResolvedValueOnce({
        ...mockDefaultRule,
        id: 'rule-deleted',
        eliminadoEl: '2026-10-15T00:00:00.000Z',
      });

      await render(<ReminderEditScreen />);

      await waitFor(() => {
        expect(screen.getByText('Recordatorio no encontrado')).toBeTruthy();
      });
      expect(mockReminderRepo.saveRuleWithActivationIntent).not.toHaveBeenCalled();
    });

    it('al cancelar la salida con "Seguir editando", limpia la solicitud de desplazamiento a Inicio', async () => {
      let alertButtons: { text: string; onPress?: () => void }[] = [];
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
        alertButtons = (buttons as { text: string; onPress?: () => void }[]) || [];
      });

      requestHomeScrollToTop();
      expect(consumeHomeScrollToTop()).toBe(true);

      // Ahora solicitamos de nuevo scroll hacia Inicio
      requestHomeScrollToTop();

      mockUseLocalSearchParams.mockReturnValue({});
      await render(<ReminderEditScreen />);

      await waitFor(() => {
        expect(screen.getByLabelText('Personalizar')).toBeTruthy();
      });

      // Modificamos un campo para ensuciar el formulario
      fireEvent.press(screen.getByLabelText('Personalizar'));
      await waitFor(() => {
        expect(screen.getByLabelText('Lunes')).toBeTruthy();
      });
      fireEvent.press(screen.getByLabelText('Lunes'));

      await waitFor(() => {
        expect(mockPreventRemoveEnabled).toBe(true);
      });

      // Intentamos salir pulsando Volver
      fireEvent.press(screen.getByLabelText('Volver'));
      expect(alertSpy).toHaveBeenCalled();

      // El usuario elige "Seguir editando"
      const seguirEditandoBtn = alertButtons.find((b) => b.text === 'Seguir editando');
      expect(seguirEditandoBtn).toBeDefined();
      seguirEditandoBtn?.onPress?.();

      // Debe haber limpiado pendingScrollToTop
      expect(consumeHomeScrollToTop()).toBe(false);

      alertSpy.mockRestore();
    });

    it('al confirmar la salida con "Salir sin guardar", conserva la solicitud de desplazamiento a Inicio para HomeScreen', async () => {
      let alertButtons: { text: string; onPress?: () => void }[] = [];
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
        alertButtons = (buttons as { text: string; onPress?: () => void }[]) || [];
      });

      // Se solicita scroll a Inicio
      requestHomeScrollToTop();

      mockUseLocalSearchParams.mockReturnValue({});
      await render(<ReminderEditScreen />);

      await waitFor(() => {
        expect(screen.getByLabelText('Personalizar')).toBeTruthy();
      });

      // Modificamos un campo para ensuciar el formulario
      fireEvent.press(screen.getByLabelText('Personalizar'));
      await waitFor(() => {
        expect(screen.getByLabelText('Lunes')).toBeTruthy();
      });
      fireEvent.press(screen.getByLabelText('Lunes'));

      await waitFor(() => {
        expect(mockPreventRemoveEnabled).toBe(true);
      });

      // Intentamos salir pulsando Volver
      fireEvent.press(screen.getByLabelText('Volver'));
      expect(alertSpy).toHaveBeenCalled();

      // El usuario elige "Salir sin guardar"
      const salirSinGuardarBtn = alertButtons.find((b) => b.text === 'Salir sin guardar');
      expect(salirSinGuardarBtn).toBeDefined();
      salirSinGuardarBtn?.onPress?.();

      // Debe conservar pendingScrollToTop para que Inicio lo consuma al enfocar
      expect(consumeHomeScrollToTop()).toBe(true);
      expect(mockNavigationDispatch).toHaveBeenCalledWith({ type: 'GO_BACK' });

      alertSpy.mockRestore();
    });

    it('muestra controles específicos de creación (Activar al guardar) en modo creación', async () => {
      mockUseLocalSearchParams.mockReturnValue({});
      await render(<ReminderEditScreen />);

      await waitFor(() => {
        expect(screen.getByText('Activar al guardar')).toBeTruthy();
        expect(screen.getByText('Guardar y activar')).toBeTruthy();
      });
      expect(screen.queryByText('Estado del recordatorio')).toBeNull();
      expect(screen.queryByText('Guardar cambios')).toBeNull();
    });

    it('muestra controles específicos de edición (Estado del recordatorio y Guardar cambios) en modo edición', async () => {
      mockUseLocalSearchParams.mockReturnValue({ id: 'rule-edit-mode' });
      mockReminderRepo.getRule.mockResolvedValueOnce({
        ...mockDefaultRule,
        id: 'rule-edit-mode',
        habilitado: true,
      });

      await render(<ReminderEditScreen />);

      await waitFor(() => {
        expect(screen.getByText('Estado del recordatorio')).toBeTruthy();
        expect(screen.getByText('Guardar cambios')).toBeTruthy();
      });
      expect(screen.queryByText('Activar al guardar')).toBeNull();
      expect(screen.queryByText('Guardar y activar')).toBeNull();
    });

    it('en modo edición, "Guardar cambios" envía keep_existing y preserva la pausa general sin levantarla', async () => {
      mockUseLocalSearchParams.mockReturnValue({ id: 'rule-edit-keep' });
      mockReminderRepo.getRule.mockResolvedValueOnce({
        ...mockDefaultRule,
        id: 'rule-edit-keep',
        habilitado: true,
        horasMinutos: ['08:00'],
      });
      const originalSave = mockReminderRepo.saveRuleWithActivationIntent;
      const saveSpy = jest.fn().mockResolvedValueOnce({
        rule: {
          ...mockDefaultRule,
          id: 'rule-edit-keep',
          habilitado: true,
          horasMinutos: ['09:00'],
        },
        preferencesEnabled: false,
        otherEnabledRulesCount: 0,
        resumedGeneralPreference: false,
        pausedByGeneralPreference: true,
      });
      mockReminderRepo.saveRuleWithActivationIntent = saveSpy;

      await render(<ReminderEditScreen />);

      await waitFor(() => {
        expect(screen.getByText('Guardar cambios')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Guardar cambios'));

      await waitFor(() => {
        expect(saveSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'rule-edit-keep',
            habilitado: true,
          }),
          'keep_existing',
        );
        expect(mockRouterBack).toHaveBeenCalled();
      });

      mockReminderRepo.saveRuleWithActivationIntent = originalSave;
    });

    it('en modo edición con recordatorio en pausa, "Guardar cambios" envía keep_existing con habilitado: false', async () => {
      mockUseLocalSearchParams.mockReturnValue({ id: 'rule-edit-paused' });
      mockReminderRepo.getRule.mockResolvedValueOnce({
        ...mockDefaultRule,
        id: 'rule-edit-paused',
        habilitado: false,
        horasMinutos: ['08:00'],
      });
      const originalSave = mockReminderRepo.saveRuleWithActivationIntent;
      const saveSpy = jest.fn().mockResolvedValueOnce({
        rule: {
          ...mockDefaultRule,
          id: 'rule-edit-paused',
          habilitado: false,
          horasMinutos: ['08:00'],
        },
        preferencesEnabled: false,
        otherEnabledRulesCount: 0,
        resumedGeneralPreference: false,
        pausedByGeneralPreference: false,
      });
      mockReminderRepo.saveRuleWithActivationIntent = saveSpy;

      await render(<ReminderEditScreen />);

      await waitFor(() => {
        expect(screen.getByText('Guardar cambios')).toBeTruthy();
        expect(screen.getByText('Recordatorio en pausa')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Guardar cambios'));

      await waitFor(() => {
        expect(saveSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'rule-edit-paused',
            habilitado: false,
          }),
          'keep_existing',
        );
        expect(mockRouterBack).toHaveBeenCalled();
      });

      mockReminderRepo.saveRuleWithActivationIntent = originalSave;
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
