jest.mock('../features/sync/GlobalStatusNotice', () => ({ RecordsStatusCard: () => null }));
/// <reference types="jest" />

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Alert, AppState, Text } from 'react-native';
import type { GatewayRecordatorio } from '@quimiocare/contracts';

let mockNavIndex = 0;
const mockRouterBack = jest.fn();
const mockRouterReplace = jest.fn();
const mockRouterNavigate = jest.fn();
const mockRouterPush = jest.fn();
const mockEpro = {
  hub: jest.fn().mockResolvedValue({
    status: { completed_at: '2026-10-28T01:00:00Z' },
    current: {},
    drafts: [],
    captures: [],
  }),
};
jest.mock('../features/medical-forms/use-epro-repository', () => ({
  useEproRepository: () => mockEpro,
}));
const mockRouterCanGoBack = jest.fn(() => mockNavIndex > 0);

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    router: {
      back: (...args: unknown[]) => mockRouterBack(...args),
      replace: (...args: unknown[]) => mockRouterReplace(...args),
      navigate: (...args: unknown[]) => mockRouterNavigate(...args),
      push: (...args: unknown[]) => mockRouterPush(...args),
      canGoBack: () => mockRouterCanGoBack(),
    },
    useLocalSearchParams: () => ({}),
    useNavigation: () => ({ dispatch: jest.fn() }),
    useFocusEffect: (cb: () => void | (() => void)) => {
      React.useEffect(() => {
        return cb();
      }, [cb]);
    },
    Tabs: Object.assign(({ children }: { children: React.ReactNode }) => children, {
      Screen: () => null,
    }),
  };
});

