/// <reference types="jest" />

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
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
      canGoBack: jest.fn().mockReturnValue(true),
    },
    useLocalSearchParams: () => mockUseLocalSearchParams(),
    useFocusEffect: (cb: () => void | (() => void)) => {
      React.useEffect(() => {
        return cb();
      }, [cb]);
    },
  };
});

jest.mock('expo-router/react-navigation', () => ({
  useNavigationState: (selector: (state: { index: number }) => unknown) => selector({ index: 1 }),
}));

// Mock network
const mockGetNetworkStateAsync = jest
  .fn()
  .mockResolvedValue({ isConnected: true, isInternetReachable: true });
jest.mock('expo-network', () => ({
  getNetworkStateAsync: () => mockGetNetworkStateAsync(),
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
    listInteractions: jest.fn().mockResolvedValue([]),
    declareCopyReviewed: jest.fn().mockResolvedValue({ updated: true }),
    declareYouTubeReviewed: jest.fn().mockResolvedValue({ updated: true }),
    recordYouTubeInteraction: jest.fn().mockResolvedValue({ id: '1' }),
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
const mockDeleteResourceFile = jest.fn().mockResolvedValue(true);
const mockResourceFileExists = jest.fn().mockReturnValue(true);
const mockReadResourceFile = jest.fn().mockResolvedValue('## Contenido');

jest.mock('../data/local/files/resource-storage', () => ({
  deleteResourceFile: (...args: unknown[]) => mockDeleteResourceFile(...args),
  resourceFileExists: (...args: unknown[]) => mockResourceFileExists(...args),
  readResourceFile: (...args: unknown[]) => mockReadResourceFile(...args),
  reconcileResourceCopies: jest.fn().mockResolvedValue({}),
}));

import { EducationCopiesScreen } from '../features/education/EducationCopiesScreen';
import {
  getEducationalCatalogReader,
  InMemoryEducationalCatalogReader,
  setEducationalCatalogReader,
} from '../features/education/educational-catalog-service';
import {
  EducationScreen,
  EducationCategoryScreen,
  EducationResourceScreen,
} from '../features/education/EducationScreens';

describe('Pruebas de interfaz (UI) para módulo de Educación', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetNetworkStateAsync.mockResolvedValue({ isConnected: true, isInternetReachable: true });
    mockDeleteResourceFile.mockResolvedValue(true);
    mockResourceFileExists.mockReturnValue(true);
    mockReadResourceFile.mockResolvedValue('## Contenido');
    setEducationalCatalogReader(new InMemoryEducationalCatalogReader());
  });

  afterEach(() => {
    setEducationalCatalogReader(new InMemoryEducationalCatalogReader());
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

    it('cuando no hay conexión a internet, no se despacha el enlace de YouTube y muestra alerta', async () => {
      mockUseLocalSearchParams.mockReturnValue({ recurso: 'edu-video-induccion' });
      mockGetNetworkStateAsync.mockResolvedValueOnce({
        isConnected: false,
        isInternetReachable: false,
      });

      await render(<EducationResourceScreen />);

      const openBtn = await screen.findByText('Abrir en YouTube');
      await fireEvent.press(openBtn);

      // No debe llamar a recordYouTubeInteraction ni abrir enlace
      expect(mockRepository.education.recordYouTubeInteraction).not.toHaveBeenCalled();

      // Debe mostrar advertencia de falta de conexión
      expect(await screen.findByText(/No hay conexión a internet disponible/i)).toBeTruthy();
    });
  });

  describe('Detalle de infografía descargable y manejo de fallos', () => {
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

    it('cuando falla la eliminación física del archivo, SQLite conserva el registro y muestra error', async () => {
      mockUseLocalSearchParams.mockReturnValue({ recurso: 'edu-infografia-alimentacion' });
      mockRepository.education.getLocalCopy.mockResolvedValueOnce({
        patientId: 'paciente-a',
        contentId: 'edu-infografia-alimentacion',
        rutaRelativa: 'edu-infografia-alimentacion.12345.png',
        formato: 'png',
        tamanoBytes: 4096,
        estado: 'descargado',
        revisionDeclarada: false,
      });
      mockDeleteResourceFile.mockResolvedValueOnce(false);

      await render(<EducationResourceScreen />);

      const deleteBtn = await screen.findByText('Eliminar copia local');
      await fireEvent.press(deleteBtn);

      // No debe llamar a removeLocalCopy en la base de datos
      expect(mockRepository.education.removeLocalCopy).not.toHaveBeenCalled();

      // Debe mostrar mensaje de error explicativo
      expect(
        await screen.findByText(
          'No se pudo confirmar la eliminación física del archivo del almacenamiento local.',
        ),
      ).toBeTruthy();
    });

    it('ante error de carga de imagen, deshabilita botón de revisión y ofrece botón de reintento', async () => {
      mockUseLocalSearchParams.mockReturnValue({ recurso: 'edu-infografia-alimentacion' });
      mockRepository.education.getLocalCopy.mockResolvedValueOnce({
        patientId: 'paciente-a',
        contentId: 'edu-infografia-alimentacion',
        rutaRelativa: 'edu-infografia-alimentacion.12345.png',
        formato: 'png',
        tamanoBytes: 4096,
        estado: 'descargado',
        revisionDeclarada: false,
      });

      await render(<EducationResourceScreen />);

      const image = await screen.findByLabelText(
        'Infografía: Infografía: Guía nutricional en quimioterapia',
      );
      expect(image).toBeTruthy();

      // Simular fallo de renderizado de la imagen
      fireEvent(image, 'error', { nativeEvent: { error: 'Failed to load image' } });

      // Mensaje de advertencia visible
      expect(
        await screen.findByText(
          /No se pudo renderizar la infografía desde el almacenamiento local/i,
        ),
      ).toBeTruthy();

      // Botón de revisión deshabilitado
      const reviewButton = screen.getByRole('button', { name: 'Declarar material revisado' });
      expect(reviewButton.props.accessibilityState?.disabled).toBe(true);

      // Botón de recuperación disponible
      const retryBtn = screen.getByRole('button', { name: 'Reintentar visualización' });
      expect(retryBtn).toBeTruthy();

      // Al pulsar reintentar, se remonta la imagen con una nueva key para forzar nueva carga
      fireEvent.press(retryBtn);
      await waitFor(() => {
        expect(
          screen.queryByText(/No se pudo renderizar la infografía desde el almacenamiento local/i),
        ).toBeNull();
      });

      // Se muestra el estado de carga y la nueva instancia de la imagen montada
      expect(screen.getByText('Cargando visualización de imagen…')).toBeTruthy();
      const reloadedImage = screen.getByLabelText(
        'Infografía: Infografía: Guía nutricional en quimioterapia',
      );
      expect(reloadedImage).not.toBe(image);

      // Al completar exitosamente la nueva carga, desaparece la carga y se rehabilita la revisión
      fireEvent(reloadedImage, 'load');
      await waitFor(() => {
        expect(screen.queryByText('Cargando visualización de imagen…')).toBeNull();
        const activeReviewBtn = screen.getByRole('button', { name: 'Declarar material revisado' });
        expect(activeReviewBtn.props.accessibilityState?.disabled).toBeFalsy();
      });
    });
  });

  describe('Copia local existente desacoplada del catálogo', () => {
    it('permite leer copia local existente aunque el catálogo esté vacío o falte la entrada', async () => {
      mockUseLocalSearchParams.mockReturnValue({ recurso: 'edu-recurso-sin-catalogo' });
      // Simular catálogo vacío donde no existe este recurso
      setEducationalCatalogReader(new InMemoryEducationalCatalogReader([]));

      mockRepository.education.getLocalCopy.mockResolvedValueOnce({
        patientId: 'paciente-a',
        contentId: 'edu-recurso-sin-catalogo',
        rutaRelativa: 'edu-recurso-sin-catalogo.12345.md',
        formato: 'markdown',
        tamanoBytes: 1500,
        estado: 'descargado',
        titulo: 'Guía guardada sin catálogo',
        tipo: 'guia',
        descripcion: 'Material persistido localmente',
        revisionDeclarada: false,
      });
      mockReadResourceFile.mockResolvedValueOnce('# Guía local disponible offline');

      await render(<EducationResourceScreen />);

      // Debe mostrar el título del material recuperado de los metadatos de SQLite
      const titles = await screen.findAllByText('Guía guardada sin catálogo');
      expect(titles.length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText('Recurso no disponible')).toBeNull();

      // Botón para leer sin conexión disponible
      const readBtn = screen.getByText('Leer recurso sin conexión');
      await fireEvent.press(readBtn);

      // Debe desplegar el contenido leído
      expect(await screen.findByText('# Guía local disponible offline')).toBeTruthy();
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

  describe('Catálogo educativo desacoplado y 9 categorías', () => {
    it('calcula conteos dinámicamente según recursos reales sin números cableados', async () => {
      const reader = getEducationalCatalogReader();
      const categories = await reader.getCategories();
      const allResources = await reader.getAllResources();

      expect(categories.length).toBe(9);
      for (const cat of categories) {
        const expectedCount = allResources.filter((r) => r.category === cat.id).length;
        expect(cat.count).toBe(expectedCount);
        expect(cat.countLabel).toBe(`${expectedCount} contenidos`);
      }
    });

    it('renderiza las 9 categorías clínicas acordadas en la pantalla principal de educación', async () => {
      await render(<EducationScreen />);

      await waitFor(() => {
        expect(screen.getByText('Proceso de quimioterapia')).toBeTruthy();
        expect(screen.getByText('Manejo de síntomas')).toBeTruthy();
        expect(screen.getByText('Nutrición e hidratación')).toBeTruthy();
        expect(screen.getByText('Actividad física y descanso')).toBeTruthy();
        expect(screen.getByText('Cuidado emocional')).toBeTruthy();
        expect(screen.getByText('Sexualidad y salud reproductiva')).toBeTruthy();
        expect(screen.getByText('Vida cotidiana y relaciones')).toBeTruthy();
        expect(screen.getByText('Red de apoyo y recursos')).toBeTruthy();
        expect(screen.getByText('Preguntas frecuentes')).toBeTruthy();
      });
    });

    it('permite alternar filtros de formato (Todos, Videos, Infografías) en la pantalla de categoría', async () => {
      mockUseLocalSearchParams.mockReturnValue({ categoria: 'nutricion-hidratacion' });

      await render(<EducationCategoryScreen />);

      // Debe mostrar el título de la categoría
      await waitFor(() => {
        expect(screen.getByText('Nutrición e hidratación')).toBeTruthy();
      });

      // Debe contener los controles de filtro
      expect(screen.getByText('Todos')).toBeTruthy();
      const filterVideos = screen.getByText('Videos');
      const filterInfografias = screen.getByText('Infografías');

      // Inicialmente en "Todos": ambos recursos están presentes
      expect(screen.getByText('Infografía: Guía nutricional en quimioterapia')).toBeTruthy();
      expect(screen.getByText('Video: Opciones de líquidos e hidratación diaria')).toBeTruthy();

      // Filtrar por Videos
      fireEvent.press(filterVideos);
      await waitFor(() => {
        expect(screen.getByText('Video: Opciones de líquidos e hidratación diaria')).toBeTruthy();
        expect(screen.queryByText('Infografía: Guía nutricional en quimioterapia')).toBeNull();
      });

      // Filtrar por Infografías
      fireEvent.press(filterInfografias);
      await waitFor(() => {
        expect(screen.getByText('Infografía: Guía nutricional en quimioterapia')).toBeTruthy();
        expect(screen.queryByText('Video: Opciones de líquidos e hidratación diaria')).toBeNull();
      });
    });

    it('muestra contenido explicativo accesible para infografías con texto alternativo completo', async () => {
      mockUseLocalSearchParams.mockReturnValue({ recurso: 'edu-infografia-alimentacion' });

      await render(<EducationResourceScreen />);

      await waitFor(() => {
        expect(screen.getByText('Contenido explicativo accesible')).toBeTruthy();
        expect(screen.getByText(/Tres pilares nutricionales durante el tratamiento/)).toBeTruthy();
      });
    });
  });
});
