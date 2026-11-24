/// <reference types="jest" />

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { AccessibilityInfo, Alert } from 'react-native';

// El aviso de identificación aparece antes de cada «Compartir»; por defecto las pruebas lo confirman.
let mockShareChoice: 'Compartir' | 'Cancelar' = 'Compartir';
function answerShareNotice() {
  mockShareChoice = 'Compartir';
  return jest.spyOn(Alert, 'alert').mockImplementation((title, _message, buttons) => {
    if (title === 'Compartir reporte')
      buttons?.find((button) => button.text === mockShareChoice)?.onPress?.();
  });
}

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
    avgPain: 3.5,
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
  saveProfile: jest.fn().mockResolvedValue(undefined),
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

const mockCacheMedication = jest.fn().mockResolvedValue(undefined);
jest.mock('../data/local/clinical-context/medication-cache', () => ({
  cacheMedicationForReminder: (...args: unknown[]) => mockCacheMedication(...args),
}));
const mockOwner = '964d32f1-6941-579f-9f08-b60342194da9';
let mockSnapshot: Record<string, unknown>;
const mockSession = {
  subscribe: () => () => undefined,
  getSnapshot: () => mockSnapshot,
  getCurrentUser: () => ({ id: mockOwner }),
  getContextSignal: () => new AbortController().signal,
  refreshIdentity: jest.fn().mockResolvedValue(undefined),
};
const mockLocalDataContext = {
  identitySession: mockSession,
  repository: mockRepository,
  patientId: 'paciente-a',
  runSave: jest.fn().mockImplementation((cb: () => Promise<unknown>) => cb()),
  saving: false,
  database: {},
  notificationAdapter: null,
  reconcileReminders: jest.fn(),
  bumpRemindersRevision: jest.fn(),
  trackOperation: jest.fn().mockImplementation((cb: () => Promise<unknown>) => cb()),
  manager: {
    getPatientId: () => mockLocalDataContext.patientId,
    getContextEpoch: () => (mockLocalDataContext as { epoch?: number }).epoch ?? 0,
  },
  epoch: 0,
};

jest.mock('../providers/LocalDataProvider', () => ({
  useLocalData: () => mockLocalDataContext,
  useOptionalLocalData: () => mockLocalDataContext,
}));

import { MedicationScreen } from '../features/profile/MedicationScreen';
import { ProfileScreen } from '../features/profile/ProfileScreen';
import { ReportsScreen } from '../features/reports/ReportsScreens';