jest.mock('expo-router/react-navigation', () => ({
  useNavigationState: (selector: (state: { index: number }) => unknown) =>
    selector({ index: mockNavIndex }),
  usePreventRemove: jest.fn(),
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

const mockCloseActiveContext = jest.fn().mockResolvedValue({
  success: true,
  cancelledPatientId: 'paciente-demo-001',
  pendingNotificationsCount: 0,
});

const defaultSnapshot = {
  patientId: 'paciente-demo-001',
  nowIso: '2026-10-16T12:00:00.000Z',
  preferences: { enabled: false, updatedAt: null },
  rules: [],
  futureNotifications: [],
  medications: [],
  allEnabledRulesCount: 0,
};

const mockGetReminderStatusSnapshot = jest.fn().mockResolvedValue(defaultSnapshot);

const mockUseLocalData = jest.fn().mockReturnValue({
  patientId: 'paciente-demo-001',
  manager: {
    getPatientId: () => 'paciente-demo-001',
    getContextEpoch: () => 1,
  },
  repository: {
    profile: jest.fn().mockResolvedValue({
      paciente_id: 'paciente-demo-001',
      nombre: 'María Elena Morales',
      email: 'maria@quimiocare.test',
      rut: '12.345.678-9',
      obtenido_en: '2026-10-16T00:00:00.000Z',
    }),
    latestVital: jest.fn().mockResolvedValue(null),
    createVitals: jest.fn().mockResolvedValue(undefined),
    symptoms: jest.fn().mockResolvedValue([]),
    reminders: {
      getReminderStatusSnapshot: (...args: unknown[]) => mockGetReminderStatusSnapshot(...args),
      setPreferences: jest.fn().mockResolvedValue(undefined),
    },
  },
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
  closeActiveContext: (...args: unknown[]) => mockCloseActiveContext(...args),
  changePatient: jest.fn(),
  runSave: jest.fn((fn: () => Promise<unknown>) => fn()),
  saving: false,
  isClosing: false,
});

jest.mock('../providers/LocalDataProvider', () => ({
  DEMO_PATIENTS: [
    { id: 'paciente-demo-001', label: 'Paciente de prueba A' },
    { id: 'paciente-demo-002', label: 'Paciente de prueba B' },
  ],
  useLocalData: () => mockUseLocalData(),
}));

import { handleHomeTabPress } from '../app/(tabs)/_layout';
import {
  ConfirmLogoutButton,
  LOGOUT_CONFIRM_MESSAGE,
  LOGOUT_CONFIRM_TITLE,
} from '../components/ConfirmLogoutButton';
import { NavigationCard } from '../components/NavigationCard';
import { Screen } from '../components/Screen';
import { ScreenBottomInsetHandledContext } from '../components/ScreenInsets';
import { SymptomDataScreen } from '../features/form/SymptomDataScreen';
import { HomeScreen, resolveHomeGreeting } from '../features/home/HomeScreen';
import { clearHomeScrollToTop, consumeHomeScrollToTop } from '../features/home/home-scroll-signal';
import { RegisterVitalsDataScreen } from '../features/vitals/VitalsDataScreens';

describe('Screen, NavigationCard, rutas de Inicio y reinicio dirigido (Bloque 1 y Bloque 2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNavIndex = 0;
    mockDemoMode = true;
    mockGetReminderStatusSnapshot.mockResolvedValue(defaultSnapshot);
    clearHomeScrollToTop();
  });

  it('oculta la flecha Volver cuando no hay historial de retroceso (index === 0)', async () => {
    mockNavIndex = 0;
    await render(
      <Screen title="Pantalla sin historial">
        <Text>Contenido</Text>
      </Screen>,
    );

    expect(screen.queryByLabelText('Volver')).toBeNull();
  });

  it('oculta la flecha Volver cuando isRoot es true aunque exista historial en el navegador', async () => {
    mockNavIndex = 2;
    await render(
      <Screen isRoot title="Pantalla raíz">
        <Text>Contenido raíz</Text>
      </Screen>,
    );

    expect(screen.queryByLabelText('Volver')).toBeNull();
  });

  it('muestra la flecha Volver cuando no es raíz y existe historial, e invoca exclusivamente router.back()', async () => {
    mockNavIndex = 1;
    await render(
      <Screen title="Pantalla secundaria">
        <Text>Contenido secundario</Text>
      </Screen>,
    );

    const backButton = screen.getByLabelText('Volver');
    expect(backButton).toBeTruthy();

    await fireEvent.press(backButton);

    expect(mockRouterBack).toHaveBeenCalledTimes(1);
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it('NavigationCard usa navigate por defecto, push cuando navigationMethod="push" y replace cuando replace=true', async () => {
    await render(
      <>
        <NavigationCard title="Acceso navigate" icon="clock" href="/recordatorios" />
        <NavigationCard
          title="Acceso push"
          icon="activity"
          href="/vitales/registrar"
          navigationMethod="push"
        />
        <NavigationCard title="Acceso replace" icon="home" href="/" replace />
      </>,
    );

    await fireEvent.press(screen.getByLabelText('Acceso navigate'));
    expect(mockRouterPush).toHaveBeenCalledWith('/recordatorios');

    await fireEvent.press(screen.getByLabelText('Acceso push'));
    expect(mockRouterPush).toHaveBeenCalledWith('/vitales/registrar');

    await fireEvent.press(screen.getByLabelText('Acceso replace'));
    expect(mockRouterReplace).toHaveBeenCalledWith('/');
  });

  it('HomeScreen muestra saludo personalizado, tarjeta de próximo recordatorio y hace push a sus rutas hijas', async () => {
    mockNavIndex = 1;
    await render(<HomeScreen />);

    expect(screen.queryByLabelText('Volver')).toBeNull();
    expect(await screen.findByText('Hola, María Elena Morales')).toBeTruthy();
    expect(screen.getByText('Tu próxima medición')).toBeTruthy();
    expect(screen.getByText('Configurar aviso')).toBeTruthy();
    expect(screen.getByText('Completa tu cuestionario diario de seguimiento.')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Registrar signos vitales'));
    expect(mockRouterPush).toHaveBeenCalledWith('/vitales/registrar');

    await fireEvent.press(screen.getByLabelText('Cómo me siento hoy'));
    expect(mockRouterPush).toHaveBeenCalledWith('/formulario');
  });

  it('P-01: resolveHomeGreeting evita mostrar el nombre retenido de otro paciente y aplica respaldos correctos', () => {
    // Mientras carga, usa el saludo genérico aunque haya un perfil previo en memoria
    expect(
      resolveHomeGreeting({
        loadingProfile: true,
        profile: {
          paciente_id: 'paciente-demo-001',
          nombre: 'Paciente Anterior',
          email: null,
          rut: null,
          obtenido_en: '2026-10-16T00:00:00.000Z',
        },
        patientId: 'paciente-demo-001',
        demoMode: true,
      }),
    ).toBe('Hola, te damos la bienvenida');

    // Si el perfil en memoria pertenece a otro paciente (cambio A -> B), nunca muestra el nombre de A
    expect(
      resolveHomeGreeting({
        loadingProfile: false,
        profile: {
          paciente_id: 'paciente-demo-001',
          nombre: 'Paciente A',
          email: null,
          rut: null,
          obtenido_en: '2026-10-16T00:00:00.000Z',
        },
        patientId: 'paciente-demo-002',
        demoMode: false,
      }),
    ).toBe('Hola, te damos la bienvenida');

    // Sin nombre en perfil y en modo demo, usa la etiqueta del paciente demo activo
    expect(
      resolveHomeGreeting({
        loadingProfile: false,
        profile: {
          paciente_id: 'paciente-demo-002',
          nombre: '   ',
          email: null,
          rut: null,
          obtenido_en: '2026-10-16T00:00:00.000Z',
        },
        patientId: 'paciente-demo-002',
        demoMode: true,
      }),
    ).toBe('Hola, Paciente de prueba B');
  });

  it('P-03: HomeScreen muestra el próximo aviso confirmado («Hoy a las 15:00») cuando está programado', async () => {
    mockGetReminderStatusSnapshot.mockResolvedValue({
      patientId: 'paciente-demo-001',
      nowIso: '2026-10-16T12:00:00.000Z',
      preferences: { enabled: true, updatedAt: '2026-10-16T00:00:00.000Z' },
      rules: [
        {
          id: 'rule-v-1',
          pacienteId: 'paciente-demo-001',
          tipo: 'registro_vitales',
          medicamentoId: null,
          diasSemana: [1, 2, 3, 4, 5, 6, 7],
          horasMinutos: ['15:00'],
          zonaHoraria: 'America/Santiago',
          fechaInicio: null,
          fechaFin: null,
          habilitado: true,
          revision: 1,
          eliminadoEl: null,
          creadoEl: '2026-10-16T00:00:00.000Z',
          actualizadoEl: '2026-10-16T00:00:00.000Z',
        },
      ],
      futureNotifications: [
        {
          id: 'notif-v-1',
          pacienteId: 'paciente-demo-001',
          recordatorioId: 'rule-v-1',
          revision: 1,
          tipo: 'registro_vitales',
          fechaPrevistaUtc: '2026-10-16T18:00:00.000Z',
          idNativo: 'native-v-1',
          estado: 'programada',
          payloadMinimo: {
            version: 1,
            notificacionId: 'notif-v-1',
            revision: 1,
            pacienteId: 'paciente-demo-001',
            recordatorioId: 'rule-v-1',
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
    });

    await render(<HomeScreen />);
    expect(await screen.findByText('Hoy a las 15:00')).toBeTruthy();
    expect(screen.getByText('Cambiar horario')).toBeTruthy();

    await fireEvent.press(screen.getByText('Cambiar horario'));
    expect(mockRouterPush).toHaveBeenCalledWith('/recordatorios/editar?id=rule-v-1');
  });

  it('P-02: ConfirmLogoutButton solicita confirmación y ejecuta closeActiveContext("manual_close") solo al confirmar', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    await render(<ConfirmLogoutButton />);

    await fireEvent.press(screen.getByText('Cerrar sesión'));
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alertSpy.mock.calls[0];
    expect(title).toBe(LOGOUT_CONFIRM_TITLE);
    expect(message).toBe(LOGOUT_CONFIRM_MESSAGE);
    expect(buttons).toHaveLength(2);
    expect(buttons?.[0]?.text).toBe('Cancelar');
    expect(buttons?.[1]?.text).toBe('Cerrar sesión');

    // Al pulsar Cancelar no cierra el contexto
    expect(mockCloseActiveContext).not.toHaveBeenCalled();

    // Al confirmar cierra el contexto una sola vez
    buttons?.[1]?.onPress?.();
    expect(mockCloseActiveContext).toHaveBeenCalledTimes(1);
    expect(mockCloseActiveContext).toHaveBeenCalledWith('manual_close');

    alertSpy.mockRestore();
  });

  it('P-05: conserva síntomas libres como historial y dirige las capturas nuevas al ePRO', async () => {
    await render(<SymptomDataScreen />);
    expect(screen.getByText('Historial de síntomas libres')).toBeTruthy();
    expect(screen.queryByLabelText('Describe el síntoma')).toBeNull();
    expect(screen.getByRole('button', { name: 'Abrir seguimiento ePRO' })).toBeTruthy();
  });

  it('RegisterVitalsDataScreen conserva Volver y una sola acción de guardar al pie', async () => {
    mockNavIndex = 1;
    await render(<RegisterVitalsDataScreen />);

    await fireEvent.press(screen.getByLabelText('Volver'));
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
    expect(mockRouterPush).not.toHaveBeenCalled();

    expect(screen.queryByText('Ver historial de mediciones')).toBeNull();
    expect(screen.getByRole('button', { name: 'Guardar registro' })).toBeTruthy();
  });

  it('handleHomeTabPress despacha popToTop dirigido solo a la pila de (inicio) cuando index > 0 y solicita scroll a y=0', () => {
    const dispatch = jest.fn();
    handleHomeTabPress({
      getState: () => ({
        routes: [
          {
            name: '(inicio)',
            state: {
              key: 'stack-inicio-key-123',
              index: 2,
              routes: [
                { name: 'index' },
                { name: 'perfil/index' },
                { name: 'perfil/preferencias' },
              ],
            },
          },
          {
            name: 'vitales',
            state: {
              key: 'stack-vitales-key-456',
              index: 1,
              routes: [{ name: 'index' }, { name: 'detalle' }],
            },
          },
        ],
      }),
      dispatch,
    });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'POP_TO_TOP',
      target: 'stack-inicio-key-123',
    });
    expect(consumeHomeScrollToTop()).toBe(true);
  });

  it('handleHomeTabPress no despacha popToTop cuando la pila de (inicio) está en su raíz o aún no existe', () => {
    const dispatch = jest.fn();
    handleHomeTabPress({
      getState: () => ({
        routes: [
          {
            name: '(inicio)',
            state: {
              key: 'stack-inicio-key-123',
              index: 0,
              routes: [{ name: 'index' }],
            },
          },
        ],
      }),
      dispatch,
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(consumeHomeScrollToTop()).toBe(true);

    // Pila aún no creada por carga diferida
    handleHomeTabPress({
      getState: () => ({
        routes: [{ name: '(inicio)' }],
      }),
      dispatch,
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(consumeHomeScrollToTop()).toBe(true);
  });
});

describe('Área segura inferior de pantallas', () => {
  it('protege los botones inferiores fuera de las pestañas con el inset del teléfono', async () => {
    await render(
      <Screen title="Pantalla de prueba" bottomAction={<Text>Guardar</Text>}>
        <Text>Contenido</Text>
      </Screen>,
    );
    expect(screen.getByTestId('screen-safe-area').props.edges.bottom).toBe('additive');
    expect(screen.getByText('Guardar')).toBeTruthy();
  });
  it('evita duplicar el margen cuando las pestañas ya protegen el borde inferior', async () => {
    await render(
      <ScreenBottomInsetHandledContext.Provider value>
        <Screen title="Pantalla de prueba">
          <Text>Contenido</Text>
        </Screen>
      </ScreenBottomInsetHandledContext.Provider>,
    );
    expect(screen.getByTestId('screen-safe-area').props.edges.bottom).toBe('off');
  });
});

describe('Inicio con horarios de agenda compartida', () => {
  const originalData = mockUseLocalData();
  const rule: GatewayRecordatorio = {
    id: 'ed21a163-0102-4b25-98af-4b3552cc87ad',
    tipo: 'signos',
    titulo: 'Medición',
    zona_horaria: 'America/Santiago',
    horas: ['08:00', '09:00'],
    dias_semana: [1, 2, 3, 4, 5, 6, 7],
    fecha_inicio: '2026-01-01',
    fecha_fin: null,
    activo: true,
    version: 1,
    creado_en: '2026-10-01T00:00:00Z',
    actualizado_en: '2026-10-01T00:00:00Z',
    canal: 'push_con_respaldo_local',
    respaldo_segundos: 120,
  };
  const jobs = ['0800', '0900'].map((time) => ({
    occurrence_id: rule.id + ':1:2026-11-04:' + time,
    native_id: 'native-' + time,
    state: 'scheduled',
  }));
  const read = jest.fn();
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-11-04T10:59:30Z'));
    read.mockResolvedValue({ rules: [rule], completed: new Set() });
    const data = {
      ...originalData,
      sharedAgenda: { read, assert: jest.fn() },
      agendaCoordinator: {
        binding: { owner: 'owner-a', environment: 'test', sessionId: 'session-a' },
        coverage: async () => ({ permission: true, nativeIds: jobs.map((j) => j.native_id) }),
      },
      database: { all: async () => jobs },
    };
    mockUseLocalData.mockReturnValue(data);
  });
  afterEach(() => {
    cleanup();
    mockUseLocalData.mockReturnValue(originalData);
    jest.restoreAllMocks();
    jest.useRealTimers();
  });
  it('muestra la hora elegida sin sumar los dos minutos del respaldo', async () => {
    await render(<HomeScreen />);
    expect(await screen.findByText('Hoy a las 08:00')).toBeTruthy();
    expect(screen.queryByText('Hoy a las 08:02')).toBeNull();
  });
  it('pasa al siguiente horario al llegar la hora, sin salir de Inicio', async () => {
    await render(<HomeScreen />);
    await screen.findByText(/Hoy a las/);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(30_100);
    });
    expect(await screen.findByText('Hoy a las 09:00')).toBeTruthy();
  });
  it('refresca el próximo horario al volver a primer plano después de un salto de reloj', async () => {
    const listeners: Array<() => void> = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      listeners.push(() => listener('active'));
      return { remove: jest.fn() };
    });
    await render(<HomeScreen />);
    await screen.findByText(/Hoy a las/);
    jest.setSystemTime(new Date('2026-11-04T11:05:00Z'));
    await act(async () => {
      for (const listener of listeners) listener();
    });
    expect(await screen.findByText('Hoy a las 09:00')).toBeTruthy();
  });
});
