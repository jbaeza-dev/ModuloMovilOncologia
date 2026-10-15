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

jest.setTimeout(15000);
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

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => '11111111-2222-4333-8444-555555555555'),
}));

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');

  function Protected({ guard, children }: { guard: boolean; children: React.ReactNode }) {
    if (!guard) return null;
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

// Mock expo-notifications with in-memory store
const mockScheduledNotifications = new Map<string, unknown>();
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
import { LoginScreen, RegisterScreen } from '../features/access/AccessScreens';
import { AssistantScreen } from '../features/assistant/AssistantScreen';
import { AppNavigator } from '../app/_layout';
import { LocalDataProvider, DEMO_PATIENTS, useLocalData } from '../providers/LocalDataProvider';
import { FakeAssistantAdapter } from '../services/assistant/fake-assistant-adapter';

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
  });

  afterEach(() => {
    cleanup();
  });

  describe('Navegador Raíz y Stack.Protected en Producción', () => {
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
      mockRouter.navigate('/acceso');
      expect(mockRouteHistory).toEqual(['/', '/acceso']);

      mockRouter.navigate('/acceso/consentimientos');
      expect(mockRouteHistory).toEqual(['/', '/acceso', '/acceso/consentimientos']);

      mockRouter.back();
      expect(mockRouteHistory).toEqual(['/', '/acceso']);
    });
  });

  describe('Acceso Público y Campos de Credenciales Deshabilitados', () => {
    it('LoginScreen renderiza campos de correo y contraseña deshabilitados sin servicio central', async () => {
      await render(<LoginScreen />);

      expect(await screen.findByText('VISTA DE DEMOSTRACIÓN · DATOS FICTICIOS')).toBeTruthy();
      expect(await screen.findByText('Servicios de acceso')).toBeTruthy();

      const emailInput = screen.getByLabelText(
        'Correo electrónico (deshabilitado · sin servicio central)',
      );
      expect(emailInput.props.editable).toBe(false);

      const passwordInput = screen.getByLabelText(
        'Contraseña (deshabilitado · sin servicio central)',
      );
      expect(passwordInput.props.editable).toBe(false);

      const selectBtn = screen.getByText('Seleccionar paciente de prueba');
      await fireEvent.press(selectBtn);
      expect(mockRouter.navigate).toHaveBeenCalledWith('/acceso/seleccionar-paciente');
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
      expect(mockRouter.navigate).toHaveBeenCalledWith('/acceso/consentimientos');
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
        await screen.findByText(
          'Este asistente ofrece orientación general. No diagnostica, prescribe ni sustituye a tu equipo de salud.',
        ),
      ).toBeTruthy();
      expect(await screen.findByText('0 / 2000')).toBeTruthy();
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

      expect(await screen.findByText('Procesando demostración…')).toBeTruthy();
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
      expect(controller?.getState()).toBe('cancelled');
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
});