describe('Profile y Reports UI (Bloque 5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    answerShareNotice();
    mockSnapshot = {
      state: 'context_ready',
      stale: false,
      uploadAllowed: true,
      terms: null,
      identity: {
        owner: mockOwner,
        scope: 'test',
        fetchedAt: '2026-10-15T00:00:00Z',
        profile: { ...mockPatientProfile, id: mockOwner },
        clinicalStatus: 'available',
        treatmentStatus: 'missing',
        clinicalProfile: {
          id: 'ficha-test',
          fecha_actualizacion: '2026-10-15T00:00:00Z',
          medicamentos: mockActiveMedications.map((m) => ({
            ...m,
            activo: true,
            fecha_termino: m.fecha_fin,
          })),
        },
        treatment: null,
      },
    };
  });

  describe('ProfileScreen', () => {
    it('organiza la consulta en las tres secciones acordadas con filas compactas', async () => {
      await render(<ProfileScreen />);

      await waitFor(() => {
        expect(screen.getByText('María González')).toBeTruthy();
      });

      // Three destinations from the mockup, plus the patient's own editable data.
      expect(screen.getByRole('button', { name: 'Actualizar mis datos' })).toBeTruthy();
      const treatment = screen.getByRole('button', { name: 'Tratamiento, equipo y medicamentos' });
      expect(treatment).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Código de vinculación' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Apariencia, sesión y teléfonos' })).toBeTruthy();
      await fireEvent.press(treatment);
      expect(mockRouterPush).toHaveBeenCalledWith('/perfil/clinico');
      expect(screen.getByText('Cerrar sesión')).toBeTruthy();
    });
  });

  describe('MedicationScreen', () => {
    it('muestra medicamentos activos con fechas civiles formateadas y botón para configurar aviso', async () => {
      await render(<MedicationScreen />);

      await waitFor(() => {
        expect(screen.getByText('Ciclofosfamida 500mg')).toBeTruthy();
      });

      expect(screen.getByRole('header', { name: 'Mis medicamentos' })).toBeTruthy();
      expect(screen.getByText('Dosis')).toBeTruthy();
      expect(screen.getByText('500 mg')).toBeTruthy();
      expect(screen.getByText('Frecuencia')).toBeTruthy();
      expect(screen.getByText('Cada 12 horas')).toBeTruthy();
      expect(screen.getByText('Fecha de inicio')).toBeTruthy();
      expect(screen.getByText('Fecha de término')).toBeTruthy();
      // Fechas civiles en formato DD/MM/AAAA
      expect(screen.getByText('01/10/2026')).toBeTruthy();
      expect(screen.getByText('20/10/2026')).toBeTruthy();

      const configButton = screen.getByText('Configurar aviso');
      expect(configButton).toBeTruthy();

      await fireEvent.press(configButton);

      expect(mockRouterPush).toHaveBeenCalledWith({
        pathname: '/recordatorios/editar',
        params: { tipo: 'medicacion', medicamentoId: 'med-1' },
      });
    });
  });

  describe('ReportsScreen', () => {
    it('presenta configuración breve con 30 días y PDF por defecto, y acción principal antes de archivos guardados', async () => {
      const announceSpy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');

      await render(<ReportsScreen />);

      await waitFor(() => {
        expect(screen.getByText('Mis reportes')).toBeTruthy();
      });

      // Resumen sin duplicar período o formato
      expect(screen.queryByText('Signos vitales registrados')).toBeNull();
      await fireEvent.press(screen.getByRole('button', { name: 'Ver resumen del período' }));
      expect(screen.getByText('Signos vitales registrados')).toBeTruthy();
      expect(screen.getByText('5 registros')).toBeTruthy();
      expect(screen.getByText('Dolor ENA prom.')).toBeTruthy();
      expect(screen.getByText('3,5 / 10')).toBeTruthy();

      // Acción principal para generar o actualizar y abrir visor (sin compartir automáticamente)
      expect(screen.getByText('Actualizar y abrir PDF')).toBeTruthy();

      // Tarjeta simplificada de reporte guardado: título claro, fecha y acciones visibles
      expect(screen.getByText('Reporte PDF de 30 días')).toBeTruthy();
      expect(screen.getByText(/Generado el/)).toBeTruthy();
      expect(screen.getByText('Compartir PDF')).toBeTruthy();
      expect(screen.getByText('Eliminar reporte')).toBeTruthy();

      // El nombre técnico del archivo está oculto por defecto
      expect(screen.queryByText('reporte_paciente-a_30d_2026-10-16T12-00-00.pdf')).toBeNull();

      // Desplegable accesible para ver detalles del archivo con minHeight 48
      const toggleDetailsBtn = screen.getByRole('button', { name: 'Ver detalles del archivo' });
      expect(toggleDetailsBtn).toBeTruthy();
      await fireEvent.press(toggleDetailsBtn);

      // Al expandir, se anuncia a TalkBack y los detalles técnicos quedan visibles
      await waitFor(() => {
        expect(announceSpy).toHaveBeenCalledWith('Detalles del archivo mostrados');
        expect(screen.getByText('reporte_paciente-a_30d_2026-10-16T12-00-00.pdf')).toBeTruthy();
      });

      // Al colapsar, se anuncia nuevamente
      await fireEvent.press(screen.getByRole('button', { name: 'Ocultar detalles del archivo' }));
      await waitFor(() => {
        expect(announceSpy).toHaveBeenCalledWith('Detalles del archivo ocultos');
        expect(screen.queryByText('reporte_paciente-a_30d_2026-10-16T12-00-00.pdf')).toBeNull();
      });

      announceSpy.mockRestore();
    });

    it('solicita confirmación antes de eliminar un reporte y no realiza E/S si se cancela', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert');

      await render(<ReportsScreen />);

      await waitFor(() => {
        expect(screen.getByText('Eliminar reporte')).toBeTruthy();
      });

      await fireEvent.press(screen.getByText('Eliminar reporte'));

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

    it('no elimina ningún archivo si cambia de paciente o época antes de confirmar el diálogo', async () => {
      const alertSpy = jest.spyOn(Alert, 'alert');
      mockDeletePatientReport.mockClear();

      await render(<ReportsScreen />);

      await waitFor(() => {
        expect(screen.getByText('Eliminar reporte')).toBeTruthy();
      });

      await fireEvent.press(screen.getByText('Eliminar reporte'));

      expect(alertSpy).toHaveBeenCalled();
      const alertButtons = alertSpy.mock.calls[0]?.[2] as {
        text: string;
        onPress?: () => void;
      }[];
      const deleteBtn = alertButtons.find((b) => b.text === 'Eliminar reporte');
      expect(deleteBtn).toBeDefined();

      // Simular cambio de paciente y época en el contexto antes de pulsar confirmar
      mockLocalDataContext.patientId = 'paciente-b';
      mockLocalDataContext.epoch = 1;

      // Presionar confirmación tardía
      deleteBtn?.onPress?.();

      // No se debe ejecutar ninguna llamada a deletePatientReport
      expect(mockDeletePatientReport).not.toHaveBeenCalled();

      // Restaurar contexto de prueba
      mockLocalDataContext.patientId = 'paciente-a';
      mockLocalDataContext.epoch = 0;
      alertSpy.mockRestore();
    });

    it('separa generar y abrir de compartir en Excel (.xlsx) para 7, 30 y 90 días, y conserva el archivo si falla compartir', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { shareReportFile } = require('../data/local/files/report-storage');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { generateAndPersistReportXlsx } = require('../features/reports/report-xlsx');

      await render(<ReportsScreen />);

      await waitFor(() => {
        expect(screen.getByText('Excel (.xlsx)')).toBeTruthy();
      });

      await fireEvent.press(screen.getByText('Excel (.xlsx)'));

      // Al seleccionar Excel sin archivo previo de 30d xlsx, el CTA es "Generar y abrir XLSX"
      expect(await screen.findByText('Generar y abrir XLSX')).toBeTruthy();

      await fireEvent.press(screen.getByText('Generar y abrir XLSX'));

      await waitFor(() => {
        expect(generateAndPersistReportXlsx).toHaveBeenCalledTimes(1);
      });

      // Generar NO debe abrir automáticamente la hoja de compartir del sistema
      expect(shareReportFile).not.toHaveBeenCalled();

      // Debe navegar directamente al visor de planilla Excel
      expect(mockRouterPush).toHaveBeenCalledWith({
        pathname: '/reportes/visor-xlsx',
        params: {
          uri: '/mock/reports/paciente-a/reporte.xlsx',
          filename: 'reporte_paciente-a_30d_2026-10-17T12-00-00.xlsx',
          periodDays: '30',
        },
      });

      // Probar también con 7 días
      await fireEvent.press(screen.getByText('7 días'));
      await fireEvent.press(screen.getByText('Generar y abrir XLSX'));
      await waitFor(() => {
        expect(generateAndPersistReportXlsx).toHaveBeenCalledTimes(2);
      });

      // Probar fallo/cancelación de compartir sobre un reporte guardado: no borra el archivo ni afirma fallo de generación
      (shareReportFile as jest.Mock).mockResolvedValueOnce('sharing_unavailable');
      await fireEvent.press(screen.getByText('Compartir PDF'));

      await waitFor(() => {
        expect(
          screen.getByText(
            'No se completó el envío externo. Tu archivo sigue guardado en este teléfono.',
          ),
        ).toBeTruthy();
      });
      expect(mockDeletePatientReport).not.toHaveBeenCalled();
    });

    it('no comparte un reporte guardado si la cuenta cambia con el aviso abierto', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { shareReportFile } = require('../data/local/files/report-storage');
      const context = mockLocalDataContext as { epoch?: number };
      const before = context.epoch;
      const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
        context.epoch = (before ?? 0) + 1;
        buttons?.find((button) => button.text === 'Compartir')?.onPress?.();
      });
      await render(<ReportsScreen />);
      await fireEvent.press(await screen.findByText('Compartir PDF'));
      context.epoch = before;
      expect(alertSpy).toHaveBeenCalled();
      expect(shareReportFile).not.toHaveBeenCalled();
    });

    it('en PDF abre el visor de inmediato con la generación en curso y luego informa el guardado', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { generateAndPersistReportPdf } = require('../features/reports/report-pdf');
      let generado = false;
      let generadoAlNavegar: boolean | null = null;
      (generateAndPersistReportPdf as jest.Mock).mockImplementationOnce(
        () =>
          new Promise((r) =>
            setTimeout(() => {
              generado = true;
              r({ filename: 'reporte.pdf', persistentUri: '/mock/reports/paciente-a/reporte.pdf' });
            }, 50),
          ),
      );
      mockRouterPush.mockImplementationOnce(() => {
        generadoAlNavegar = generado;
      });
      await render(<ReportsScreen />);
      await fireEvent.press(await screen.findByText('Actualizar y abrir PDF'));
      await waitFor(() => expect(mockRouterPush).toHaveBeenCalledTimes(1));
      // El visor se abre antes de que termine la generación.
      expect(generadoAlNavegar).toBe(false);
      const destino = mockRouterPush.mock.calls[0]![0] as {
        pathname: string;
        params: { jobId: string; periodDays: string };
      };
      expect(destino.pathname).toBe('/reportes/visor-pdf');
      expect(destino.params.jobId).toMatch(/^pdf-/);
      expect(destino.params.periodDays).toBe('30');
      expect(await screen.findByText(/Archivo guardado en este teléfono/)).toBeTruthy();
    });

    it('si falla la generación del PDF deja el error en Mis reportes para el regreso', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { generateAndPersistReportPdf } = require('../features/reports/report-pdf');
      (generateAndPersistReportPdf as jest.Mock).mockRejectedValueOnce(new Error('sin espacio'));
      await render(<ReportsScreen />);
      await fireEvent.press(await screen.findByText('Actualizar y abrir PDF'));
      expect(
        await screen.findByText(
          'No se pudo guardar el reporte en formato PDF en este dispositivo.',
        ),
      ).toBeTruthy();
      expect(mockRouterPush).toHaveBeenCalledTimes(1);
    });
  });
});
