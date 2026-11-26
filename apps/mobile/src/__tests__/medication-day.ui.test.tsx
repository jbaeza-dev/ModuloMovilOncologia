/// <reference types="jest" />
import React from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { Alert, AppState } from 'react-native';
import type { GatewayRecordatorio } from '@quimiocare/contracts';
import { MedicationDaySection } from '../features/home/MedicationDaySection';
import { ThemeProvider } from '../providers/ThemeProvider';
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
}));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...v: unknown[]) => mockPush(...v), canGoBack: () => false },
  useFocusEffect: (cb: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(cb, [cb]);
  },
}));
jest.mock('expo-router/react-navigation', () => ({
  useNavigationState: (cb: (v: { index: number }) => unknown) => cb({ index: 0 }),
}));
const medA = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  medicamento_id: '11111111-1111-4111-8111-111111111111',
  nombre: 'Medicamento A de prueba',
  dosis: 'Texto A',
  frecuencia: 'Texto A',
  activo: true,
  fecha_inicio: '2026-01-01',
  fecha_termino: null,
};
const medB = {
  ...medA,
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  nombre: 'Medicamento B de prueba',
};
let mockMedicines = [medA, medB];
jest.mock('../features/profile/IdentityProfileScreens', () => ({
  useProfileIdentity: () => ({
    identity: {
      owner: 'paciente-a',
      clinicalProfile: { medicamentos: mockMedicines },
      treatmentStatus: 'available',
    },
  }),
}));
let mockEpoch = 1;
const mockRead = jest.fn(),
  mockIntents = jest.fn(),
  mockLog = jest.fn(),
  mockRows = jest.fn();
