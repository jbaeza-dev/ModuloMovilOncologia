/// <reference types="jest" />

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
  configure,
} from '@testing-library/react-native';
import React, { useEffect } from 'react';
import { DatabaseSync } from 'node:sqlite';
import { AppState } from 'react-native';
import type { SqlValue } from '../data/local/core/sql';

jest.setTimeout(15000);
jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
  getNetworkStateAsync: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
}));
configure({ asyncUtilTimeout: 8000 });

// Router history simulation for Stack and navigation tests
const mockRouteHistory: string[] = ['/'];
const mockRouter = {
  push: jest.fn((to: string) => {
    mockRouteHistory.push(to);
  }),
  replace: jest.fn((to: string) => {
    mockRouteHistory[mockRouteHistory.length - 1] = to;
  }),
  navigate: jest.fn((to: string) => {
    mockRouteHistory.push(to);
  }),
  back: jest.fn(() => {
    if (mockRouteHistory.length > 1) {
      mockRouteHistory.pop();
    }
  }),
  canGoBack: jest.fn(() => mockRouteHistory.length > 1),
};

let mockUuidCounter = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => `mock-uuid-${++mockUuidCounter}`),
}));

jest.mock('../services/session/native-session', () => ({
  createMobileSession: () => {
    // The historical context suite tests local teardown, not remote authentication.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { HttpSessionAdapter } = require('../services/session/http-session-adapter');
    return new HttpSessionAdapter();
  },
  createDeviceClient: jest.fn(),
  registerNativePush: jest.fn(),
}));
jest.mock('../services/agenda/native-agenda', () => ({
  activateNativeAgenda: jest.fn(async () => null),
  handleAgendaNotification: jest.fn(async () => null),
}));

// The provider keeps real lifecycle/SQL behavior; only native transport and SDK opening
// are replaced in this UI suite. Android tests verify their real implementations.
jest.mock('../services/session/http-session-adapter', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DemoSessionAdapter } = require('../services/session/demo-session-adapter');
  return {
    HttpSessionAdapter: class extends DemoSessionAdapter {
      config = { mode: 'demo', scope: 'ui-test', clinicalUrl: 'http://clinical.test' };
      signal = new AbortController().signal;
      getContextSignal = () => this.signal;
      request = async () => ({ status: 503, body: {} });
      subscribe = () => () => {};
      snapshot = {
        state: 'no_identity',
        user: null,
        identity: null,
        stale: true,
        consent: null,
        terms: null,
        uploadAllowed: false,
        message: null,
        revision: 0,
      };
      getSnapshot = () => this.snapshot;
      publicTerms = async () => {};
      refreshIdentity = async () => {};
    },
  };
});
// This historical lifecycle suite injects a transport double; HTTP contracts are tested separately.
jest.mock('../services/assistant/http-assistant-adapter', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { FakeAssistantAdapter } = require('../services/assistant/fake-assistant-adapter');
  return {
    HttpAssistantAdapter: class extends FakeAssistantAdapter {
      constructor() {
        super({ simulatedDelayMs: 10 });
      }
    },
  };
});
jest.mock('../data/sync/native-runtime', () => ({
  openClinicalStore: async (
    session: { getCurrentUser: () => { id: string } },
    patientId: string,
  ) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createExpoConnection } = require('../data/local/core/expo-connection');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { migrateDatabase } = require('../data/local/migrations');
    mockActiveDbInstance = mockCreateFakeNativeDatabase();
    const native = mockActiveDbInstance;
    const connection = createExpoConnection(native);
    await migrateDatabase(connection);
    await connection.run(
      'INSERT INTO paciente_cache(paciente_id,nombre,obtenido_en) VALUES (?,?,?)',
      [patientId, 'Synthetic UI patient', new Date().toISOString()],
    );
    const store = {
      connection,
      scope: { localPatientId: patientId, owner: session.getCurrentUser().id },
      closed: false,
      database: { onChange: () => () => {} },
      close: async () => {
        store.closed = true;
        await native.closeAsync();
      },
    };
    return store;
  },
}));

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');

  function Protected({ guard, children }: { guard: boolean; children: React.ReactNode }) {
    if (!guard) {
      for (let i = mockRouteHistory.length - 1; i >= 0; i--) {
        if (mockRouteHistory[i].startsWith('/(tabs)')) {
          mockRouteHistory.splice(i, 1);
        }
      }
      return null;
    }
    return React.createElement(React.Fragment, null, children);
  }

  function Screen({ name }: { name: string }) {
    return React.createElement(View, {
      testID: `screen-${name}`,
      accessibilityLabel: `screen-${name}`,
    });
  }

  function StackComponent({ children }: { children: React.ReactNode }) {
    return React.createElement(View, { testID: 'root-stack' }, children);
  }
  StackComponent.Protected = Protected;
  StackComponent.Screen = Screen;

  return {
    router: {
      push: (to: string) => mockRouter.push(to),
      replace: (to: string) => mockRouter.replace(to),
      navigate: (to: string) => mockRouter.navigate(to),
      back: () => mockRouter.back(),
      canGoBack: () => mockRouter.canGoBack(),
    },
    useRouter: () => mockRouter,
    useSegments: () => {
      const current = mockRouteHistory[mockRouteHistory.length - 1] || '/';
      return current.split('/').filter(Boolean);
    },
    useLocalSearchParams: () => ({}),
    useFocusEffect: (cb: () => void | (() => void)) => {
      React.useEffect(() => {
        return cb();
      }, [cb]);
    },
    Stack: StackComponent,
  };
});

