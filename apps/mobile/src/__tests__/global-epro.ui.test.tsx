/// <reference types="jest" />
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import fixture from '../../../../packages/contracts/fixtures/epro-seguimiento-domiciliario-v1_1_0.json';
import { completeDefinition } from '../data/sync/catalog';
import { createDailyFormContext } from '../services/forms/daily-form-context';
const mockPush = jest.fn(),
  mockReplace = jest.fn(),
  mockDispatch = jest.fn();
let mockParams: { id?: string; draft?: string } = {};
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
  useNavigation: () => ({ dispatch: mockDispatch }),
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (callback: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('react').useEffect(callback, [callback]);
  },
}));
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }));
jest.mock('../components/Screen', () => ({
  Screen: ({ title, children }: { title: string; children: React.ReactNode }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { View, Text } = require('react-native');
    return (
      <View>
        <Text accessibilityRole="header">{title}</Text>
        {children}
      </View>
    );
  },
}));
jest.mock('../features/medical-forms/FormSectionScreen', () => ({ FormSectionScreen: () => null }));
jest.mock('../features/medical-forms/MedicalFormsScreens', () => ({
  MedicalFormSubmissionDetailScreen: () => null,
}));
const mockTheme = {
  colors: {
    background: '#fff',
    surface: '#fff',
    mutedSurface: '#eee',
    primary: '#00695C',
    onPrimary: '#fff',
    primaryContainer: '#E0F2EF',
    onPrimaryContainer: '#183B36',
    border: '#bbb',
    text: '#111',
    secondary: '#444',
    error: '#B00020',
    errorContainer: '#fee',
    onErrorContainer: '#900',
    success: '#080',
    warning: '#a60',
  },
};
jest.mock('../providers/ThemeProvider', () => ({ useAppTheme: () => ({ theme: mockTheme }) }));
const snapshot = completeDefinition(
  { ...fixture.formulario, eliminado: false },
  fixture.formulario.preguntas.map((q) => ({
    ...q,
    formulario_id: fixture.formulario.id,
    eliminado: false,
  })),
);
const draft = {
  id: '4be97c17-cef7-4f4b-9483-0f24fe405fb4',
  owner: 'owner',
  environment: 'test',
  definition: snapshot,
  context: createDailyFormContext({ now: '2026-10-27T12:00:00Z' }),
  answers: {},
  section: 'sec-modulo-0',
  savedAt: '2026-10-27T12:00:00Z',
  revision: 0,
};
const mockRepo = {
  hub: jest.fn(),
  start: jest.fn(),
  draft: jest.fn(),
  save: jest.fn(),
  submit: jest.fn(),
  capture: jest.fn(),
};
jest.mock('../features/medical-forms/use-epro-repository', () => ({
  useEproRepository: () => mockRepo,
}));
const mockContext = {
  repository: { listAssignedForms: jest.fn().mockResolvedValue([]), getDailyFormStatus: jest.fn() },
  isClosing: false,
  trackOperation: async (work: () => Promise<unknown>) => work(),
};
jest.mock('../providers/LocalDataProvider', () => ({ useLocalData: () => mockContext }));
import {
  ContractEproEditor,
  GlobalEproHubScreen,
  EproSubmissionRoute,
} from '../features/medical-forms/GlobalEproScreens';
describe('active global ePRO UI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = {};
    mockContext.isClosing = false;
    mockRepo.hub.mockResolvedValue({
      status: { completed_at: '2026-10-27T12:00:00Z', error_code: null },
      current: snapshot,
      drafts: [],
      captures: [],
    });
    mockRepo.start.mockResolvedValue(draft);
    mockRepo.draft.mockResolvedValue(draft);
    mockRepo.save.mockResolvedValue(draft);
    mockRepo.submit.mockResolvedValue(draft.id);
    mockRepo.capture.mockResolvedValue(null);
  });
  it('starts the global definition and routes with a durable draft identity', async () => {
    await render(<GlobalEproHubScreen />);
    const start = await screen.findByRole('button', { name: 'Iniciar seguimiento' });
    await act(async () => {
      await fireEvent.press(start);
    });
    expect(mockRepo.start).toHaveBeenCalledWith(fixture.formulario.id);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/formulario/cuestionario',
      params: { draft: draft.id },
    });
  });
  it('retoma automáticamente la identidad y sección guardadas sin crear otro seguimiento', async () => {
    mockRepo.hub.mockResolvedValue({
      status: { completed_at: '2026-10-27T12:00:00Z', error_code: null },
      current: snapshot,
      drafts: [{ ...draft, section: 'sec-modulo-1', context: createDailyFormContext() }],
      captures: [],
    });
    await render(<GlobalEproHubScreen />);
    const resume = await screen.findByRole('button', { name: 'Iniciar seguimiento' });
    expect(screen.getByText(/Paso 2 de/)).toBeTruthy();
    expect(screen.queryByText(/Borrador/)).toBeNull();
    await fireEvent.press(resume);
    expect(mockRepo.start).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/formulario/cuestionario',
      params: { draft: draft.id },
    });
  });
  it('requires an answer before advancing and saves a typed choice before moving to the next section', async () => {
    await render(<ContractEproEditor draftId={draft.id} />);
    const next = await screen.findByRole('button', { name: 'Continuar' });
    await fireEvent.press(next);
    expect(await screen.findByText('Falta una respuesta obligatoria.')).toBeTruthy();
    // Prueba 12 (TalkBack): la opción nombra también la pregunta que responde.
    const asked = fixture.formulario.preguntas.find((q) => q.codigo === 'P0.1')!;
    expect(screen.getByRole('radio', { name: `No, ${asked.titulo}` })).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByRole('radio', { name: /^No, / }));
    });
    await act(async () => {
      await fireEvent.press(screen.getByRole('button', { name: 'Continuar' }));
    });
    expect(await screen.findByRole('header', { name: 'Fiebre e infección' })).toBeTruthy();
    const first = fixture.formulario.preguntas.find((q) => q.codigo === 'P0.1')!;
    expect(mockRepo.save.mock.calls.at(-1)[1][first.id]).toBe('no');
  });
  it('seleccionar una molestia retira la opción que debe ir sola y guarda la elección válida', async () => {
    await render(<ContractEproEditor draftId={draft.id} />);
    await screen.findByRole('radio', { name: /^Sí, / });
    await act(async () => {
      await fireEvent.press(screen.getByRole('radio', { name: /^Sí, / }));
    });
    const normal = await screen.findByRole('checkbox', { name: /Se ve normal/ });
    const symptom = screen.getByRole('checkbox', { name: /Está un poco sensible/ });
    await act(async () => {
      await fireEvent.press(normal);
      await fireEvent.press(symptom);
    });
    expect(screen.queryByText(/La opción exclusiva debe seleccionarse sola/)).toBeNull();
    const question = fixture.formulario.preguntas.find((q) => q.codigo === 'P0.1.1')!;
    await waitFor(() =>
      expect(mockRepo.save.mock.calls.at(-1)[1][question.id]).toEqual(['sensible_picazon']),
    );
    expect(
      screen.getByRole('checkbox', { name: /Se ve normal/ }).props.accessibilityState.checked,
    ).toBe(false);
    expect(
      screen.getByRole('checkbox', { name: /Está un poco sensible/ }).props.accessibilityState
        .checked,
    ).toBe(true);
  });
  it('shows a failed local save and lets the patient retry without losing the selection', async () => {
    mockRepo.save.mockRejectedValueOnce(new Error('Fallo sintético de almacenamiento'));
    await render(<ContractEproEditor draftId={draft.id} />);
    await screen.findByRole('radio', { name: /^No, / });
    await act(async () => {
      await fireEvent.press(screen.getByRole('radio', { name: /^No, / }));
    });
    expect(await screen.findByText('Fallo sintético de almacenamiento')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /^No, / }).props.accessibilityState.checked).toBe(
      true,
    );
    await act(async () => {
      await fireEvent.press(screen.getByRole('button', { name: 'Reintentar guardado' }));
    });
    expect(await screen.findByText('Guardado automáticamente')).toBeTruthy();
  });
  it('blocks an incomplete replicated definition instead of filling the screen with a bundled sample', async () => {
    mockRepo.hub.mockRejectedValueOnce(new Error('Incomplete checkpoint'));
    await render(<GlobalEproHubScreen />);
    expect(await screen.findByText(/No pudimos abrir tu cuestionario/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Iniciar seguimiento' })).toBeNull();
  });
  it('pausar espera el guardado y conserva el borrador si falla', async () => {
    await render(<ContractEproEditor draftId={draft.id} />);
    const pause = await screen.findByRole('button', { name: 'Pausar y seguir más tarde' });
    mockRepo.save.mockRejectedValueOnce(new Error('No se pudo guardar la prueba'));
    await fireEvent.press(pause);
    expect(await screen.findByText('No se pudo guardar la prueba')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Pausar y seguir más tarde' }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/formulario'));
  });
  it('renders the original capture snapshot and distinguishes reception from clinical evaluation', async () => {
    const first = fixture.formulario.preguntas.find((q) => q.codigo === 'P0.1')!;
    mockParams = { id: draft.id };
    mockRepo.capture.mockResolvedValue({
      record: { ...draft, answers: { [first.id]: 'no' }, submittedAt: '2026-10-27T12:02:00Z' },
      status: 'aceptado',
    });
    await render(<EproSubmissionRoute />);
    expect(await screen.findByText(first.titulo)).toBeTruthy();
    expect(screen.getByText('No')).toBeTruthy();
    expect(
      screen.getByText(/no significa que tu equipo de salud ya lo haya revisado/),
    ).toBeTruthy();
  });
});