const mockData = {
  database: {},
  patientId: 'paciente-a',
  isClosing: false,
  remindersRevision: 0,
  manager: { getPatientId: () => 'paciente-a', getContextEpoch: () => mockEpoch },
  sharedAgenda: { read: mockRead, repository: { intents: mockIntents } },
  reconcileReminders: jest.fn(async () => undefined),
  trackOperation: async (fn: () => Promise<unknown>) => fn(),
};
jest.mock('../providers/LocalDataProvider', () => ({ useLocalData: () => mockData }));
jest.mock('../data/local/medication-intake-log', () => ({
  generateIntakeLogId: (...v: string[]) => v.join('#'),
  getMedicationIntakesForDate: (...v: unknown[]) => mockRows(...v),
  logMedicationIntake: (...v: unknown[]) => mockLog(...v),
}));
const rule: GatewayRecordatorio = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  tipo: 'medicacion',
  titulo: 'Aviso A',
  zona_horaria: 'America/Santiago',
  horas: ['08:00'],
  dias_semana: [1, 2, 3, 4, 5, 6, 7],
  fecha_inicio: '2026-01-01',
  fecha_fin: null,
  activo: true,
  version: 1,
  creado_en: '2026-01-01T00:00:00Z',
  actualizado_en: '2026-01-01T00:00:00Z',
  canal: 'push_con_respaldo_local',
  respaldo_segundos: 120,
  medicamento_paciente_id: medA.id,
};
const listeners = new Set<(state: string) => void>();
let alert: jest.SpyInstance;
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  jest.setSystemTime(new Date('2026-11-03T15:00:00Z'));
  jest.clearAllMocks();
  mockEpoch = 1;
  mockMedicines = [medA, medB];
  mockRead.mockResolvedValue({ rules: [rule] });
  mockIntents.mockResolvedValue([]);
  mockRows.mockResolvedValue([]);
  mockLog.mockResolvedValue(undefined);
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    writable: true,
    value: 'active',
  });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, callback) => {
    const cb = callback as (s: string) => void;
    listeners.add(cb);
    return { remove: () => listeners.delete(cb) };
  });
  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(async () => {
  await cleanup();
  listeners.clear();
  jest.restoreAllMocks();
  jest.useRealTimers();
});
async function start() {
  await render(
    <ThemeProvider>
      <MedicationDaySection />
    </ThemeProvider>,
  );
  await waitFor(() => expect(screen.queryByText('Cargando medicamentos y avisos…')).toBeNull());
}
async function accept() {
  const cb = alert.mock.calls
    .at(-1)?.[2]
    ?.find((b: { text: string }) => b.text === 'Confirmar registro')?.onPress;
  if (!cb) throw new Error('No confirmation');
  await act(async () => {
    cb();
    await Promise.resolve();
  });
}
describe('Medicamentos y avisos: integración de interfaz real', () => {
  it('muestra todos los disponibles y solo permite confirmar el medicamento con aviso confirmado', async () => {
    await start();
    expect(screen.getByText(medA.nombre)).toBeTruthy();
    expect(screen.getByText(medB.nombre)).toBeTruthy();
    expect(
      within(screen.getByTestId('medication-card-' + medA.id)).getByRole('button', {
        name: /^Ya la tomé, /,
      }),
    ).toBeTruthy();
    // Prueba 12 (TalkBack): cada botón nombra su medicamento y horario, no solo «Ya la tomé».
    const card = within(screen.getByTestId('medication-card-' + medA.id));
    expect(
      card.getByRole('button', {
        name: new RegExp(`^Ya la tomé, ${medA.nombre}, aviso de las \\d{2}:\\d{2}$`),
      }),
    ).toBeTruthy();
    expect(card.getByRole('button', { name: `Configurar aviso de ${medA.nombre}` })).toBeTruthy();
    expect(card.getByRole('button', { name: `Ver indicaciones de ${medA.nombre}` })).toBeTruthy();
    const other = within(screen.getByTestId('medication-card-' + medB.id));
    expect(other.queryByRole('button', { name: /^Ya la tomé, / })).toBeNull();
    await fireEvent.press(other.getByRole('button', { name: /^Configurar aviso de / }));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/recordatorios/editar',
      params: { tipo: 'medicacion', medicamentoId: medB.id },
    });
  });
  it('sin agenda confirmada, con aviso genérico o con intención pendiente no habilita tomas', async () => {
    mockRead.mockResolvedValue({ rules: [{ ...rule, medicamento_paciente_id: null }] });
    await start();
    expect(screen.queryByRole('button', { name: /^Ya la tomé, / })).toBeNull();
  });
  it('no aplica una edición pendiente a las confirmaciones', async () => {
    mockIntents.mockResolvedValue([{ id: rule.id }]);
    await start();
    expect(screen.queryByRole('button', { name: /^No la tomé, / })).toBeNull();
    expect(screen.getByText(/Hay un cambio de aviso pendiente/)).toBeTruthy();
  });
  it('conserva un registro manual previo separado del aviso y exige confirmar antes de guardar', async () => {
    mockRows.mockResolvedValue([
      {
        id: 'old',
        paciente_id: 'paciente-a',
        medicamento_id: medA.id,
        fecha_civil: '2026-11-03',
        horario_programado: 'sin_horario#1',
        fecha_hora: '2026-11-03T14:00:00Z',
        estado: 'taken',
      },
    ]);
    await start();
    expect(screen.getByText(/Otros registros guardados hoy \(1\)/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /^No la tomé, / }));
    expect(mockLog).not.toHaveBeenCalled();
    await accept();
    await waitFor(() => expect(mockLog).toHaveBeenCalled());
    expect(mockLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        medicamento_id: medA.id,
        estado: 'omitted',
        fecha_civil: '2026-11-03',
        horario_programado: 'aviso#08:00',
        avisos_confirmados: expect.arrayContaining([
          expect.objectContaining({ reminderId: rule.id, version: 1 }),
        ]),
      }),
    );
  });
  it('descarta una confirmación abierta si cambia la cuenta o su época', async () => {
    await start();
    await fireEvent.press(screen.getByRole('button', { name: /^Ya la tomé, / }));
    mockEpoch = 2;
    await accept();
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith('No se guardó la confirmación', expect.any(String)),
    );
    expect(mockLog).not.toHaveBeenCalled();
  });
  it('revalida el aviso al confirmar: eliminarlo o cambiarlo no guarda una dosis', async () => {
    await start();
    await fireEvent.press(screen.getByRole('button', { name: /^Ya la tomé, / }));
    mockRead.mockResolvedValue({ rules: [] });
    await accept();
    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith('No se guardó la confirmación', expect.any(String)),
    );
    expect(mockLog).not.toHaveBeenCalled();
  });
  it('no anticipa la confirmación de un aviso futuro', async () => {
    mockRead.mockResolvedValue({ rules: [{ ...rule, horas: ['20:00'] }] });
    await start();
    expect(screen.getByText('Más tarde')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Ya la tomé, / })).toBeNull();
  });
  it('renueva al pasar la medianoche de Chile y vuelve a leer los registros del día nuevo', async () => {
    jest.setSystemTime(new Date('2026-11-04T02:59:59Z'));
    await start();
    expect(screen.getByRole('button', { name: /^Ya la tomé, / })).toBeTruthy();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1100);
    });
    await waitFor(() =>
      expect(mockRows).toHaveBeenLastCalledWith(expect.anything(), 'paciente-a', '2026-11-04'),
    );
    expect(screen.getByText('Más tarde')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Ya la tomé, / })).toBeNull();
  });
  it('al regresar del segundo plano renueva el día aunque el temporizador haya quedado suspendido', async () => {
    await start();
    await act(async () => {
      AppState.currentState = 'background';
      for (const cb of listeners) cb('background');
    });
    jest.setSystemTime(new Date('2026-11-04T15:00:00Z'));
    await act(async () => {
      AppState.currentState = 'active';
      for (const cb of [...listeners]) cb('active');
    });
    await waitFor(() =>
      expect(mockRows).toHaveBeenLastCalledWith(expect.anything(), 'paciente-a', '2026-11-04'),
    );
  });
});
