/// <reference types="jest" />
import React from 'react';
import { Alert } from 'react-native';
import { act, render, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
const mockOriginalFlag = process.env.EXPO_PUBLIC_P07_SYNTHETIC_REVIEW;
const mockOriginalProfile = process.env.EXPO_PUBLIC_APP_ENV;
let mockDemo = false;
let mockPatientId = 'patient-a';
let mockHasDatabase = false;
const mockSave = jest.fn();
const mockHistory = jest.fn();
jest.mock('expo-crypto', () => ({ randomUUID: () => 'synthetic-test-id' }));
jest.mock('../utils/environment', () => ({ isDemoMode: () => mockDemo }));
jest.mock('../providers/LocalDataProvider', () => ({
  useLocalData: () => ({
    database: mockHasDatabase ? {} : null,
    patientId: mockPatientId,
    clinicalStore: mockHasDatabase ? { scope: { environment: 'test' } } : null,
    runSave: (operation: () => Promise<unknown>) => operation(),
    isClosing: false,
  }),
}));
jest.mock('../features/triage/triage-repository', () => ({
  createOrientationRepository: () => ({
    save: (...args: unknown[]) => mockSave(...args),
    history: (...args: unknown[]) => mockHistory(...args),
  }),
}));
jest.mock('../components/Screen', () => ({
  Screen: ({
    children,
    bottomAction,
    fixedHeader,
  }: {
    children: React.ReactNode;
    bottomAction?: React.ReactNode;
    fixedHeader?: React.ReactNode;
  }) => {
    const { View } = jest.requireActual<typeof import('react-native')>('react-native');
    return (
      <View>
        <View testID="triage-fixed-help">{fixedHeader}</View>
        {children}
        {bottomAction}
      </View>
    );
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
    inputBorder: '#757575',
    inputBorderFocused: '#00695C',
    text: '#212121',
    secondary: '#555555',
    error: '#B3261E',
    onError: '#FFFFFF',
    errorContainer: '#FFDAD6',
    onErrorContainer: '#410002',
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

import { TriageScreen } from '../features/triage/TriageScreen';
import { questions } from '../features/triage/triage-definition';
async function beginReview() {
  const rendered = await render(<TriageScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Comenzar orientación de síntomas' }));
  return rendered;
}

describe('orientación v0.5: flujo clínico activo y cambio de cuenta', () => {
  beforeEach(() => {
    mockDemo = false;
    mockPatientId = 'patient-a';
    mockHasDatabase = false;
    mockSave.mockReset();
    mockHistory.mockReset().mockResolvedValue([]);
    delete process.env.EXPO_PUBLIC_APP_ENV;
    delete process.env.EXPO_PUBLIC_P07_SYNTHETIC_REVIEW;
  });
  afterAll(() => {
    if (mockOriginalFlag === undefined) delete process.env.EXPO_PUBLIC_P07_SYNTHETIC_REVIEW;
    else process.env.EXPO_PUBLIC_P07_SYNTHETIC_REVIEW = mockOriginalFlag;
    if (mockOriginalProfile === undefined) delete process.env.EXPO_PUBLIC_APP_ENV;
    else process.env.EXPO_PUBLIC_APP_ENV = mockOriginalProfile;
  });
  it('el uso normal presenta la orientación clínica de síntomas accesible al paciente', async () => {
    process.env.EXPO_PUBLIC_P07_SYNTHETIC_REVIEW = 'true';
    await render(<TriageScreen />);
    expect(screen.getByText('Orientación y triaje de síntomas')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Comenzar orientación de síntomas' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abrir marcador: SAMU 131' })).toBeTruthy();
  });
  it('en modo demo también permite comenzar directamente la orientación clínica', async () => {
    mockDemo = true;
    await render(<TriageScreen />);
    expect(screen.getByText('Orientación y triaje de síntomas')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Comenzar orientación de síntomas' })).toBeTruthy();
  });
  it('una señal A1 se presenta sin exigir ENA ni completar las preguntas restantes', async () => {
    mockDemo = true;
    process.env.EXPO_PUBLIC_P07_SYNTHETIC_REVIEW = 'true';
    await beginReview();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Sí' })[0]);
    expect(screen.getByText('Nivel A1 · Ayuda inmediata')).toBeTruthy();
    expect(screen.getByText(/se conservan las señales conocidas/)).toBeTruthy();
  });
  it.each([
    ['C', 'Nivel C · Seguimiento domiciliario condicionado'],
    ['D', 'Nivel D · Información insuficiente'],
  ] as const)(
    'al consultar %s lleva al mensaje y permite volver y consultar otra vez sin perder respuestas',
    async (code, expectedLabel) => {
      mockDemo = true;
      process.env.EXPO_PUBLIC_P07_SYNTHETIC_REVIEW = 'true';
      await beginReview();
      await fireEvent.press(screen.getByRole('button', { name: 'Paciente' }));
      if (code === 'C') {
        for (const question of questions) {
          await fireEvent.press(
            within(screen.getByLabelText(question.text)).getByRole('button', {
              name: question.group === 'C' ? 'Sí' : 'No',
            }),
          );
        }
        await fireEvent.changeText(screen.getByLabelText('Nivel de dolor (escala 0 a 10)'), '0');
      }
      await fireEvent.press(screen.getByRole('button', { name: 'Ver orientación' }));
      expect(screen.getByText(expectedLabel)).toBeTruthy();
      expect(screen.queryByLabelText(questions[0].text)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Ver orientación' })).toBeNull();
      await fireEvent.press(screen.getByRole('button', { name: 'Volver a mis respuestas' }));
      expect(screen.getByRole('button', { name: 'Paciente', selected: true })).toBeTruthy();
      if (code === 'C') {
        expect(screen.getByLabelText('Nivel de dolor (escala 0 a 10)')).toHaveProp('value', '0');
        expect(
          within(screen.getByLabelText(questions[0].text)).getByRole('button', {
            name: 'No',
            selected: true,
          }),
        ).toBeTruthy();
      }
      await fireEvent.press(screen.getByRole('button', { name: 'Ver orientación' }));
      expect(screen.getByText(expectedLabel)).toBeTruthy();
      expect(mockSave).not.toHaveBeenCalled();
    },
  );
  it('al cambiar de cuenta elimina las respuestas de pantalla de la cuenta anterior', async () => {
    mockDemo = true;
    process.env.EXPO_PUBLIC_P07_SYNTHETIC_REVIEW = 'true';
    const rendered = await beginReview();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Sí' })[0]);
    expect(screen.getByText('Nivel A1 · Ayuda inmediata')).toBeTruthy();
    mockPatientId = 'patient-b';
    await rendered.rerender(<TriageScreen />);
    expect(screen.queryByText('Nivel A1 · Ayuda inmediata')).toBeNull();
  });
  it('un reintento tras error conserva UUID y fecha en vez de crear otra evaluación', async () => {
    mockDemo = true;
    mockHasDatabase = true;
    process.env.EXPO_PUBLIC_P07_SYNTHETIC_REVIEW = 'true';
    mockSave.mockRejectedValueOnce(new Error('Fallo sintético')).mockResolvedValueOnce({});
    await beginReview();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Sí' })[0]);
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar evaluación' }));
    await waitFor(() =>
      expect(
        screen.getByText('No se pudo guardar esta evaluación. La orientación permanece visible.'),
      ).toBeTruthy(),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar evaluación' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Evaluación guardada' })).toBeTruthy(),
    );
    expect(mockSave).toHaveBeenCalledTimes(2);
    expect(mockSave.mock.calls[1][0]).toBe(mockSave.mock.calls[0][0]);
    expect(mockSave.mock.calls[1][3]).toBe(mockSave.mock.calls[0][3]);
  });
  it('permite pedir ayuda sin terminar el recorrido y volver conserva el informante', async () => {
    mockDemo = true;
    process.env.EXPO_PUBLIC_P07_SYNTHETIC_REVIEW = 'true';
    await beginReview();
    await fireEvent.press(screen.getByRole('button', { name: 'Paciente' }));
    expect(screen.getByTestId('triage-fixed-help')).toContainElement(
      screen.getByRole('button', { name: 'Ver contactos de ayuda' }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Ver contactos de ayuda' }));
    expect(screen.getByRole('button', { name: 'Abrir marcador: SAMU 131' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Volver a mis respuestas' }));
    expect(screen.getByRole('button', { name: 'Paciente', selected: true })).toBeTruthy();
  });
  it('el APK universitario abre la orientación de síntomas', async () => {
    process.env.EXPO_PUBLIC_APP_ENV = 'universidad-demo';
    process.env.EXPO_PUBLIC_P07_SYNTHETIC_REVIEW = 'true';
    await render(<TriageScreen />);
    expect(screen.getByText('Orientación y triaje de síntomas')).toBeTruthy();
    expect(screen.queryByLabelText(questions[0].text)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Comenzar orientación de síntomas' }));
    await fireEvent.press(
      within(screen.getByLabelText(questions[0].text)).getByRole('button', { name: 'Sí' }),
    );
    expect(screen.getByText('Nivel A1 · Ayuda inmediata')).toBeTruthy();
    expect(screen.getByText('Ayuda inmediata')).toBeTruthy();
    expect(mockSave).not.toHaveBeenCalled();
  });
  it.each([
    ['A2', 'Nivel A2 · Valoración profesional urgente'],
    ['B', 'Nivel B · Contacto prioritario con tu equipo'],
  ] as const)(
    'el usuario puede recorrer un caso %s y ver su mensaje',
    async (code, expectedLabel) => {
      mockDemo = true;
      process.env.EXPO_PUBLIC_P07_SYNTHETIC_REVIEW = 'true';
      await beginReview();
      await fireEvent.press(screen.getByRole('button', { name: 'Paciente' }));
      if (code === 'A2') {
        const question = questions.find((q) => q.group === 'A2')!;
        await fireEvent.press(
          within(screen.getByLabelText(question.text)).getByRole('button', { name: 'Sí' }),
        );
      } else {
        for (const question of questions) {
          await fireEvent.press(
            within(screen.getByLabelText(question.text)).getByRole('button', {
              name: question.id === 'B-SYMPTOMS' || question.group === 'C' ? 'Sí' : 'No',
            }),
          );
        }
        await fireEvent.changeText(screen.getByLabelText('Nivel de dolor (escala 0 a 10)'), '2');
        await fireEvent.press(screen.getByRole('button', { name: 'Ver orientación' }));
      }
      expect(screen.getByText(expectedLabel)).toBeTruthy();
      expect(screen.queryByLabelText(questions[0].text)).toBeNull();
    },
  );
  it('una nueva evaluación guardada empieza sin respuestas ni resultados anteriores y no reescribe el historial', async () => {
    mockDemo = true;
    mockHasDatabase = true;
    mockSave.mockResolvedValue({});
    process.env.EXPO_PUBLIC_P07_SYNTHETIC_REVIEW = 'true';
    await beginReview();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Sí' })[0]);
    await fireEvent.press(screen.getByRole('button', { name: 'Guardar evaluación' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Evaluación guardada' })).toBeTruthy(),
    );
    expect(mockSave.mock.calls[0][2]).toBe('synthetic');
    await fireEvent.press(screen.getByRole('button', { name: 'Empezar otra evaluación' }));
    expect(screen.getByText('Orientación y triaje de síntomas')).toBeTruthy();
    expect(screen.queryByText('Nivel A1 · Ayuda inmediata')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Comenzar orientación de síntomas' }));
    expect(screen.getByLabelText('Nivel de dolor (escala 0 a 10)')).toHaveProp('value', '');
    expect(screen.getByRole('button', { name: 'Paciente', selected: false })).toBeTruthy();
    expect(mockSave).toHaveBeenCalledTimes(1);
  });
  it('el historial vacío tiene una confirmación visible', async () => {
    mockDemo = true;
    mockHasDatabase = true;
    process.env.EXPO_PUBLIC_P07_SYNTHETIC_REVIEW = 'true';
    await beginReview();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Consultar historial de orientaciones' }),
    );
    await waitFor(() =>
      expect(
        screen.getByText('Aún no hay evaluaciones guardadas en este dispositivo.'),
      ).toBeTruthy(),
    );
    expect(mockHistory).toHaveBeenCalledWith('synthetic');
  });
  it('un caso sin guardar conserva sus respuestas hasta confirmar el descarte', async () => {
    mockDemo = true;
    process.env.EXPO_PUBLIC_P07_SYNTHETIC_REVIEW = 'true';
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    try {
      await beginReview();
      await fireEvent.press(screen.getAllByRole('button', { name: 'Sí' })[0]);
      await fireEvent.press(screen.getByRole('button', { name: 'Empezar otra evaluación' }));
      expect(screen.getByText('Nivel A1 · Ayuda inmediata')).toBeTruthy();
      const buttons = alert.mock.calls[0][2]!;
      expect(buttons.find((button) => button.style === 'cancel')).toBeTruthy();
      await act(async () =>
        buttons.find((button) => button.text === 'Empezar sin guardar')?.onPress?.(),
      );
      expect(screen.getByText('Orientación y triaje de síntomas')).toBeTruthy();
      expect(screen.queryByText('Nivel A1 · Ayuda inmediata')).toBeNull();
      expect(mockSave).not.toHaveBeenCalled();
    } finally {
      alert.mockRestore();
    }
  });
  it('confirmar un descarte antiguo no elimina un caso de otra cuenta', async () => {
    mockDemo = true;
    process.env.EXPO_PUBLIC_P07_SYNTHETIC_REVIEW = 'true';
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    try {
      const rendered = await beginReview();
      await fireEvent.press(screen.getAllByRole('button', { name: 'Sí' })[0]);
      await fireEvent.press(screen.getByRole('button', { name: 'Empezar otra evaluación' }));
      const discard = alert.mock.calls[0][2]!.find(
        (button) => button.text === 'Empezar sin guardar',
      )!.onPress!;
      mockPatientId = 'patient-b';
      await rendered.rerender(<TriageScreen />);
      await fireEvent.press(
        screen.getByRole('button', { name: 'Comenzar orientación de síntomas' }),
      );
      await fireEvent.press(screen.getByRole('button', { name: 'Paciente' }));
      await act(async () => discard());
      expect(screen.getByRole('button', { name: 'Paciente', selected: true })).toBeTruthy();
      expect(screen.queryByText('Nivel A1 · Ayuda inmediata')).toBeNull();
    } finally {
      alert.mockRestore();
    }
  });
});
