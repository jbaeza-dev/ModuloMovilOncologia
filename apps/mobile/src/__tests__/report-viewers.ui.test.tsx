/// <reference types="jest" />

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { AccessibilityInfo } from 'react-native';

const mockRouterPush = jest.fn();
const mockRouterNavigate = jest.fn();
const mockRouterBack = jest.fn();

let mockSearchParams: Record<string, string> = {
  uri: '/mock/reports/paciente-a/reporte.pdf',
  filename: 'reporte_paciente-a_30d_2026-10-16T12-00-00.pdf',
  periodDays: '30',
};

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockRouterPush(...args),
    navigate: (...args: unknown[]) => mockRouterNavigate(...args),
    replace: jest.fn(),
    canGoBack: () => true,
    back: () => mockRouterBack(),
  },
  useLocalSearchParams: () => mockSearchParams,
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
    background: '#FFF7E7',
    surface: '#FFFFFF',
    mutedSurface: '#F3EFE6',
    primary: '#006A70',
    onPrimary: '#FFFFFF',
    primaryContainer: '#D1ECE8',
    onPrimaryContainer: '#002022',
    border: '#5C746C',
    inputBorder: '#5C746C',
    inputBorderFocused: '#006A70',
    text: '#191C1D',
    secondary: '#4A6360',
    error: '#BA1A1A',
    onError: '#FFFFFF',
    errorContainer: '#FFDAD6',
    onErrorContainer: '#410002',
    success: '#006A70',
    warning: '#7D5700',
    pressed: '#E0E0E0',
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { sm: 12, md: 18, full: 9999 },
};

jest.mock('../providers/ThemeProvider', () => ({
  useAppTheme: () => ({ theme: mockTheme }),
}));

jest.mock('react-native-webview', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    WebView: (props: unknown) => <View testID="mock-webview" {...(props as object)} />,
  };
});

const mockSnapshotData = {
  patientId: 'paciente-a',
  periodDays: 30 as const,
  generatedAt: '2026-10-16T12:00:00.000Z',
  timeZone: 'America/Santiago',
  periodStart: '2026-09-16T12:00:00.000Z',
  periodEnd: '2026-10-16T12:00:00.000Z',
  profile: {
    paciente_id: 'paciente-a',
    nombre: 'María González',
    rut: '12.345.678-9',
    email: 'maria@ejemplo.com',
    telefono: '+56912345678',
    fecha_nacimiento: '1975-04-12',
    obtenido_en: '2026-10-15T00:00:00.000Z',
  },
  treatment: null,
  linkingCode: {
    status: 'active_link' as const,
    displayText: 'Enlace activo',
    code: null,
    expiresAt: null,
    obtainedAt: '2026-10-15T00:00:00.000Z',
  },
  summary: {
    vitalsCount: 5,
    symptomsCount: 2,
    avgTemperature: 36.6,
    avgPulse: 74,
    avgSystolic: 120,
    avgDiastolic: 80,
    avgOxygenSaturation: 98,
    minTemperature: 36.2,
    maxTemperature: 37.1,
    minPulse: 70,
    maxPulse: 78,
  },
  vitals: [
    {
      id: 'vit-1',
      paciente_id: 'paciente-a',
      fecha_registro: '2026-10-16T08:00:00.000Z',
      fecha_subida: null,
      temperatura: 36.5,
      presion_sistolica: 118,
      presion_diastolica: 76,
      pulso: 72,
      saturacion_o2: 98,
    },
  ],
  symptoms: [
    {
      id: 'sym-1',
      paciente_id: 'paciente-a',
      fecha_registro: '2026-10-15T18:00:00.000Z',
      fecha_subida: null,
      descripcion: 'Náuseas',
    },
  ],
};

let mockReadPatientReportA11ySnapshotImpl: () => Promise<unknown> = () =>
  Promise.resolve(mockSnapshotData);

let mockFileBytesImpl: () => Promise<Uint8Array> = () =>
  Promise.resolve(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52])); // %PDF-1.4

let mockXlsxBytesImpl: (() => Promise<Uint8Array>) | null = null;

jest.mock('expo-file-system', () => {
  return {
    File: jest.fn().mockImplementation((uri: string) => ({
      uri,
      bytes: () =>
        uri && uri.endsWith('.xlsx')
          ? mockXlsxBytesImpl
            ? mockXlsxBytesImpl()
            : Promise.reject(new Error('File does not exist'))
          : mockFileBytesImpl(),
    })),
    Paths: { basename: (p: string) => p.split('/').pop() },
  };
});

jest.mock('../data/sync/file-protection', () => ({
  clinicalFileLease: () => () => {},
  readClinicalFile: (_uri: string, bytes: Uint8Array) => Promise.resolve(bytes),
}));

jest.mock('../data/local/files/report-storage', () => ({
  readPatientReportA11ySnapshot: () => mockReadPatientReportA11ySnapshotImpl(),
  shareReportFile: jest.fn().mockResolvedValue('shared_sheet_opened'),
}));

