let mockMedications: Array<{
  id: string;
  medicamento_id: string;
  nombre: string;
  activo: boolean;
}> = [];
jest.mock('../features/profile/IdentityProfileScreens', () => ({
  useProfileIdentity: () => ({ identity: { clinicalProfile: { medicamentos: mockMedications } } }),
}));
/// <reference types="jest" />
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
}));
import React from 'react';
import { act, render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react-native';
import { normalizedReminder } from '@quimiocare/contracts/agenda';
import type { GatewayRecordatorio } from '@quimiocare/contracts';
import { SharedAgendaScreen } from '../features/reminders/SharedAgendaScreen';
import { SharedAgendaEditScreen } from '../features/reminders/SharedAgendaEditScreen';
import { ThemeProvider } from '../providers/ThemeProvider';
const mockPush = jest.fn(),
  mockBack = jest.fn(),
  mockParams: Record<string, string> = {};
jest.mock('expo-router', () => {
  return {
    router: {
      canGoBack: () => false,
      push: (...args: unknown[]) => mockPush(...args),
      back: () => mockBack(),
    },
    useLocalSearchParams: () => mockParams,
    useNavigation: () => ({ dispatch: jest.fn() }),
    useFocusEffect: (callback: () => void) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const React = require('react');
      React.useEffect(callback, [callback]);
    },
  };
});
jest.mock('expo-router/react-navigation', () => ({
  usePreventRemove: jest.fn(),
  useNavigationState: (selector: (state: { index: number }) => unknown) => selector({ index: 0 }),
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => '99999999-9999-4999-8999-999999999999' }));
jest.mock('../services/session/native-session', () => ({ registerNativePush: jest.fn() }));
jest.mock('../providers/LocalDataProvider', () => ({ useLocalData: () => mockData }));
const rule: GatewayRecordatorio = {
  id: 'ed21a163-0102-4b25-98af-4b3552cc87ad',
  tipo: 'epro',
  titulo: 'Mi registro diario',
  zona_horaria: 'America/Santiago',
  horas: ['08:00'],
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
let mockPermission = true;
const mockRead = jest.fn(),
  mockSave = jest.fn(),
  mockIntents = jest.fn(),
  mockRecover = jest.fn(),
  mockRefresh = jest.fn();
const mockData = {
  sharedAgenda: {
    assert: jest.fn(),
    read: mockRead,
    save: mockSave,
    repository: { intents: mockIntents },
    recover: mockRecover,
  },
  agendaCoordinator: {
    coverage: async () => ({
      permission: mockPermission,
      confirmed: 64,
      wanted: 64,
      truncated: 48,
      until: '2026-11-02T11:02:00Z',
    }),
  },
  agendaBackgroundReady: true,
  reconcileReminders: mockRefresh,
  trackOperation: async (work: () => Promise<unknown>) => work(),
  devices: null,
};
beforeEach(() => {
  jest.clearAllMocks();
  mockPermission = true;
  mockMedications = [];
  for (const key of Object.keys(mockParams)) delete mockParams[key];
  mockRead.mockResolvedValue({ rules: [rule], state: { synchronized_at: '2026-10-29T12:00:00Z' } });
  mockIntents.mockResolvedValue([]);
  mockSave.mockResolvedValue(undefined);
  mockRefresh.mockResolvedValue(undefined);
});
afterEach(cleanup);
describe('Agenda compartida: interfaz confirmada', () => {
  it('permite añadir y retirar un horario con selectores y conserva el contrato al guardar', async () => {
    mockParams.id = rule.id;
    await render(
      <ThemeProvider>
        <SharedAgendaEditScreen />
      </ThemeProvider>,
    );
    await screen.findByDisplayValue('Mi registro diario');
    expect(screen.queryByLabelText('Horas (HH:mm, separadas por coma)')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Añadir otro horario' }));
    expect(screen.getByText('Horario 2')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Quitar horario 2' }));
    expect(screen.queryByText('Horario 2')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar y confirmar horario' }));
    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith(rule.id, normalizedReminder(rule), 1),
    );
  });
  it('al editar la hora con teclado no vuelve a 08:00 aunque no se pulse Aplicar hora antes de guardar', async () => {
    mockParams.id = rule.id;
    await render(
      <ThemeProvider>
        <SharedAgendaEditScreen />
      </ThemeProvider>,
    );
    await screen.findByDisplayValue('Mi registro diario');
    await fireEvent.press(
      screen.getByRole('button', { name: 'Escribir hora con teclado para Horario 1' }),
    );
    const timeInput = await screen.findByLabelText('Campo de texto hora para Horario 1');
    await fireEvent.changeText(timeInput, '14:30');
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar y confirmar horario' }));
    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith(
        rule.id,
        expect.objectContaining({ horas: ['14:30'] }),
        1,
      ),
    );
  });
  it('permite seleccionar días de la semana y presets en agenda compartida', async () => {
    mockParams.id = rule.id;
    await render(
      <ThemeProvider>
        <SharedAgendaEditScreen />
      </ThemeProvider>,
    );
    await screen.findByDisplayValue('Mi registro diario');
    expect(screen.getByText('Todos los días')).toBeTruthy();

    // Seleccionar preset Lun a Vie
    await fireEvent.press(screen.getByRole('button', { name: 'Seleccionar lunes a viernes' }));
    expect(screen.getByText('Lunes a viernes (días hábiles)')).toBeTruthy();

    // Desmarcar Lunes
    await fireEvent.press(screen.getByLabelText('Lunes'));
    expect(screen.getByText(/4 días a la semana/)).toBeTruthy();

    // Guardar y verificar que dias_semana contiene [2, 3, 4, 5]
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar y confirmar horario' }));
    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith(
        rule.id,
        expect.objectContaining({ dias_semana: [2, 3, 4, 5] }),
        1,
      ),
    );
  });
  it('muestra horarios confirmados y cobertura limitada real', async () => {
    await render(
      <ThemeProvider>
        <SharedAgendaScreen />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByText('Mi registro diario')).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: 'Estado de los avisos' }));
    expect(screen.getByText(/64 avisos programados/)).toBeTruthy();
    expect(screen.getByText(/48 avisos fuera/)).toBeTruthy();
    expect(screen.getByText(/no registran una toma/)).toBeTruthy();
  });
  it('sin permiso de notificaciones muestra un aviso visible que abre los Ajustes de Android', async () => {
    mockPermission = false;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Linking } = require('react-native');
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await render(
      <ThemeProvider>
        <SharedAgendaScreen />
      </ThemeProvider>,
    );
    expect(await screen.findByText('Avisos desactivados en este teléfono')).toBeTruthy();
    expect(screen.getByText(/no recibirás avisos hasta que las vuelvas a activar/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Abrir Ajustes de Android' }));
    expect(openSettings).toHaveBeenCalledTimes(1);
    openSettings.mockRestore();
  });
  it('con permiso no muestra el aviso de avisos desactivados', async () => {
    await render(
      <ThemeProvider>
        <SharedAgendaScreen />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByText('Mi registro diario')).toBeTruthy());
    expect(screen.queryByText('Avisos desactivados en este teléfono')).toBeNull();
  });
  it('al volver a la app revisa otra vez la agenda y el permiso', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppState } = require('react-native');
    await render(
      <ThemeProvider>
        <SharedAgendaScreen />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByText('Mi registro diario')).toBeTruthy());
    const listeners = (AppState.addEventListener as jest.Mock).mock.calls
      .filter(([evento]) => evento === 'change')
      .map(([, listener]) => listener as (state: string) => void);
    expect(listeners.length).toBeGreaterThan(0);
    mockRefresh.mockClear();
    listeners.forEach((listener) => listener('background'));
    expect(mockRefresh).not.toHaveBeenCalled();
    listeners.forEach((listener) => listener('active'));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });
  it('pausar envía la configuración completa y su versión, sin cambiar la regla optimistamente', async () => {
    await render(
      <ThemeProvider>
        <SharedAgendaScreen />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText('Pausar Mi registro diario')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('Pausar Mi registro diario'));
    expect(mockSave).toHaveBeenCalledWith(
      rule.id,
      { ...normalizedReminder(rule), activo: false },
      1,
    );
    expect(screen.getByText(/Cuestionario diario · Activo/)).toBeTruthy();
  });
  it('distingue una intención en conflicto del horario confirmado', async () => {
    mockIntents.mockResolvedValue([{ id: rule.id, state: 'conflict', kind: 'replace' }]);
    await render(
      <ThemeProvider>
        <SharedAgendaScreen />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByText('Cambio en conflicto')).toBeTruthy());
    expect(screen.getByText(/aún no reemplaza la agenda confirmada/)).toBeTruthy();
    expect(screen.queryByLabelText('Comprobar cambio pendiente')).toBeNull();
  });
  it('distingue un horario confirmado de un fallo posterior del programador y no invita a crearlo otra vez', async () => {
    mockParams.id = rule.id;
    mockRefresh.mockRejectedValue(new Error('Fallo del programador nativo'));
    await render(
      <ThemeProvider>
        <SharedAgendaEditScreen />
      </ThemeProvider>,
    );
    await screen.findByDisplayValue(rule.titulo);
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar y confirmar horario' }));
    await waitFor(() => expect(screen.getByText('Tu horario está guardado')).toBeTruthy());
    expect(screen.getByText(/El servidor confirmó el cambio/)).toBeTruthy();
    expect(screen.queryByText(/El horario solo cambia al recibir confirmación/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Guardar y confirmar horario' })).toBeNull();
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Volver a mis recordatorios' }));
    await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  });
  it('un fallo de red al guardar conserva la edición y no navega como si hubiera ACK', async () => {
    mockParams.id = rule.id;
    mockSave.mockRejectedValue(new Error('Sin conexión'));
    await render(
      <ThemeProvider>
        <SharedAgendaEditScreen />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByDisplayValue('Mi registro diario')).toBeTruthy());
    await fireEvent.changeText(
      screen.getByLabelText('Título del recordatorio'),
      'Horario revisado',
    );
    await fireEvent.press(screen.getByLabelText('Guardar y confirmar horario'));
    await waitFor(() => expect(screen.getByText(/Sin conexión/)).toBeTruthy());
    expect(screen.getByDisplayValue('Horario revisado')).toBeTruthy();
    expect(mockBack).not.toHaveBeenCalled();
  });
});

