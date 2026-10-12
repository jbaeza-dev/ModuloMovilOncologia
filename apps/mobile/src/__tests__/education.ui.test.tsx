/// <reference types="jest" />

import { render, screen } from '@testing-library/react-native';
import React from 'react';

// Mock expo-router
const mockUseLocalSearchParams = jest.fn();
jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    router: {
      push: jest.fn(),
      replace: jest.fn(),
      back: jest.fn(),
    },
    useLocalSearchParams: () => mockUseLocalSearchParams(),
    useFocusEffect: (cb: () => void | (() => void)) => {
      React.useEffect(() => {
        return cb();
      }, [cb]);
    },
  };
});

// Mock network
jest.mock('expo-network', () => ({
  getNetworkStateAsync: jest
    .fn()
    .mockResolvedValue({ isConnected: true, isInternetReachable: true }),
}));

// Mock theme
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
}));

// Mock local data provider
const mockRepository = {
  education: {
    getLocalCopy: jest.fn().mockResolvedValue(null),
    getInteraction: jest.fn().mockResolvedValue(null),
    listLocalCopies: jest.fn().mockResolvedValue([]),
    declareCopyReviewed: jest.fn().mockResolvedValue({ updated: true }),
    declareYouTubeReviewed: jest.fn().mockResolvedValue({ updated: true }),
    removeLocalCopy: jest.fn().mockResolvedValue({ removed: true }),
  },
};

const mockUseLocalData = jest.fn().mockReturnValue({
  patientId: 'paciente-a',
  repository: mockRepository,
  runSave: jest.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
  saving: false,
  database: {},
});

jest.mock('../providers/LocalDataProvider', () => ({
  useLocalData: () => mockUseLocalData(),
}));

// Mock file storage helpers
jest.mock('../data/local/files/resource-storage', () => ({
  deleteResourceFile: jest.fn().mockResolvedValue(true),
  resourceFileExists: jest.fn().mockReturnValue(true),
  reconcileResourceCopies: jest.fn().mockResolvedValue({}),
}));

import { EducationCopiesScreen } from '../features/education/EducationCopiesScreen';
import { getEducationalCatalogReader } from '../features/education/educational-catalog-service';
import { EducationResourceScreen } from '../features/education/EducationScreens';

describe('Pruebas de interfaz (UI) para módulo de Educación', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Detalle de recurso multimedia YouTube', () => {
    it('muestra botón de abrir en YouTube y advertencia de conexión, sin botón de descarga', async () => {
      mockUseLocalSearchParams.mockReturnValue({ recurso: 'edu-video-induccion' });

      await render(<EducationResourceScreen />);

      // Debe mostrar el título del recurso en cabecera y sección
      const titles = await screen.findAllByText('Video: Conoce tu proceso de tratamiento');
      expect(titles.length).toBeGreaterThanOrEqual(1);

      // Muestra que es un video online de YouTube
      expect(screen.getByText(/externamente en YouTube/i)).toBeTruthy();

      // Muestra el botón de apertura externa
      expect(screen.getByText('Abrir en YouTube')).toBeTruthy();

      // No debe contener controles de descarga de video ni guardar copia
      expect(screen.queryByText('Descargar video')).toBeNull();
      expect(screen.queryByText(/Guardar.*sin conexión/i)).toBeNull();
    });
  });

  describe('Detalle de infografía descargable', () => {
    it('muestra botón para guardar copia local offline', async () => {
      mockUseLocalSearchParams.mockReturnValue({ recurso: 'edu-infografia-alimentacion' });

      await render(<EducationResourceScreen />);

      const titles = await screen.findAllByText('Infografía: Guía nutricional en quimioterapia');
      expect(titles.length).toBeGreaterThanOrEqual(1);

      // Debe contener botón de guardar copia
      expect(screen.getByText('Guardar infografía sin conexión')).toBeTruthy();

      // No debe ser tratado como video de YouTube
      expect(screen.queryByText('Abrir en YouTube')).toBeNull();
    });
  });

  describe('Pantalla «Mis copias» (EducationCopiesScreen)', () => {
    it('muestra estado vacío cuando el paciente no tiene copias guardadas', async () => {
      mockRepository.education.listLocalCopies.mockResolvedValueOnce([]);

      await render(<EducationCopiesScreen />);

      const emptyTitle = await screen.findByText('Sin copias en este filtro');
      expect(emptyTitle).toBeTruthy();
    });

    it('muestra copia guardada con su formato y estado de revisión', async () => {
      mockRepository.education.listLocalCopies.mockResolvedValueOnce([
        {
          patientId: 'paciente-a',
          contentId: 'edu-prep-sesion',
          rutaRelativa: 'edu-prep-sesion.12345.md',
          formato: 'markdown',
          tamanoBytes: 2048,
          descargadoEn: '2026-10-12T10:00:00Z',
          revisionDeclarada: true,
          revisionDeclaradaEn: '2026-10-12T11:00:00Z',
          titulo: 'Preparación para tu sesión',
          tipo: 'guia',
          estado: 'descargado',
        },
      ]);

      await render(<EducationCopiesScreen />);

      const copyTitle = await screen.findByText('Preparación para tu sesión');
      expect(copyTitle).toBeTruthy();

      // Debe indicar que fue revisada
      expect(screen.getByText(/Revisada el/i)).toBeTruthy();

      // Debe ofrecer opción de lectura offline
      expect(screen.getByText('Leer guía')).toBeTruthy();
      expect(screen.getByText('Eliminar')).toBeTruthy();
    });

    it('muestra sección de error y opciones de reintento/eliminación para copias fallidas', async () => {
      mockRepository.education.listLocalCopies.mockResolvedValueOnce([
        {
          patientId: 'paciente-a',
          contentId: 'edu-infografia-alimentacion',
          rutaRelativa: 'edu-infografia-alimentacion.12345.png',
          formato: 'png',
          tamanoBytes: 0,
          descargadoEn: '2026-10-12T10:00:00Z',
          revisionDeclarada: false,
          titulo: 'Infografía: Guía nutricional en quimioterapia',
          tipo: 'infografia',
          estado: 'error',
        },
      ]);

      await render(<EducationCopiesScreen />);

      // Debe mostrar advertencia de error
      const errorPill = await screen.findByText('Error al guardar');
      expect(errorPill).toBeTruthy();

      // Debe ofrecer reintentar descarga y eliminar registro
      expect(screen.getByText('Reintentar descarga')).toBeTruthy();
      expect(screen.getByText('Eliminar registro')).toBeTruthy();

      // No debe permitir marcar como revisada directamente una infografía sin abrir
      expect(screen.queryByText('Marcar como revisada')).toBeNull();
    });
  });

  describe('Catálogo educativo desacoplado', () => {
    it('calcula conteos dinámicamente según recursos reales sin números cableados', async () => {
      const reader = getEducationalCatalogReader();
      const categories = await reader.getCategories();
      const allResources = await reader.getAllResources();

      expect(categories.length).toBeGreaterThan(0);
      for (const cat of categories) {
        const expectedCount = allResources.filter((r) => r.category === cat.id).length;
        expect(cat.count).toBe(expectedCount);
        expect(cat.countLabel).toBe(`${expectedCount} contenidos`);
      }
    });
  });
});