jest.mock('../providers/LocalDataProvider', () => ({
  useLocalData: () => ({
    patientId: 'paciente-a',
    isClosing: false,
  }),
}));

import { PdfReportViewer } from '../features/reports/PdfReportViewer';
import { SpreadsheetReportViewer } from '../features/reports/SpreadsheetReportViewer';

describe('Document Viewers UI (Etapa 5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = {
      uri: '/mock/reports/paciente-a/reporte.pdf',
      filename: 'reporte_paciente-a_30d_2026-10-16T12-00-00.pdf',
      periodDays: '30',
    };
    mockReadPatientReportA11ySnapshotImpl = () => Promise.resolve(mockSnapshotData);
    mockFileBytesImpl = () => Promise.resolve(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]));
    mockXlsxBytesImpl = null;
  });

  describe('PdfReportViewer', () => {
    it('muestra el visor visual de PDF por defecto con el WebView local', async () => {
      await render(<PdfReportViewer />);

      await waitFor(() => {
        expect(screen.getByText('Vista visual')).toBeTruthy();
      });

      expect(screen.getByText('Lectura accesible por voz')).toBeTruthy();
      expect(screen.getByTestId('mock-webview')).toBeTruthy();
      expect(screen.getByLabelText('Página anterior')).toBeTruthy();
      expect(screen.getByLabelText('Página siguiente')).toBeTruthy();
      expect(screen.getByLabelText('Aumentar zoom')).toBeTruthy();
      expect(screen.getByLabelText('Reducir zoom')).toBeTruthy();
      expect(screen.getByLabelText('Ajustar zoom al 100%')).toBeTruthy();
    });

    it('permite cambiar al modo de lectura por voz accesible con TalkBack', async () => {
      const announceSpy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');

      await render(<PdfReportViewer />);

      await waitFor(() => {
        expect(screen.getByText('Lectura accesible por voz')).toBeTruthy();
      });

      await fireEvent.press(screen.getByText('Lectura accesible por voz'));

      await waitFor(() => {
        expect(screen.getByText('Datos del paciente y tratamiento')).toBeTruthy();
      });

      expect(announceSpy).toHaveBeenCalledWith(
        'Modo de lectura accesible activado. Navega por encabezados.',
      );

      // Muestra datos del paciente, resumen clínico y síntomas accesible
      expect(screen.getByText(/María González/)).toBeTruthy();
      expect(screen.getByText('Resumen del período')).toBeTruthy();
      expect(screen.getByText('Total de mediciones:')).toBeTruthy();
      expect(screen.getByText('Síntomas registrados (1)')).toBeTruthy();
      expect(screen.getByText(/Náuseas/)).toBeTruthy();

      announceSpy.mockRestore();
    });

    it('muestra aviso explicativo para reportes antiguos que no tienen instantánea accesible', async () => {
      mockReadPatientReportA11ySnapshotImpl = () => Promise.resolve(null);

      await render(<PdfReportViewer />);

      await waitFor(() => {
        expect(screen.getByText('Lectura accesible por voz')).toBeTruthy();
      });

      await fireEvent.press(screen.getByText('Lectura accesible por voz'));

      await waitFor(() => {
        expect(screen.getByText('Reporte de versión anterior')).toBeTruthy();
      });

      expect(
        screen.getByText(
          /Este reporte fue generado con una versión anterior que no incluye lectura accesible estructurada/,
        ),
      ).toBeTruthy();
    });

    it('muestra el visor visual de PDF incluso para reportes antiguos sin instantánea', async () => {
      mockReadPatientReportA11ySnapshotImpl = () => Promise.resolve(null);

      await render(<PdfReportViewer />);

      await waitFor(() => {
        expect(screen.getByText('Vista visual')).toBeTruthy();
      });

      expect(screen.getByText('Lectura accesible por voz')).toBeTruthy();
      expect(screen.getByTestId('mock-webview')).toBeTruthy();
    });

    it('muestra mensaje de error explícito y botón a lectura accesible si falla la lectura del PDF en modo visual', async () => {
      mockFileBytesImpl = () => {
        throw new Error('Fallo de decodificación o archivo corrupto');
      };

      await render(<PdfReportViewer />);

      await waitFor(() => {
        expect(
          screen.getByText('No se pudo abrir el archivo PDF original en el visor integrado'),
        ).toBeTruthy();
      });

      // No renderiza WebView simulando fallback falso
      expect(screen.queryByTestId('mock-webview')).toBeNull();

      // Ofrece botón explícito para ver versión accesible
      const btnAccesible = screen.getByRole('button', {
        name: 'Ver versión de lectura accesible',
      });
      expect(btnAccesible).toBeTruthy();

      await fireEvent.press(btnAccesible);

      await waitFor(() => {
        expect(screen.getByText('Datos del paciente y tratamiento')).toBeTruthy();
      });
    });
  });

  describe('SpreadsheetReportViewer', () => {
    it('mantiene muchas columnas en una cuadrícula desplazable y permite elegir entre muchas hojas sin apilarlas', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const XLSX = require('xlsx');
      const wb = XLSX.utils.book_new();
      const headers = Array.from({ length: 24 }, (_, index) => `Índice ${index + 1}`);
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([headers, headers.map((_, index) => `Dato ${index + 1}`)]),
        'Signos vitales',
      );
      for (let index = 1; index <= 12; index++)
        XLSX.utils.book_append_sheet(
          wb,
          XLSX.utils.aoa_to_sheet([
            ['Campo', 'Valor'],
            ['Hoja elegida', index],
          ]),
          `Resumen ${index}`,
        );
      const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
      mockXlsxBytesImpl = () => Promise.resolve(bytes);
      await render(<SpreadsheetReportViewer />);
      await screen.findByText('Dato 24');
      expect(screen.getByText(/24 columnas/)).toBeTruthy();
      expect(screen.queryByText('Resumen 12')).toBeNull();
      await fireEvent.press(
        screen.getByRole('button', { name: 'Cambiar hoja. Actual: Signos vitales' }),
      );
      await fireEvent.press(screen.getByRole('button', { name: 'Abrir hoja Resumen 12' }));
      expect(await screen.findByText('Hoja elegida')).toBeTruthy();
      expect(screen.queryByText('Elegir hoja')).toBeNull();
    });
    beforeEach(() => {
      mockSearchParams = {
        uri: '/mock/reports/paciente-a/reporte.xlsx',
        filename: 'reporte_paciente-a_30d_2026-10-16T12-00-00.xlsx',
        periodDays: '30',
      };
    });

    it('muestra todas las columnas de un resumen cuyo título ocupa solo la primera celda, en pantalla completa y con Enviar', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const XLSX = require('xlsx');
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([
          ['Mi reporte'],
          ['Paciente', 'Paciente sintético'],
          ['Período', 'Últimos 30 días'],
        ]),
        'Resumen',
      );
      const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
      mockXlsxBytesImpl = () => Promise.resolve(bytes);
      await render(<SpreadsheetReportViewer />);
      await screen.findByText('Paciente sintético');
      expect(screen.getByText('Campo')).toBeTruthy();
      expect(screen.getByText('Detalle')).toBeTruthy();
      expect(screen.getByText('Mi reporte')).toBeTruthy();
      expect(screen.getByTestId('document-fullscreen')).toBeTruthy();
      expect(screen.getByText('Enviar')).toBeTruthy();
    });
    it('muestra mensaje de error con botón "Reintentar lectura" y permite recuperarse sin regenerar el archivo', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const XLSX = require('xlsx');
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([
        ['Fecha', 'Sistólica', 'Diastólica', 'Pulso', 'Nota'],
        [
          '2026-10-16',
          0,
          null,
          72,
          'Texto extenso sin truncamiento en la celda de observación clínica',
        ],
      ]);
      XLSX.utils.book_append_sheet(wb, ws, 'Signos vitales');
      const validXlsxBytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));

      let shouldFail = true;
      mockXlsxBytesImpl = () =>
        shouldFail
          ? Promise.reject(new Error('Error transitorio de lectura'))
          : Promise.resolve(validXlsxBytes);

      await render(<SpreadsheetReportViewer />);

      await waitFor(() => {
        expect(screen.getByText('No se pudo abrir la planilla')).toBeTruthy();
      });
      expect(screen.getByText('Error transitorio de lectura')).toBeTruthy();

      const retryBtn = screen.getByRole('button', { name: 'Reintentar lectura' });
      expect(retryBtn).toBeTruthy();

      // Al corregir el fallo transitorio y pulsar Reintentar lectura, carga todas las celdas (incluyendo 0 y vacías)
      shouldFail = false;
      await fireEvent.press(retryBtn);

      await waitFor(() => {
        expect(screen.getByText('2026-10-16')).toBeTruthy();
      });
      expect(screen.getByText('0')).toBeTruthy();
      expect(screen.getByText('72')).toBeTruthy();

      // Al tocar una celda con texto largo, abre el cuadro de detalle completo sin truncar
      await fireEvent.press(
        screen.getByText('Texto extenso sin truncamiento en la celda de observación clínica'),
      );
      expect(screen.getByLabelText('Cerrar detalle de celda')).toBeTruthy();
    });

    it('rechaza abrir una planilla cuya ruta pertenezca a otro paciente', async () => {
      mockSearchParams = {
        uri: '/mock/reportes_locales/paciente-intruso/reporte_30d_1700000000000.xlsx',
        filename: 'reporte_30d_1700000000000.xlsx',
        periodDays: '30',
      };

      await render(<SpreadsheetReportViewer />);

      await waitFor(() => {
        expect(screen.getByText('No se pudo abrir la planilla')).toBeTruthy();
      });
      expect(screen.getByText('El reporte solicitado pertenece a otro paciente.')).toBeTruthy();
    });
  });
});