describe('Vínculo explícito medicamento-aviso', () => {
  it('no guarda medicación sin selección y confirma el medicamento disponible elegido', async () => {
    mockParams.tipo = 'medicacion';
    mockRead.mockResolvedValue({ rules: [], state: null });
    mockMedications = [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        medicamento_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        nombre: 'Ejemplo elegido',
        activo: true,
      },
    ];
    await render(
      <ThemeProvider>
        <SharedAgendaEditScreen />
      </ThemeProvider>,
    );
    await screen.findByRole('radio', { name: 'Seleccionar Ejemplo elegido' });
    expect(screen.getByRole('button', { name: 'Guardar y confirmar horario' })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Título del recordatorio'), 'Aviso personal');
    await fireEvent.press(screen.getByRole('radio', { name: 'Seleccionar Ejemplo elegido' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar y confirmar horario' }));
    await waitFor(() =>
      expect(mockSave).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          tipo: 'medicacion',
          medicamento_paciente_id: mockMedications[0]!.id,
        }),
        undefined,
      ),
    );
  });
});

describe('Lista de horarios confirmados al abrir Mis recordatorios', () => {
  it('Una lectura atrasada no oculta un horario que ya apareció confirmado', async () => {
    let resolveOld!: (value: unknown) => void;
    const old = new Promise((resolve) => {
      resolveOld = resolve;
    });
    mockRead.mockImplementationOnce(() => old);
    await render(
      <ThemeProvider>
        <SharedAgendaScreen />
      </ThemeProvider>,
    );
    await screen.findByText(rule.titulo);
    await act(async () => {
      resolveOld({ rules: [], state: null });
    });
    expect(screen.getByText(rule.titulo)).toBeTruthy();
    expect(screen.queryByText('No tienes horarios confirmados.')).toBeNull();
  });
  it('muestra primero los horarios confirmados y deja pendientes y controles técnicos después', async () => {
    mockIntents.mockResolvedValue([{ id: rule.id, kind: 'create', state: 'pending' }]);
    await render(
      <ThemeProvider>
        <SharedAgendaScreen />
      </ThemeProvider>,
    );
    await screen.findByText('Cambio sin confirmar');
    const output = JSON.stringify(screen.toJSON());
    expect(output.indexOf(rule.titulo)).toBeGreaterThan(-1);
    expect(output.indexOf(rule.titulo)).toBeLessThan(output.indexOf('Cambio sin confirmar'));
    expect(output.indexOf(rule.titulo)).toBeLessThan(output.indexOf('Estado de los avisos'));
  });
  it('pone el recordatorio recién creado antes que los antiguos sin retirar los anteriores', async () => {
    const latest = {
      ...rule,
      id: 'cd21a163-0102-4b25-98af-4b3552cc87ad',
      titulo: 'Mi horario nuevo',
      creado_en: '2026-11-04T10:53:00Z',
    };
    mockRead.mockResolvedValue({ rules: [rule, latest], state: null });
    await render(
      <ThemeProvider>
        <SharedAgendaScreen />
      </ThemeProvider>,
    );
    await screen.findByText(latest.titulo);
    expect(screen.getByText(rule.titulo)).toBeTruthy();
    const output = JSON.stringify(screen.toJSON());
    expect(output.indexOf(latest.titulo)).toBeLessThan(output.indexOf(rule.titulo));
  });
});