jest.mock('expo-router/react-navigation', () => ({
  useNavigationState: (selector: (state: { index: number }) => unknown) =>
    selector({ index: Math.max(0, mockRouteHistory.length - 1) }),
}));

// Mock expo-sqlite with in-memory DatabaseSync
type SqlParam = null | number | bigint | string | Uint8Array;
type FakeTx = {
  execAsync: (s: string) => Promise<void>;
  runAsync: (s: string, p?: unknown[]) => Promise<{ changes: number; lastInsertRowId: number }>;
  getFirstAsync: (s: string, p?: unknown[]) => Promise<unknown>;
  getAllAsync: (s: string, p?: unknown[]) => Promise<unknown[]>;
};

function mockCreateFakeNativeDatabase() {
  const db = new DatabaseSync(':memory:');
  return {
    execAsync: async (sql: string) => {
      db.exec(sql);
    },
    runAsync: async (sql: string, params: unknown[] = []) => {
      const res = db.prepare(sql).run(...(params as unknown as SqlParam[]));
      return { changes: Number(res.changes), lastInsertRowId: Number(res.lastInsertRowid) };
    },
    getFirstAsync: async (sql: string, params: unknown[] = []) => {
      return db.prepare(sql).get(...(params as unknown as SqlParam[])) ?? null;
    },
    getAllAsync: async (sql: string, params: unknown[] = []) => {
      return db.prepare(sql).all(...(params as unknown as SqlParam[]));
    },
    withExclusiveTransactionAsync: async (work: (tx: FakeTx) => Promise<void>) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const txObj: FakeTx = {
          execAsync: async (s: string) => db.exec(s),
          runAsync: async (s: string, p: unknown[] = []) => {
            const r = db.prepare(s).run(...(p as unknown as SqlParam[]));
            return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
          },
          getFirstAsync: async (s: string, p: unknown[] = []) =>
            db.prepare(s).get(...(p as unknown as SqlParam[])) ?? null,
          getAllAsync: async (s: string, p: unknown[] = []) =>
            db.prepare(s).all(...(p as unknown as SqlParam[])),
        };
        await work(txObj);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    closeAsync: async () => {
      try {
        db.close();
      } catch {
        // ignore
      }
    },
  };
}

let mockActiveDbInstance: ReturnType<typeof mockCreateFakeNativeDatabase> | null = null;
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(async () => {
    mockActiveDbInstance = mockCreateFakeNativeDatabase();
    return mockActiveDbInstance;
  }),
}));

// Mock expo-notifications with in-memory store and real listener capture
const mockScheduledNotifications = new Map<string, unknown>();
const mockNotificationResponseListeners: Array<
  (response: {
    notification: {
      request: {
        identifier: string;
        content: { data: unknown };
      };
    };
  }) => void
> = [];

const mockAppStateListeners: Array<(state: string) => void> = [];
jest.spyOn(AppState, 'addEventListener').mockImplementation((event: string, handler: unknown) => {
  if (event === 'change') {
    mockAppStateListeners.push(handler as (state: string) => void);
  }
  return {
    remove: jest.fn(() => {
      const idx = mockAppStateListeners.indexOf(handler as (state: string) => void);
      if (idx !== -1) mockAppStateListeners.splice(idx, 1);
    }),
  } as unknown as ReturnType<typeof AppState.addEventListener>;
});

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  SchedulableTriggerInputTypes: { DATE: 'date' },
  AndroidImportance: { NONE: 0, DEFAULT: 3, HIGH: 4 },
  getNotificationChannelAsync: jest.fn().mockResolvedValue({
    importance: 4,
  }),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(null),
  getPermissionsAsync: jest.fn().mockResolvedValue({
    status: 'granted',
    granted: true,
    canAskAgain: true,
  }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({
    status: 'granted',
    granted: true,
    canAskAgain: true,
  }),
  getAllScheduledNotificationsAsync: jest.fn(async () =>
    Array.from(mockScheduledNotifications.values()),
  ),
  scheduleNotificationAsync: jest.fn(async ({ content, trigger }) => {
    const id = 'notif-' + Math.random().toString(36).slice(2, 9);
    mockScheduledNotifications.set(id, { identifier: id, content, trigger });
    return id;
  }),
  cancelScheduledNotificationAsync: jest.fn(async (id: string) => {
    mockScheduledNotifications.delete(id);
  }),
  addNotificationResponseReceivedListener: jest.fn((listener) => {
    mockNotificationResponseListeners.push(listener);
    return {
      remove: jest.fn(() => {
        const idx = mockNotificationResponseListeners.indexOf(listener);
        if (idx !== -1) mockNotificationResponseListeners.splice(idx, 1);
      }),
    };
  }),
  addNotificationReceivedListener: jest.fn(() => ({
    remove: jest.fn(),
  })),
  getLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
}));

