/// <reference types="jest" />

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

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
      expect(mockReminderRepo.saveRule).not.toHaveBeenCalled();
    });

    it('guarda una regla válida y regresa a la pantalla anterior', async () => {
      await render(<ReminderEditScreen />);

      await waitFor(() => {
        expect(screen.getByText('Guardar y activar')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Guardar y activar'));

      await waitFor(() => {
        expect(mockReminderRepo.saveRule).toHaveBeenCalledWith(
          expect.objectContaining({
            tipo: 'registro_vitales',
            horasMinutos: ['07:00'],
            habilitado: true,
          }),
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
      );
      expect(mockRouterBack).not.toHaveBeenCalled();

      alertSpy.mockRestore();
    });

    it('T-17: cuando la pausa general está activa y existen otros horarios, ofrece reanudar todos o mantener la pausa', async () => {
      mockReminderRepo.getPreferences.mockResolvedValueOnce({
        enabled: false,
        updatedAt: '2026-10-16T00:00:00.000Z',
      });
      const saveWithIntentMock = jest
        .fn()
        .mockResolvedValueOnce({
          rule: { id: 'rule-1' },
          preferences: { enabled: false, updatedAt: '2026-10-16T00:00:00.000Z' },
          otherEnabledRulesCount: 2,
          resumedGeneralPreference: false,
          pausedByGeneralPreference: true,
        })
        .mockResolvedValueOnce({
          rule: { id: 'rule-1' },
          preferences: { enabled: true, updatedAt: '2026-10-16T12:00:00.000Z' },
          otherEnabledRulesCount: 2,
          resumedGeneralPreference: true,
          pausedByGeneralPreference: false,
        });
      (mockReminderRepo as Record<string, unknown>).saveRuleWithActivationIntent =
        saveWithIntentMock;

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

      delete (mockReminderRepo as Record<string, unknown>).saveRuleWithActivationIntent;
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
