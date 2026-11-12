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

const mockInjectJavaScript = jest.fn();
jest.mock('react-native-webview', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactInner = require('react');
  return {
    WebView: ReactInner.forwardRef((props: unknown, ref: unknown) => {
      ReactInner.useImperativeHandle(ref, () => ({ injectJavaScript: mockInjectJavaScript }));
      return <View testID="mock-webview" {...(props as object)} />;
    }),
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
import { clearPdfJobs, startPdfJob } from '../features/reports/pdf-generation-jobs';
import { rememberRenderedPdf } from '../features/reports/rendered-pdf-cache';
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
    it('abre el PDF con navegación y zoom, sin selector de lectura por voz', async () => {
      await render(<PdfReportViewer />);
      expect(await screen.findByTestId('mock-webview')).toBeTruthy();
      expect(screen.queryByText('Lectura accesible por voz')).toBeNull();
      expect(screen.queryByText('Vista visual')).toBeNull();
      expect(screen.getByLabelText('Página anterior')).toBeTruthy();
      expect(screen.getByLabelText('Página siguiente')).toBeTruthy();
      expect(screen.getByLabelText('Aumentar zoom')).toBeTruthy();
      expect(screen.getByLabelText('Reducir zoom')).toBeTruthy();
      expect(screen.getByLabelText('Ajustar zoom al 100%')).toBeTruthy();
      expect(screen.getAllByRole('button', { name: /Compartir/ })).toHaveLength(1);
      expect(screen.getByText('Compartir')).toBeTruthy();
    });

    it('no carga la instantánea ni presenta datos del perfil en el visor simplificado', async () => {
      const readSnapshot = jest.fn().mockResolvedValue(mockSnapshotData);
      mockReadPatientReportA11ySnapshotImpl = readSnapshot;
      await render(<PdfReportViewer />);
      expect(await screen.findByTestId('mock-webview')).toBeTruthy();
      expect(readSnapshot).not.toHaveBeenCalled();
      expect(screen.queryByText(/María González/)).toBeNull();
      expect(screen.queryByText('12.345.678-9')).toBeNull();
    });

    it('abre también PDFs antiguos que no tienen instantánea', async () => {
      mockReadPatientReportA11ySnapshotImpl = () => Promise.resolve(null);
      await render(<PdfReportViewer />);
      expect(await screen.findByTestId('mock-webview')).toBeTruthy();
      expect(screen.queryByText('Lectura accesible por voz')).toBeNull();
    });

    it('comparte únicamente cuando se pulsa el botón superior', async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const storage = require('../data/local/files/report-storage');
      const announceSpy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
      await render(<PdfReportViewer />);
      await screen.findByTestId('mock-webview');
      expect(storage.shareReportFile).not.toHaveBeenCalled();
      await fireEvent.press(
        screen.getByRole('button', { name: 'Compartir reporte PDF con tu médico' }),
      );
      expect(storage.shareReportFile).toHaveBeenCalledWith(mockSearchParams.uri, 'pdf');
      expect(announceSpy).toHaveBeenCalledWith('Menú para compartir reporte abierto.');
      announceSpy.mockRestore();
    });

    it('muestra el error y permite reintentar sin crear un PDF alternativo ni un botón de voz', async () => {
      mockFileBytesImpl = () => Promise.reject(new Error('Archivo de prueba no disponible'));
      await render(<PdfReportViewer />);
      expect(
        await screen.findByText('No se pudo abrir el archivo PDF original en el visor integrado'),
      ).toBeTruthy();
      expect(screen.queryByTestId('mock-webview')).toBeNull();
      expect(screen.queryByRole('button', { name: /lectura accesible/ })).toBeNull();
      expect(screen.getAllByRole('button', { name: /Compartir/ })).toHaveLength(1);
      mockFileBytesImpl = () => Promise.resolve(new Uint8Array([37, 80, 68, 70, 45]));
      await fireEvent.press(screen.getByRole('button', { name: 'Reintentar lectura' }));
      expect(await screen.findByTestId('mock-webview')).toBeTruthy();
    });

    it('maneja el error del renderizador PDF y conserva compartir y reintentar', async () => {
      await render(<PdfReportViewer />);
      const viewer = await screen.findByTestId('mock-webview');
      await fireEvent(viewer, 'message', {
        nativeEvent: { data: JSON.stringify({ type: 'ERROR' }) },
      });
      expect(
        await screen.findByText('No se pudo mostrar el PDF. Vuelve a intentarlo.'),
      ).toBeTruthy();
      expect(screen.queryByTestId('mock-webview')).toBeNull();
      expect(screen.getByRole('button', { name: 'Reintentar lectura' })).toBeTruthy();
      expect(screen.getAllByRole('button', { name: /Compartir/ })).toHaveLength(1);
    });

    it('conserva el regreso a la lista de reportes', async () => {
      await render(<PdfReportViewer />);
      await screen.findByTestId('mock-webview');
      await fireEvent.press(screen.getByLabelText('Volver a la lista de reportes'));
      expect(mockRouterBack).toHaveBeenCalledTimes(1);
    });
  });

  describe('PdfReportViewer mientras se genera el reporte (RNF-06)', () => {
    const generado = {
      persistentUri: '/mock/reports/paciente-a/nuevo.pdf',
      filename: 'reporte_paciente-a_30d_2026-11-11T12-00-00.pdf',
    };
    const mensaje = (data: object) => ({ nativeEvent: { data: JSON.stringify(data) } });

    afterEach(() => clearPdfJobs());

    it('prepara el visor de inmediato y entrega el PDF en memoria cuando termina', async () => {
      let terminar!: (v: typeof generado) => void;
      const job = startPdfJob('paciente-a', () => new Promise((r) => (terminar = r)));
      mockSearchParams = { jobId: job.id, periodDays: '30' };
      await render(<PdfReportViewer />);
      const visor = await screen.findByTestId('mock-webview');
      expect(screen.getByText('Generando el reporte PDF…')).toBeTruthy();
      expect(screen.getByLabelText('Página siguiente')).toBeDisabled();
      expect(
        screen.getByRole('button', { name: 'Compartir reporte PDF con tu médico' }),
      ).toBeDisabled();

      await fireEvent(visor, 'message', mensaje({ type: 'READY' }));
      expect(mockInjectJavaScript).not.toHaveBeenCalled();

      rememberRenderedPdf(generado.persistentUri, 'paciente-a', 'JVBERi0=');
      terminar(generado);
      await waitFor(() =>
        expect(mockInjectJavaScript).toHaveBeenCalledWith("window.qcLoadPdf('JVBERi0='); true;"),
      );
      expect(await screen.findByText('Abriendo el reporte PDF…')).toBeTruthy();

      await fireEvent(
        visor,
        'message',
        mensaje({ type: 'PAGE_UPDATE', current: 1, total: 3, zoom: 1, rendered: true }),
      );
      expect(screen.queryByText('Abriendo el reporte PDF…')).toBeNull();
      expect(screen.getByText('Página 1 de 3')).toBeTruthy();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const storage = require('../data/local/files/report-storage');
      await fireEvent.press(
        screen.getByRole('button', { name: 'Compartir reporte PDF con tu médico' }),
      );
      expect(storage.shareReportFile).toHaveBeenCalledWith(generado.persistentUri, 'pdf');
    });

    it('espera a que pdf.js esté listo antes de entregar el PDF', async () => {
      rememberRenderedPdf(generado.persistentUri, 'paciente-a', 'JVBERi0=');
      const job = startPdfJob('paciente-a', () => Promise.resolve(generado));
      mockSearchParams = { jobId: job.id };
      await render(<PdfReportViewer />);
      const visor = await screen.findByTestId('mock-webview');
      await waitFor(() => expect(screen.getByText('Abriendo el reporte PDF…')).toBeTruthy());
      expect(mockInjectJavaScript).not.toHaveBeenCalled();
      await fireEvent(visor, 'message', mensaje({ type: 'READY' }));
      expect(mockInjectJavaScript).toHaveBeenCalledTimes(1);
    });

    it('sin copia en memoria lee el archivo recién guardado', async () => {
      const job = startPdfJob('paciente-a', () => Promise.resolve(generado));
      mockSearchParams = { jobId: job.id };
      await render(<PdfReportViewer />);
      expect(await screen.findByLabelText('Página siguiente')).toBeTruthy();
      expect(screen.queryByText('Generando el reporte PDF…')).toBeNull();
    });

    it('si la generación falla lo informa y permite volver a Mis reportes', async () => {
      const job = startPdfJob('paciente-a', () => Promise.reject(new Error('sin espacio')));
      mockSearchParams = { jobId: job.id };
      await render(<PdfReportViewer />);
      expect(await screen.findByText('No se pudo generar el reporte PDF')).toBeTruthy();
      expect(screen.queryByTestId('mock-webview')).toBeNull();
      await fireEvent.press(screen.getByRole('button', { name: 'Volver a Mis reportes' }));
      expect(mockRouterBack).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['de otro paciente', () => startPdfJob('paciente-b', () => Promise.resolve(generado)).id],
      ['desconocida', () => 'pdf-inexistente'],
    ])('no muestra una generación %s', async (_caso, crearId) => {
      mockSearchParams = { jobId: crearId() };
      await render(<PdfReportViewer />);
      expect(
        await screen.findByText(
          'Este reporte ya no está disponible. Vuelve a generarlo desde Mis reportes.',
        ),
      ).toBeTruthy();
    });

    it('si pdf.js falla, reintenta leyendo el archivo ya guardado', async () => {
      const job = startPdfJob('paciente-a', () => Promise.resolve(generado));
      rememberRenderedPdf(generado.persistentUri, 'paciente-a', 'JVBERi0=');
      mockSearchParams = { jobId: job.id };
      await render(<PdfReportViewer />);
      const visor = await screen.findByTestId('mock-webview');
      await fireEvent(visor, 'message', mensaje({ type: 'READY' }));
      await fireEvent(visor, 'message', mensaje({ type: 'ERROR' }));
      expect(
        await screen.findByText('No se pudo mostrar el PDF. Vuelve a intentarlo.'),
      ).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Reintentar lectura' }));
      expect(await screen.findByLabelText('Página siguiente')).toBeTruthy();
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