// Mock environment as demo
jest.mock('../utils/environment', () => ({
  isDemoMode: () => true,
  getEnvironmentConfig: () => ({ mode: 'demo' }),
}));

// Mock ThemeProvider
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
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { ContextGuard } from '../components/ContextGuard';
import { LoginScreen, RegisterScreen, AccessConsentScreen } from '../features/access/AccessScreens';
import { AssistantScreen } from '../features/assistant/AssistantScreen';
import { AppNavigator } from '../app/_layout';
import { LocalDataProvider, DEMO_PATIENTS, useLocalData } from '../providers/LocalDataProvider';
import { FakeAssistantAdapter } from '../services/assistant/fake-assistant-adapter';
import { UnconfiguredSessionAdapter } from '../services/session/unconfigured-session-adapter';
import { UnconfiguredAssistantAdapter } from '../services/assistant/unconfigured-assistant-adapter';
import { AssistantFailure, type AssistantMessage } from '../services/assistant/assistant-types';

type LocalDataContext = ReturnType<typeof useLocalData>;

// Test consumer to access context methods during provider tests
function ContextConsumer({ onReady }: { onReady: (ctx: LocalDataContext) => void }) {
  const ctx = useLocalData();
  useEffect(() => {
    onReady(ctx);
  }, [ctx, onReady]);
  return null;
}

