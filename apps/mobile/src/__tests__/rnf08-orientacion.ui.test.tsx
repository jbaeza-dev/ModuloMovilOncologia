/// <reference types="jest" />
import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
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

// RNF-08: el 100 % de las pantallas de orientación debe mostrar que la aplicación no entrega
// diagnósticos ni reemplaza la atención profesional.
const avisoRnf08 = /no reemplaza|no (entrega|es un|constituye un) diagn[oó]stico/i;

function mostrarAvisoRnf08() {
  expect(screen.queryAllByText(avisoRnf08).length).toBeGreaterThan(0);
}

async function comenzar() {
  await render(<TriageScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Comenzar orientación de síntomas' }));
}

describe('RNF-08: aviso en todas las pantallas de orientación de síntomas', () => {
  beforeEach(() => {
    mockDemo = true;
    mockPatientId = 'patient-a';
    mockHasDatabase = false;
    mockSave.mockReset();
    mockHistory.mockReset().mockResolvedValue([]);
    process.env.EXPO_PUBLIC_P07_SYNTHETIC_REVIEW = 'true';
  });
  afterAll(() => {
    if (mockOriginalFlag === undefined) delete process.env.EXPO_PUBLIC_P07_SYNTHETIC_REVIEW;
    else process.env.EXPO_PUBLIC_P07_SYNTHETIC_REVIEW = mockOriginalFlag;
    if (mockOriginalProfile === undefined) delete process.env.EXPO_PUBLIC_APP_ENV;
    else process.env.EXPO_PUBLIC_APP_ENV = mockOriginalProfile;
  });

  it('pantalla de inicio de la orientación', async () => {
    await render(<TriageScreen />);
    expect(screen.getByText('Orientación y triaje de síntomas')).toBeTruthy();
    mostrarAvisoRnf08();
  });

  it('pantalla de preguntas', async () => {
    await comenzar();
    expect(screen.getByText('¿Quién responde sobre los síntomas?')).toBeTruthy();
    mostrarAvisoRnf08();
  });

  it('pantalla de contactos de ayuda', async () => {
    await comenzar();
    await fireEvent.press(screen.getByRole('button', { name: 'Ver contactos de ayuda' }));
    expect(screen.getByRole('button', { name: 'Abrir marcador: SAMU 131' })).toBeTruthy();
    mostrarAvisoRnf08();
  });

  it('pantalla de resultado (nivel D)', async () => {
    await comenzar();
    await fireEvent.press(screen.getByRole('button', { name: 'Paciente' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Ver orientación' }));
    expect(screen.getByText('Nivel D · Información insuficiente')).toBeTruthy();
    mostrarAvisoRnf08();
  });

  it('pantalla de resultado urgente (nivel A1)', async () => {
    await comenzar();
    await fireEvent.press(screen.getAllByRole('button', { name: /^Sí, / })[0]);
    expect(screen.getByText('Nivel A1 · Ayuda inmediata')).toBeTruthy();
    mostrarAvisoRnf08();
  });
});
