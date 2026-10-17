/// <reference types="jest" />

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

const mockRouterPush = jest.fn();
const mockRouterNavigate = jest.fn();
const mockRouterReplace = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockRouterPush(...args),
    navigate: (...args: unknown[]) => mockRouterNavigate(...args),
    replace: (...args: unknown[]) => mockRouterReplace(...args),
    canGoBack: () => true,
    back: jest.fn(),
  },
  useLocalSearchParams: () => ({}),
  useFocusEffect: (cb: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactInner = require('react');
    ReactInner.useEffect(() => {
      return cb();
    }, [cb]);
  },
}));

jest.mock('expo-router/react-navigation', () => ({
  useNavigationState: (selector: (state: { index: number }) => unknown) => selector({ index: 1 }),
  usePreventRemove: jest.fn(),
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

const mockPatientProfile = {
  paciente_id: 'paciente-a',
  nombre: 'María González',
  rut: '12.345.678-9',
  email: 'maria@ejemplo.com',
  telefono: '+56912345678',
  fecha_nacimiento: '1975-04-12',
  obtenido_en: '2026-10-15T00:00:00.000Z',
};

const mockActiveMedications = [
  {
    id: 'med-1',
    paciente_id: 'paciente-a',
    nombre: 'Ciclofosfamida 500mg',
    dosis: '500 mg',
    frecuencia: 'Cada 12 horas',
    via: 'Oral',
    indicaciones: 'Tomar con abundante agua',
    fecha_inicio: '2026-10-01',
    fecha_fin: '2026-10-20',
    activo: 1,
    obtenido_en: '2026-10-15T00:00:00.000Z',
  },
];

const mockReportData = {
  summary: {
    vitalsCount: 5,
    symptomsCount: 2,
    avgTemperature: 36.6,
    avgPulse: 74,
  },
  vitals: [],
  symptoms: [],
};

const mockSavedReports = [
  {
    filename: 'reporte_paciente-a_30d_2026-10-16T12-00-00.pdf',
    periodDays: 30,
    format: 'pdf' as const,
    sizeBytes: 45000,
    generatedAt: '2026-10-16T12:00:00.000Z',
  },
];

const mockRepository = {
  profile: jest.fn().mockResolvedValue(mockPatientProfile),
  activeMedications: jest.fn().mockResolvedValue(mockActiveMedications),
  assignedMedicalTeam: jest.fn().mockResolvedValue([]),
  reports: {
    getReportData: jest.fn().mockResolvedValue(mockReportData),
  },
};

const mockDeletePatientReport = jest.fn().mockResolvedValue(true);
const mockGetPatientReportList = jest.fn().mockResolvedValue(mockSavedReports);

jest.mock('../data/local/files/report-storage', () => ({
  deletePatientReport: (...args: unknown[]) => mockDeletePatientReport(...args),
  getPatientReportList: (...args: unknown[]) => mockGetPatientReportList(...args),
  shareReportFile: jest.fn().mockResolvedValue('shared_sheet_opened'),
  assertSafeReportFileName: jest.fn(),
  getPatientReportDirectory: () => '/mock/reports/paciente-a',
  parseFormatFromReportFilename: () => 'pdf',
  parseTimestampFromReportFilename: () => '2026-10-16T12:00:00.000Z',
}));

jest.mock('../features/reports/report-pdf', () => ({
  generateAndPersistReportPdf: jest.fn().mockResolvedValue({
    filename: 'reporte_paciente-a_30d_2026-10-17T12-00-00.pdf',
    persistentUri: '/mock/reports/paciente-a/reporte.pdf',
  }),
}));

jest.mock('../features/reports/report-xlsx', () => ({
  generateAndPersistReportXlsx: jest.fn().mockResolvedValue({
    filename: 'reporte_paciente-a_30d_2026-10-17T12-00-00.xlsx',
    persistentUri: '/mock/reports/paciente-a/reporte.xlsx',
  }),
}));

const mockLocalDataContext = {
  repository: mockRepository,
  patientId: 'paciente-a',
  runSave: jest.fn().mockImplementation((cb: () => Promise<unknown>) => cb()),
  saving: false,
  database: {},
  notificationAdapter: null,
  reconcileReminders: jest.fn(),
  bumpRemindersRevision: jest.fn(),
  trackOperation: jest.fn().mockImplementation((cb: () => Promise<unknown>) => cb()),
};

jest.mock('../providers/LocalDataProvider', () => ({
  useLocalData: () => mockLocalDataContext,
}));

import { MedicationScreen } from '../features/profile/MedicationScreen';
import { ProfileScreen } from '../features/profile/ProfileScreen';
import { ReportsScreen } from '../features/reports/ReportsScreens';

describe('Profile y Reports UI (Bloque 5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ProfileScreen', () => {
    it('organiza la consulta en las tres secciones acordadas con filas compactas', async () => {
      await render(<ProfileScreen />);

      await waitFor(() => {
        expect(screen.getByText('María González')).toBeTruthy();
      });

      // Secciones principales como encabezados
      expect(screen.getByRole('header', { name: 'Mi tratamiento' })).toBeTruthy();
      expect(screen.getByRole('header', { name: 'Mis datos' })).toBeTruthy();
      expect(screen.getByRole('header', { name: 'Configuración y privacidad' })).toBeTruthy();

      // Entradas bajo Mi tratamiento
      expect(screen.getByRole('button', { name: 'Mi tratamiento' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Mis medicamentos' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Mi equipo de salud' })).toBeTruthy();

      // Entradas bajo Mis datos
      expect(screen.getByRole('button', { name: 'Datos personales' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Código de vinculación' })).toBeTruthy();

      // Entradas bajo Configuración y privacidad
      expect(screen.getByRole('button', { name: 'Preferencias' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Consentimientos' })).toBeTruthy();
      expect(screen.getByText('Cerrar sesión')).toBeTruthy();
    });
  });

  describe('MedicationScreen', () => {
    it('muestra medicamentos activos con fechas civiles formateadas y botón para configurar aviso', async () => {
      await render(<MedicationScreen />);

      await waitFor(() => {
        expect(screen.getByText('Ciclofosfamida 500mg')).toBeTruthy();
      });

      expect(screen.getByText('Dosis')).toBeTruthy();
      expect(screen.getByText('500 mg')).toBeTruthy();
      // Fechas civiles en formato DD/MM/AAAA
      expect(screen.getByText('01/10/2026')).toBeTruthy();
      expect(screen.getByText('20/10/2026')).toBeTruthy();

      const configButton = screen.getByText('Configurar aviso');
      expect(configButton).toBeTruthy();

      fireEvent.press(configButton);

      expect(mockRouterPush).toHaveBeenCalledWith({
        pathname: '/recordatorios/editar',
        params: { tipo: 'medicacion', medicamentoId: 'med-1' },
      });
    });
  });

  describe('ReportsScreen', () => {
    it('presenta configuración breve con 30 días y PDF por defecto, y acción principal antes de archivos guardados', async () => {
      await render(<ReportsScreen />);

      await waitFor(() => {
        expect(screen.getByText('Reportes')).toBeTruthy();
      });

      // Resumen sin duplicar período o formato
      expect(screen.getByText('Signos vitales registrados')).toBeTruthy();
      expect(screen.getByText('5 registros')).toBeTruthy();
      expect(screen.getByText('Síntomas reportados')).toBeTruthy();
      expect(screen.getByText('2 reportes')).toBeTruthy();

      // Acción principal para generar o actualizar
      expect(screen.getByText('Actualizar y compartir PDF')).toBeTruthy();

      // Archivo guardado con botón Compartir PDF
      expect(screen.getByText('Compartir PDF')).toBeTruthy();
      expect(screen.getByText('Eliminar reporte')).toBeTruthy();
    });

    it('solicita confirmación antes de eliminar un reporte y no realiza E/S si se cancela', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert');

      await render(<ReportsScreen />);

      await waitFor(() => {
        expect(screen.getByText('Eliminar reporte')).toBeTruthy();
      });

      fireEvent.press(screen.getByText('Eliminar reporte'));

      expect(alertSpy).toHaveBeenCalledWith(
        '¿Eliminar este reporte?',
        'Se eliminará el archivo de este dispositivo. Tus mediciones y síntomas se conservarán.',
        expect.any(Array),
        expect.any(Object),
      );

      const alertButtons = alertSpy.mock.calls[0]?.[2] as {
        text: string;
        onPress?: () => void;
      }[];
      const cancelBtn = alertButtons.find((b) => b.text === 'Cancelar');
      expect(cancelBtn).toBeDefined();

      // Cancelar no ejecuta borrado
      cancelBtn?.onPress?.();
      expect(mockDeletePatientReport).not.toHaveBeenCalled();

      // Confirmar sí ejecuta borrado
      const deleteBtn = alertButtons.find((b) => b.text === 'Eliminar reporte');
      expect(deleteBtn).toBeDefined();
      deleteBtn?.onPress?.();

      expect(mockDeletePatientReport).toHaveBeenCalledWith(
        'paciente-a',
        'reporte_paciente-a_30d_2026-10-16T12-00-00.pdf',
      );

      alertSpy.mockRestore();
    });
  });
});