describe('Incremento 6: UI de Acceso, Navegación Raíz, Sesión y Asistente', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteHistory.length = 0;
    mockRouteHistory.push('/');
    mockScheduledNotifications.clear();
    mockNotificationResponseListeners.length = 0;
    mockAppStateListeners.length = 0;
  });

  afterEach(() => {
    cleanup();
  });

  describe('Navegador Raíz y Stack.Protected en Producción', () => {
    it('reopens storage after authenticating the same account and retires the prior connector', async () => {
      const holder = { current: null as LocalDataContext | null };
      await render(
        <LocalDataProvider>
          <ContextConsumer
            onReady={(ctx) => {
              holder.current = ctx;
            }}
          />
        </LocalDataProvider>,
      );
      await waitFor(() => expect(holder.current).toBeTruthy());
      await act(async () => {
        await holder.current!.selectPatient(DEMO_PATIENTS[0].id);
      });
      await waitFor(() => expect(holder.current?.clinicalStore).toBeTruthy());
      const previous = holder.current!.clinicalStore;
      await act(async () => {
        await holder.current!.selectPatient(DEMO_PATIENTS[0].id);
      });
      await waitFor(() => {
        expect(holder.current?.clinicalStore).toBeTruthy();
        expect(holder.current?.clinicalStore).not.toBe(previous);
      });
      expect(previous?.closed).toBe(true);
      expect(holder.current!.patientId).toBe(DEMO_PATIENTS[0].id);
    });
    it('sin paciente activo, Stack.Protected excluye (tabs) y AppNavigator redirige si se accede a tabs', async () => {
      mockRouteHistory[0] = '/(tabs)';

      await render(
        <LocalDataProvider>
          <AppNavigator />
        </LocalDataProvider>,
      );

      // Esperar a que la base de datos abra
      expect(await screen.findByTestId('root-stack')).toBeTruthy();

      // (tabs) DEBE estar excluido de la jerarquía protegida
      expect(screen.queryByTestId('screen-(tabs)')).toBeNull();
      // Las rutas públicas están disponibles
      expect(screen.getByTestId('screen-acceso')).toBeTruthy();

      // AppNavigator detecta ausencia de paciente en (tabs) y redirige
      await waitFor(() => {
        expect(mockRouter.replace).toHaveBeenCalledWith('/acceso/seleccionar-paciente');
      });
    });

    it('al seleccionar paciente de prueba, Stack.Protected habilita (tabs)', async () => {
      let contextRef: ReturnType<typeof useLocalData> | null = null;

      await render(
        <LocalDataProvider>
          <AppNavigator />
          <ContextConsumer onReady={(ctx) => (contextRef = ctx)} />
        </LocalDataProvider>,
      );

      expect(await screen.findByTestId('root-stack')).toBeTruthy();
      expect(screen.queryByTestId('screen-(tabs)')).toBeNull();

      // Seleccionar paciente A usando la función de producción
      await act(async () => {
        await contextRef?.selectPatient(DEMO_PATIENTS[0].id);
      });

      // Ahora Stack.Protected DEBE incluir (tabs)
      expect(await screen.findByTestId('screen-(tabs)')).toBeTruthy();
    });

    it('el cierre de contexto desactiva inmediatamente la guarda de Stack.Protected', async () => {
      let contextRef: ReturnType<typeof useLocalData> | null = null;

      await render(
        <LocalDataProvider>
          <AppNavigator />
          <ContextConsumer onReady={(ctx) => (contextRef = ctx)} />
        </LocalDataProvider>,
      );

      await screen.findByTestId('root-stack');

      await act(async () => {
        await contextRef?.selectPatient(DEMO_PATIENTS[0].id);
      });

      expect(screen.getByTestId('screen-(tabs)')).toBeTruthy();

      // Iniciar cierre de contexto manual
      await act(async () => {
        await contextRef?.closeActiveContext('manual_close');
      });

      // La guarda cae inmediatamente: (tabs) ya no debe estar montado
      expect(screen.queryByTestId('screen-(tabs)')).toBeNull();
      expect(mockRouter.replace).toHaveBeenCalledWith('/acceso');
    });

    it('el historial de navegación y botón Atrás conservan la ruta previa', async () => {
      mockRouteHistory.length = 0;
      mockRouteHistory.push('/');

      mockRouter.navigate('/acceso');
      expect([...mockRouteHistory]).toEqual(['/', '/acceso']);

      mockRouter.navigate('/acceso/consentimientos');
      expect([...mockRouteHistory]).toEqual(['/', '/acceso', '/acceso/consentimientos']);

      mockRouter.back();
      expect([...mockRouteHistory]).toEqual(['/', '/acceso']);
    });

    it('aislamiento completo de navegación: paciente A -> pantalla privada profunda -> cambio a B -> botón Atrás no restaura pantalla privada de A', async () => {
      mockRouteHistory.length = 0;
      mockRouteHistory.push('/');
      const contextHolder = { current: null as LocalDataContext | null };

      await render(
        <LocalDataProvider>
          <AppNavigator />
          <ContextConsumer onReady={(ctx) => (contextHolder.current = ctx)} />
        </LocalDataProvider>,
      );

      await screen.findByTestId('root-stack');

      // 1. Activar Paciente A
      await act(async () => {
        await contextHolder.current?.selectPatient(DEMO_PATIENTS[0].id);
      });
      expect(contextHolder.current?.patientId).toBe(DEMO_PATIENTS[0].id);
      expect(contextHolder.current?.sessionAdapter.getCurrentUser()?.id).toBe(DEMO_PATIENTS[0].id);

      // 2. Navegar a una ruta privada profunda de Paciente A
      mockRouter.navigate('/(tabs)/recordatorios');
      expect(mockRouteHistory).toContain('/(tabs)/recordatorios');

      // 3. Conmutar a Paciente B
      await act(async () => {
        await contextHolder.current?.selectPatient(DEMO_PATIENTS[1].id);
      });

      // 4. Verificar que ambas identidades coinciden en Paciente B y la sesión está activa
      expect(contextHolder.current?.patientId).toBe(DEMO_PATIENTS[1].id);
      expect(contextHolder.current?.sessionAdapter.getCurrentUser()?.id).toBe(DEMO_PATIENTS[1].id);
      expect(contextHolder.current?.sessionAdapter.getState()).toBe('context_ready');

      // 5. Presionar botón Atrás: el historial de A fue purgado y no restaura pantallas privadas previas de A
      mockRouter.back();
      expect(mockRouteHistory).not.toContain('/(tabs)/recordatorios');
    });
  });

  describe('Acceso Público y Bienvenida (Vista 01)', () => {
    it('LoginScreen presenta la bienvenida con MascotHero (pose saludo), sin campos falsos de correo/contraseña y acceso a términos', async () => {
      await render(<LoginScreen />);

      expect(await screen.findByText('VISTA DE DEMOSTRACIÓN · DATOS FICTICIOS')).toBeTruthy();
      expect(await screen.findByText('QUIMIOCARE · CONTIGO EN CASA')).toBeTruthy();
      expect(await screen.findByText('Te damos la bienvenida.')).toBeTruthy();
      expect(
        screen.getByTestId('mascot-avatar-saludo', { includeHiddenElements: true }),
      ).toBeTruthy();

      // No expone campos falsos de correo o contraseña en la bienvenida rediseñada
      expect(
        screen.queryByLabelText('Correo electrónico (deshabilitado · sin servicio central)'),
      ).toBeNull();
      expect(
        screen.queryByLabelText('Contraseña (deshabilitado · sin servicio central)'),
      ).toBeNull();

      const selectBtn = screen.getByText('Seleccionar paciente de prueba');
      await fireEvent.press(selectBtn);
      expect(mockRouter.push).toHaveBeenCalledWith('/acceso/seleccionar-paciente');

      const termsCard = screen.getByLabelText('Términos y consentimiento informado');
      await fireEvent.press(termsCard);
      expect(mockRouter.push).toHaveBeenCalledWith('/acceso/consentimientos');
    });

    it('RegisterScreen renderiza campos de registro deshabilitados', async () => {
      await render(<RegisterScreen />);

      expect(await screen.findByText('Registro de usuarios')).toBeTruthy();

      const nameInput = screen.getByLabelText('Nombre (deshabilitado · sin servicio central)');
      expect(nameInput.props.editable).toBe(false);

      const emailInput = screen.getByLabelText(
        'Correo electrónico (deshabilitado · sin servicio central)',
      );
      expect(emailInput.props.editable).toBe(false);

      const passwordInput = screen.getByLabelText(
        'Contraseña (deshabilitado · sin servicio central)',
      );
      expect(passwordInput.props.editable).toBe(false);

      const consentBtn = screen.getByText('Ver consentimientos');
      await fireEvent.press(consentBtn);
      expect(mockRouter.push).toHaveBeenCalledWith('/acceso/consentimientos');
    });

    it('ContextGuard permite seleccionar paciente cuando isClosing es false y se deshabilita cuando isClosing es true', async () => {
      const onSelect = jest.fn();
      await render(<ContextGuard isClosing={false} onSelectPatient={onSelect} />);

      const patientABtn = await screen.findByText('Paciente de prueba A');
      await fireEvent.press(patientABtn);
      expect(onSelect).toHaveBeenCalledWith(DEMO_PATIENTS[0].id);

      await screen.rerender(<ContextGuard isClosing={true} onSelectPatient={onSelect} />);
      expect(await screen.findByText('Cerrando contexto anterior…')).toBeTruthy();
      onSelect.mockClear();
      await fireEvent.press(screen.getByText('Paciente de prueba A'));
      expect(onSelect).not.toHaveBeenCalled();
    });
  });

  describe('Asistente QuimioCare (AssistantScreen)', () => {
    it('muestra orientación demostrativa general sin contenido clínico prescriptivo', async () => {
      await render(
        <LocalDataProvider>
          <AssistantScreen />
        </LocalDataProvider>,
      );

      expect(
        await screen.findByText('Orientación educativa. No reemplaza a tu equipo de salud.'),
      ).toBeTruthy();
      expect(await screen.findByText('0 / 2000')).toBeTruthy();
    });

    it('conserva el aviso con no_disponible, fuentes y urgencia sin afirmar un aviso profesional', async () => {
      let contextRef = {} as LocalDataContext;
      await render(
        <LocalDataProvider>
          <AssistantScreen />
          <ContextConsumer
            onReady={(ctx) => {
              contextRef = ctx;
            }}
          />
        </LocalDataProvider>,
      );
      await waitFor(() => {
        expect(contextRef.assistantController).toBeTruthy();
      });
      const metadata = {
        respuesta: 'Resultado de prueba no disponible.',
        fuentes: [{ tema_id: 'fuente', guia: 1, tema: 'Guía sintética' }],
        requiere_urgencia: true,
        confianza_nivel: 'baja',
        estado_respuesta: 'no_disponible' as const,
        debug: null,
      };
      await act(async () => {
        contextRef.assistantController?.setAdapter({
          isConfigured: true,
          sendMessage: async () => ({
            replyText: metadata.respuesta,
            isDemo: true,
            requestId: 'consulta-sintetica',
            response: metadata,
          }),
        });
      });
      await fireEvent.changeText(screen.getByLabelText('Escribe tu consulta'), 'consulta');
      await fireEvent.press(screen.getByText('Enviar consulta'));
      expect(await screen.findByText('Asistente no disponible')).toBeOnTheScreen();
      expect(screen.getByText('Fuentes: Guía sintética (guía 1)')).toBeOnTheScreen();
      expect(screen.getByText(/Confianza informada: baja/)).toBeOnTheScreen();
      expect(screen.getByRole('alert')).toHaveTextContent(
        /QuimioCare no ha avisado a profesionales\./,
      );
      expect(
        screen.getByText('Orientación educativa. No reemplaza a tu equipo de salud.'),
      ).toBeOnTheScreen();
    });
    it('conserva el aviso permanente al mostrar detail de un error contractual', async () => {
      let contextRef = {} as LocalDataContext;
      await render(
        <LocalDataProvider>
          <AssistantScreen />
          <ContextConsumer
            onReady={(ctx) => {
              contextRef = ctx;
            }}
          />
        </LocalDataProvider>,
      );
      await waitFor(() => {
        expect(contextRef.assistantController).toBeTruthy();
      });
      await act(async () => {
        contextRef.assistantController?.setAdapter({
          isConfigured: true,
          sendMessage: async () => {
            throw new AssistantFailure('server_error', 503, {
              detail: 'Servicio sintético indisponible.',
            });
          },
        });
      });
      await fireEvent.changeText(screen.getByLabelText('Escribe tu consulta'), 'consulta');
      await fireEvent.press(screen.getByText('Enviar consulta'));
      expect(await screen.findByText('Servicio sintético indisponible.')).toBeOnTheScreen();
      expect(
        screen.getByText('Orientación educativa. No reemplaza a tu equipo de salud.'),
      ).toBeOnTheScreen();
    });
    it('al cancelar la consulta en curso, restaura el texto previo en el campo de entrada', async () => {
      let contextRef = {} as LocalDataContext;

      await render(
        <LocalDataProvider>
          <AssistantScreen />
          <ContextConsumer onReady={(ctx) => (contextRef = ctx)} />
        </LocalDataProvider>,
      );

      contextRef.assistantController?.setAdapter(
        new FakeAssistantAdapter({ simulatedDelayMs: 4000 }),
      );

      const input = await screen.findByLabelText('Escribe tu consulta');
      await fireEvent.changeText(input, '¿Cuáles son las recomendaciones generales?');

      const sendBtn = screen.getByText('Enviar consulta');
      await fireEvent.press(sendBtn);

      expect(await screen.findByText('Procesando consulta…')).toBeTruthy();
      const cancelBtn = screen.getByText('Cancelar');

      await fireEvent.press(cancelBtn);

      // El campo de texto DEBE haber recuperado la consulta
      expect(input.props.value).toBe('¿Cuáles son las recomendaciones generales?');
      expect(await screen.findByText('Consulta cancelada')).toBeTruthy();
    });

    it('desmontar la pantalla mientras hay una solicitud en curso aborta el intento', async () => {
      let contextRef = {} as LocalDataContext;

      await render(
        <LocalDataProvider>
          <AssistantScreen />
          <ContextConsumer onReady={(ctx) => (contextRef = ctx)} />
        </LocalDataProvider>,
      );

      contextRef.assistantController?.setAdapter(
        new FakeAssistantAdapter({ simulatedDelayMs: 5000 }),
      );

      const input = await screen.findByLabelText('Escribe tu consulta');
      await fireEvent.changeText(input, 'Consulta que será interrumpida');

      await fireEvent.press(screen.getByText('Enviar consulta'));

      const controller = contextRef.assistantController;
      expect(controller?.getState()).toBe('sending');

      // Desmontar el componente
      await screen.unmount();

      // El intento en curso debe haber sido abortado
      expect(controller?.getState()).not.toBe('sending');
      expect(controller?.getMessages()).toEqual([]);
      expect(controller?.getLastSubmittedText()).toBeNull();
    });

    it('muestra estado sin conexión con botón de reintento si el adaptador simula offline', async () => {
      let contextRef = {} as LocalDataContext;

      await render(
        <LocalDataProvider>
          <AssistantScreen />
          <ContextConsumer onReady={(ctx) => (contextRef = ctx)} />
        </LocalDataProvider>,
      );

      const input = await screen.findByLabelText('Escribe tu consulta');

      contextRef.assistantController?.setAdapter(
        new FakeAssistantAdapter({ shouldSimulateOffline: true }),
      );
      await fireEvent.changeText(input, 'Consulta sin red');

      await fireEvent.press(screen.getByText('Enviar consulta'));

      // Esperar respuesta offline
      expect(await screen.findByText('Sin conexión')).toBeTruthy();
      expect(screen.getByText('Reintentar consulta')).toBeTruthy();
    });

    it('muestra estado no configurado previo al ingreso y no permite enviar consultas', async () => {
      let contextRef = {} as LocalDataContext;

      await render(
        <LocalDataProvider>
          <AssistantScreen />
          <ContextConsumer onReady={(ctx) => (contextRef = ctx)} />
        </LocalDataProvider>,
      );

      await waitFor(() => {
        expect(contextRef.assistantController).toBeTruthy();
      });

      // Cambiar a adaptador no configurado
      await act(async () => {
        contextRef.assistantController?.setAdapter(new UnconfiguredAssistantAdapter());
      });

      // Debe mostrar el estado no configurado sin permitir escribir
      expect(await screen.findByText('Servicio no configurado')).toBeTruthy();
      expect(
        screen.getByText(
          'El servicio del asistente central no está configurado en este entorno. No es posible enviar consultas en este momento.',
        ),
      ).toBeTruthy();
      expect(screen.getByText('Volver')).toBeTruthy();
      expect(screen.queryByLabelText('Escribe tu consulta')).toBeNull();
      expect(screen.queryByText('Enviar consulta')).toBeNull();
    });

    it('identifica remitentes accesibles Tú y Asistente y alerta de límite cercano', async () => {
      let contextRef = {} as LocalDataContext;

      await render(
        <LocalDataProvider>
          <AssistantScreen />
          <ContextConsumer onReady={(ctx) => (contextRef = ctx)} />
        </LocalDataProvider>,
      );

      await waitFor(() => {
        expect(contextRef.assistantController).toBeTruthy();
      });

      await act(async () => {
        contextRef.assistantController?.setAdapter(
          new FakeAssistantAdapter({
            simulatedDelayMs: 10,
            customReply: 'Respuesta de prueba accesible',
          }),
        );
      });

      const input = await screen.findByLabelText('Escribe tu consulta');

      // Probar alerta de límite cercano (>1800 caracteres)
      const nearLimitText = 'a'.repeat(1850);
      await fireEvent.changeText(input, nearLimitText);
      expect(await screen.findByText(/1850 \/ 2000 \(límite cercano\)/)).toBeTruthy();

      // Enviar consulta corta
      await fireEvent.changeText(input, '¿Cómo tomar mi medicamento?');
      await fireEvent.press(screen.getByText('Enviar consulta'));

      // Verificar burbuja del usuario con etiqueta accesible identificando remitente
      expect(await screen.findByLabelText('Tú: ¿Cómo tomar mi medicamento?')).toBeTruthy();

      // Esperar respuesta del asistente
      expect(await screen.findByLabelText('Asistente: Respuesta de prueba accesible')).toBeTruthy();

      // Verificar anuncio en live region con identificador único y texto preview
      expect(
        await screen.findByText(
          /Nueva respuesta del asistente \(#\d+\): Respuesta de prueba accesible/,
        ),
      ).toBeTruthy();
    });

    it('detecta respuestas del asistente y genera anuncios vivos incluso cuando se alcanza el tope de 50 mensajes', async () => {
      let contextRef = {} as LocalDataContext;

      await render(
        <LocalDataProvider>
          <AssistantScreen />
          <ContextConsumer onReady={(ctx) => (contextRef = ctx)} />
        </LocalDataProvider>,
      );

      await waitFor(() => {
        expect(contextRef.assistantController).toBeTruthy();
      });

      const ctrl = contextRef.assistantController!;
      ctrl.setAdapter(
        new FakeAssistantAdapter({
          simulatedDelayMs: 10,
          customReply: 'Respuesta número 51 detectada',
        }),
      );

      // Pre-cargar 50 mensajes en el controlador
      const preloadedMessages: AssistantMessage[] = [];
      for (let i = 1; i <= 25; i++) {
        preloadedMessages.push(
          {
            id: `user-msg-${i}`,
            sender: 'user',
            text: `Pregunta ${i}`,
            timestamp: new Date().toISOString(),
          },
          {
            id: `asst-msg-${i}`,
            sender: 'assistant',
            text: `Respuesta ${i}`,
            timestamp: new Date().toISOString(),
          },
        );
      }
      expect(preloadedMessages).toHaveLength(50);
      await act(async () => {
        (ctrl as unknown as { messages: unknown[] }).messages = preloadedMessages;
        (ctrl as unknown as { notify: () => void }).notify();
      });

      await waitFor(() => {
        expect(screen.getByText('Pregunta 25')).toBeTruthy();
      });

      // Enviar una consulta adicional desde la interfaz
      const input = await screen.findByLabelText('Escribe tu consulta');
      await fireEvent.changeText(input, 'Consulta adicional en límite de 50');
      await fireEvent.press(screen.getByText('Enviar consulta'));

      // El tamaño total sigue siendo 50 debido al descarte FIFO
      await waitFor(() => {
        expect(ctrl.getMessages()).toHaveLength(50);
        expect(screen.getByText('Respuesta número 51 detectada')).toBeTruthy();
      });

      // Se detectó correctamente la nueva respuesta y se anunció
      expect(
        await screen.findByText(
          /Nueva respuesta del asistente \(#\d+\): Respuesta número 51 detectada/,
        ),
      ).toBeTruthy();
    });
  });

  describe('Cierre por session_required con SQLite abierto (Punto 1)', () => {
    it('el cierre provocado por session_required cancela la agenda usando el coordinador activo', async () => {
      let contextRef = {} as LocalDataContext;

      await render(
        <LocalDataProvider>
          <AppNavigator />
          <ContextConsumer onReady={(ctx) => (contextRef = ctx)} />
        </LocalDataProvider>,
      );

      // Esperar que SQLite abra e inicialice el contexto
      expect(await screen.findByTestId('root-stack')).toBeTruthy();

      // Seleccionar paciente A
      await act(async () => {
        await contextRef.selectPatient(DEMO_PATIENTS[0].id);
      });

      await waitFor(() => expect(contextRef.database).toBeTruthy());
      expect(contextRef.patientId).toBe(DEMO_PATIENTS[0].id);
      const coordinator = contextRef.coordinator;
      expect(coordinator).not.toBeNull();

      // Programar una regla de recordatorio para Paciente A
      await act(async () => {
        await contextRef.repository?.reminders.setPreferences(true);
        await contextRef.repository?.reminders.saveRule({
          tipo: 'registro_vitales',
          diasSemana: [1, 2, 3, 4, 5, 6, 7],
          horasMinutos: ['08:00'],
          zonaHoraria: 'America/Santiago',
          habilitado: true,
        });
        await coordinator?.reconcile(DEMO_PATIENTS[0].id, () => true);
      });

      // Confirmar que hay notificaciones programadas
      expect(mockScheduledNotifications.size).toBeGreaterThan(0);

      // Configurar el adaptador del asistente para que responda con session_required
      const assistantCtrl = contextRef.assistantController;
      expect(assistantCtrl).toBeDefined();

      const sessionRequiredAdapter = new FakeAssistantAdapter({
        shouldSimulateSessionRequired: true,
      });
      assistantCtrl?.setAdapter(sessionRequiredAdapter);

      // Enviar consulta que provocará session_required
      await act(async () => {
        await assistantCtrl?.send('Consulta que expirará');
      });

      // Esperar drenaje de cierre
      await waitFor(() => {
        expect(mockRouter.replace).toHaveBeenCalledWith('/acceso?motivo=sesion_requerida');
        expect(contextRef.patientId).toBeNull();
      });

      // Comprobar que el coordinador activo canceló las notificaciones del paciente saliente
      expect(mockScheduledNotifications.size).toBe(0);
    });
  });

  describe('Consentimientos Informados (S-03)', () => {
    it('AccessConsentScreen never grants local acceptance without verified terms', async () => {
      await render(
        <LocalDataProvider>
          <AccessConsentScreen />
        </LocalDataProvider>,
      );
      expect(await screen.findByText('Consentimientos')).toBeTruthy();
      expect(await screen.findByText('Sin términos verificados disponibles.')).toBeTruthy();
      expect(screen.queryByText('Aceptar términos online')).toBeNull();
    });
  });

  describe('Modo Estándar vs Modo Demostración', () => {
    it('UnconfiguredSessionAdapter opera sin identidades fijas y no expone selección demostrativa', () => {
      const standardSession = new UnconfiguredSessionAdapter();
      expect(standardSession.getState()).toBe('unconfigured');
      expect(standardSession.getCurrentUser()).toBeNull();
      expect(
        (standardSession as unknown as { selectDemoPatient?: unknown }).selectDemoPatient,
      ).toBeUndefined();
    });

    it('UnconfiguredAssistantAdapter emite aviso de servicio no configurado ante mensajes', async () => {
      const standardAssistant = new UnconfiguredAssistantAdapter();
      expect(standardAssistant.isConfigured).toBe(false);
      await expect(
        standardAssistant.sendMessage('Consulta de prueba', {
          requestId: 'req-test-123',
          patientId: 'patient-test-123',
          signal: new AbortController().signal,
        }),
      ).rejects.toThrow('El servicio del asistente no está configurado en este entorno.');
    });
  });

  describe('Recuperación de Notificaciones en Primer Plano con Proveedor Real (S-04)', () => {
    it('el proveedor real recupera y procesa la apertura pendiente al volver a primer plano tras fallo SQL transitorio', async () => {
      let contextRef: ReturnType<typeof useLocalData> | null = null;

      await render(
        <LocalDataProvider>
          <ContextConsumer onReady={(ctx) => (contextRef = ctx)} />
        </LocalDataProvider>,
      );

      // No clinical database is exposed before authentication.
      await waitFor(() => expect(contextRef).toBeTruthy());
      await waitFor(() => expect(contextRef?.database).toBeNull());
      await act(async () => {
        await contextRef?.selectPatient(DEMO_PATIENTS[0].id);
      });
      await waitFor(() => expect(contextRef?.database).toBeTruthy());

      const notifId = 'notif-ui-foreground-1';
      const payload = {
        version: 1,
        notificacionId: notifId,
        pacienteId: DEMO_PATIENTS[0].id,
        recordatorioId: 'rec-ui-1',
        revision: 1,
        tipo: 'registro_vitales',
        destino: '/vitales/registrar',
      };

      // Insertar recordatorio y notificacion_local válida en la base de datos real del proveedor
      await act(async () => {
        const db = contextRef!.database!;
        await db.run(
          `INSERT OR REPLACE INTO recordatorio_local (
             id, paciente_id, tipo, dias_semana, horas_minutos, zona_horaria, habilitado, revision, creado_el, actualizado_el
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            payload.recordatorioId,
            DEMO_PATIENTS[0].id,
            payload.tipo,
            '1,2,3',
            '08:00',
            'America/Santiago',
            1,
            1,
            new Date().toISOString(),
            new Date().toISOString(),
          ],
        );
        await db.run(
          `INSERT OR REPLACE INTO notificacion_local (
             id, paciente_id, recordatorio_id, revision, tipo, fecha_prevista_utc, estado, payload_minimo, creado_el, actualizado_el
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            notifId,
            DEMO_PATIENTS[0].id,
            payload.recordatorioId,
            1,
            payload.tipo,
            new Date().toISOString(),
            'programada',
            JSON.stringify(payload),
            new Date().toISOString(),
            new Date().toISOString(),
          ],
        );
      });

      // Simular fallo transitorio en SQLite (db.first)
      let simulateFailure = true;
      const db = contextRef!.database!;
      const originalFirst = db.first.bind(db);
      db.first = async <T,>(sql: string, params?: SqlValue[]): Promise<T | null> => {
        if (simulateFailure) {
          throw new Error('SQLITE_BUSY: locked');
        }
        return originalFirst(sql, params);
      };

      // Disparar el evento de toque de notificación a través del listener real que registró LocalDataProvider
      expect(mockNotificationResponseListeners.length).toBeGreaterThan(0);
      await act(async () => {
        mockNotificationResponseListeners.forEach((listener) =>
          listener({
            notification: {
              request: {
                identifier: 'channel-test',
                content: { data: payload },
              },
            },
          }),
        );
      });

      // Esperar por condición verificable: la intención debe quedar retenida en el gestor y no haber navegado aún
      await waitFor(() => {
        expect(contextRef?.manager.getPendingNotificationIntent()).not.toBeNull();
      });
      expect(mockRouter.push).not.toHaveBeenCalled();

      // Se resuelve el fallo transitorio en SQLite
      simulateFailure = false;

      // La app vuelve a primer plano (disparando el listener real de AppState suscrito por LocalDataProvider)
      expect(mockAppStateListeners.length).toBeGreaterThan(0);
      await act(async () => {
        mockAppStateListeners.forEach((listener) => listener('active'));
      });

      // Esperar por condición verificable: LocalDataProvider reintenta y navega automáticamente
      await waitFor(() => {
        expect(mockRouter.push).toHaveBeenCalledWith('/vitales/registrar');
        expect(contextRef?.manager.getPendingNotificationIntent()).toBeNull();
      });
    });
  });
});
