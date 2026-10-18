/// <reference types="jest" />

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

// Mock expo-router
const mockUseLocalSearchParams = jest.fn();
const mockRedirect = jest.fn();
jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    router: {
      push: jest.fn(),
      replace: jest.fn(),
      back: jest.fn(),
      navigate: jest.fn(),
      canGoBack: jest.fn().mockReturnValue(true),
    },
    Redirect: (props: unknown) => {
      mockRedirect(props);
      return null;
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

// Mock linking
const mockOpenURL = jest.fn().mockResolvedValue(true);
jest.mock('expo-linking', () => ({
  openURL: (...args: unknown[]) => mockOpenURL(...args),
  canOpenURL: jest.fn().mockResolvedValue(true),
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
  trackOperation: jest.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
  saving: false,
  database: {},
  isClosing: false,
  manager: {
    getPatientId: () => 'paciente-a',
    getContextEpoch: () => 1,
  },
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

import { router } from 'expo-router';
import LegacyVisorRedirect from '../app/(tabs)/educacion/visor';
import LegacyCopiesRedirect from '../app/(tabs)/educacion/copias';
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
import { InfographicViewerScreen } from '../features/education/InfographicViewerScreen';
import { resetYouTubeLaunchDebounceForTesting } from '../features/education/youtube-launcher';
import * as bulkCoordinator from '../features/education/bulk-download-coordinator';

describe('Pruebas de interfaz (UI) para módulo de Educación', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetYouTubeLaunchDebounceForTesting();
    mockGetNetworkStateAsync.mockResolvedValue({ isConnected: true, isInternetReachable: true });
    mockDeleteResourceFile.mockResolvedValue(true);
    mockResourceFileExists.mockReturnValue(true);
    mockReadResourceFile.mockResolvedValue('## Contenido');
    mockOpenURL.mockResolvedValue(true);
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

      const deleteBtn = await screen.findByText('Quitar descarga');
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
        expect(cat.countLabel).toBe(`${expectedCount} contenido${expectedCount === 1 ? '' : 's'}`);
      }
    });

    it('renderiza las 9 categorías clínicas acordadas en la pantalla principal de educación', async () => {
      await render(<EducationScreen />);

      await waitFor(() => {
        expect(screen.getByText('Conociendo la Unidad Oncológica')).toBeTruthy();
        expect(screen.getByText('Conociendo el cáncer')).toBeTruthy();
        expect(screen.getByText('Conociendo la quimioterapia')).toBeTruthy();
        expect(screen.getByText('Dispositivos de tratamiento')).toBeTruthy();
        expect(screen.getByText('Efectos secundarios')).toBeTruthy();
        expect(screen.getByText('Salud mental')).toBeTruthy();
        expect(screen.getByText('Alimentación')).toBeTruthy();
        expect(screen.getByText('Signos de alarma')).toBeTruthy();
        expect(screen.getByText('Gestoras de casos')).toBeTruthy();
      });
    });

    it('permite alternar filtros de formato (Todos, Videos, Infografías) en la pantalla de categoría', async () => {
      mockUseLocalSearchParams.mockReturnValue({ categoria: 'alimentacion' });

      await render(<EducationCategoryScreen />);

      // Debe mostrar el título de la categoría
      await waitFor(() => {
        expect(screen.getByText('Alimentación')).toBeTruthy();
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
        expect(screen.getByText(/1\. HIDRATACIÓN CONSTANTE/)).toBeTruthy();
      });
    });
  });

  describe('Acceso directo en 1 toque y modal de información (Bloque 2)', () => {
    it('al pulsar la tarjeta de video, lanza directamente YouTube y registra interacción en segundo plano', async () => {
      mockUseLocalSearchParams.mockReturnValue({ categoria: 'alimentacion' });

      await render(<EducationCategoryScreen />);

      await waitFor(() => {
        expect(screen.getByText('Alimentación')).toBeTruthy();
      });

      // Tarjeta con chip de formato
      expect(screen.getByText('Video · Requiere internet')).toBeTruthy();

      const videoCard = screen.getByLabelText(
        'Video: Opciones de líquidos e hidratación diaria, Video · Requiere internet',
      );
      await fireEvent.press(videoCard);

      // Debe abrir enlace de YouTube en modo demo
      expect(mockOpenURL).toHaveBeenCalledWith('https://www.youtube.com');

      // Debe registrar la interacción en SQLite
      expect(mockRepository.education.recordYouTubeInteraction).toHaveBeenCalledWith(
        expect.objectContaining({
          contentId: 'edu-video-hidratacion-facil',
        }),
      );
    });

    it('al pulsar la tarjeta de infografía, navega directamente a /visor-infografia a pantalla completa', async () => {
      mockUseLocalSearchParams.mockReturnValue({ categoria: 'alimentacion' });

      await render(<EducationCategoryScreen />);

      await waitFor(() => {
        expect(screen.getByText('Alimentación')).toBeTruthy();
      });

      // Tarjeta con chip de formato
      expect(screen.getByText('Infografía · Disponible para guardar')).toBeTruthy();

      const infoCard = screen.getByLabelText(
        'Infografía: Guía nutricional en quimioterapia, Infografía · Disponible para guardar',
      );
      await fireEvent.press(infoCard);

      // Debe navegar directamente al visor a pantalla completa
      expect(router.push).toHaveBeenCalledWith(
        '/visor-infografia?recurso=' + encodeURIComponent('edu-infografia-alimentacion'),
      );
    });

    it('al pulsar Información en la tarjeta, abre el modal sin abrir YouTube ni navegar al visor', async () => {
      mockUseLocalSearchParams.mockReturnValue({ categoria: 'alimentacion' });

      await render(<EducationCategoryScreen />);

      await waitFor(() => {
        expect(screen.getByText('Alimentación')).toBeTruthy();
      });

      const infoBtn = screen.getByLabelText(
        'Información de Infografía: Guía nutricional en quimioterapia',
      );
      await fireEvent.press(infoBtn);

      // No debe navegar al visor ni abrir YouTube
      expect(router.push).not.toHaveBeenCalled();
      expect(mockOpenURL).not.toHaveBeenCalled();

      // Debe estar visible el modal de información con sus acciones
      expect(
        screen.getByRole('header', { name: 'Infografía: Guía nutricional en quimioterapia' }),
      ).toBeTruthy();
      expect(screen.getByText('Guardar infografía sin conexión')).toBeTruthy();
      expect(screen.getByText('Cerrar')).toBeTruthy();

      // Cerrar modal
      const closeBtn = screen.getByLabelText('Cerrar información');
      await fireEvent.press(closeBtn);

      await waitFor(() => {
        expect(screen.queryByLabelText('Cerrar información')).toBeNull();
      });
    });

    it('en el modal de información de una infografía descargada, permite quitar la descarga comprobando borrado físico', async () => {
      mockUseLocalSearchParams.mockReturnValue({ categoria: 'alimentacion' });
      mockRepository.education.listLocalCopies.mockResolvedValueOnce([
        {
          patientId: 'paciente-a',
          contentId: 'edu-infografia-alimentacion',
          rutaRelativa: 'edu-infografia-alimentacion.12345.png',
          formato: 'png',
          tamanoBytes: 4096,
          estado: 'descargado',
          revisionDeclarada: false,
        },
      ]);

      await render(<EducationCategoryScreen />);

      await waitFor(() => {
        expect(screen.getByText('Infografía · Disponible sin internet')).toBeTruthy();
      });

      const infoBtn = screen.getByLabelText(
        'Información de Infografía: Guía nutricional en quimioterapia',
      );
      await fireEvent.press(infoBtn);

      // Dentro del modal se debe mostrar la opción de quitar descarga
      const removeBtn = await screen.findByText('Quitar descarga');
      await fireEvent.press(removeBtn);

      // Debe confirmar la eliminación física antes de actualizar SQLite
      expect(mockDeleteResourceFile).toHaveBeenCalled();
      expect(mockRepository.education.removeLocalCopy).toHaveBeenCalledWith(
        'edu-infografia-alimentacion',
      );
    });

    it('la ruta legacy /educacion/visor redirige correctamente a /visor-infografia', async () => {
      mockUseLocalSearchParams.mockReturnValue({ recurso: 'edu-infografia-alimentacion' });

      await render(<LegacyVisorRedirect />);

      expect(mockRedirect).toHaveBeenCalledWith(
        expect.objectContaining({
          href: {
            pathname: '/visor-infografia',
            params: { recurso: 'edu-infografia-alimentacion' },
          },
        }),
      );
    });
  });

  describe('Visor ampliado de infografías (InfographicViewerScreen)', () => {
    it('renderiza título, botón de cierre superpuesto, imagen a pantalla completa y controles de accesibilidad', async () => {
      mockUseLocalSearchParams.mockReturnValue({ recurso: 'edu-infografia-alimentacion' });

      await render(<InfographicViewerScreen />);

      await waitFor(() => {
        expect(screen.getByText('Infografía: Guía nutricional en quimioterapia')).toBeTruthy();
      });

      // Botón accesible de cierre superpuesto
      expect(screen.getByLabelText('Cerrar visor de infografía')).toBeTruthy();
      expect(screen.getByText('Cerrar')).toBeTruthy();

      // Botón de texto alternativo
      expect(
        screen.getByLabelText('Leer contenido en texto accesible de la infografía'),
      ).toBeTruthy();
      expect(screen.getByText('Texto accesible')).toBeTruthy();

      // Botón de opciones accesibles de zoom
      expect(screen.getByLabelText('Opciones accesibles de zoom')).toBeTruthy();
      expect(screen.getByText('Zoom')).toBeTruthy();

      // Componente interactivo de imagen a pantalla completa
      expect(
        screen.getByLabelText(/Infografía a pantalla completa:.*Guía nutricional en quimioterapia/),
      ).toBeTruthy();
    });

    it('permite desplegar opciones de zoom accesibles y ajustar el nivel de ampliación con anuncios para TalkBack', async () => {
      mockUseLocalSearchParams.mockReturnValue({ recurso: 'edu-infografia-alimentacion' });

      await render(<InfographicViewerScreen />);

      await waitFor(() => {
        expect(screen.getByLabelText('Opciones accesibles de zoom')).toBeTruthy();
      });

      // Abrir controles accesibles de zoom
      const zoomOptionsBtn = screen.getByLabelText('Opciones accesibles de zoom');
      fireEvent.press(zoomOptionsBtn);

      await waitFor(() => {
        expect(screen.getByLabelText('Aumentar zoom')).toBeTruthy();
        expect(screen.getByLabelText('Reducir zoom')).toBeTruthy();
        expect(screen.getByLabelText('Restablecer tamaño normal')).toBeTruthy();
      });

      // Aumentar zoom (+): pasa de 100% a 175%
      const zoomInBtn = screen.getByLabelText('Aumentar zoom');
      fireEvent.press(zoomInBtn);

      await waitFor(() => {
        expect(screen.getByText('Nivel de zoom al 175%')).toBeTruthy();
      });

      // Aumentar zoom (+) nuevamente: pasa a 250%
      fireEvent.press(zoomInBtn);

      await waitFor(() => {
        expect(screen.getByText('Nivel de zoom al 250%')).toBeTruthy();
      });

      // Reducir zoom (-): regresa a 175%
      const zoomOutBtn = screen.getByLabelText('Reducir zoom');
      fireEvent.press(zoomOutBtn);

      await waitFor(() => {
        expect(screen.getByText('Nivel de zoom al 175%')).toBeTruthy();
      });

      // Restablecer tamaño normal
      const resetBtn = screen.getByLabelText('Restablecer tamaño normal');
      fireEvent.press(resetBtn);

      await waitFor(() => {
        expect(screen.getByText('Imagen ajustada a la pantalla (100%)')).toBeTruthy();
      });
    });

    it('admite acciones de accesibilidad TalkBack (activate, increment, decrement) directamente sobre la imagen', async () => {
      mockUseLocalSearchParams.mockReturnValue({ recurso: 'edu-infografia-alimentacion' });

      await render(<InfographicViewerScreen />);

      await waitFor(() => {
        expect(
          screen.getByLabelText(
            /Infografía a pantalla completa:.*Guía nutricional en quimioterapia/,
          ),
        ).toBeTruthy();
      });

      const imageNode = screen.getByLabelText(
        /Infografía a pantalla completa:.*Guía nutricional en quimioterapia/,
      );

      // Doble toque accesible / activate: conmuta a 250%
      fireEvent(imageNode, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });

      await waitFor(() => {
        expect(screen.getByText('Imagen ampliada al 250%')).toBeTruthy();
      });

      // Segundo activate: regresa a 100%
      fireEvent(imageNode, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });

      await waitFor(() => {
        expect(screen.getByText('Imagen ajustada a la pantalla (100%)')).toBeTruthy();
      });
    });

    it('abre el modal accesible de texto offline y lo cierra correctamente', async () => {
      mockUseLocalSearchParams.mockReturnValue({ recurso: 'edu-infografia-alimentacion' });

      await render(<InfographicViewerScreen />);

      await waitFor(() => {
        expect(screen.getByText('Texto accesible')).toBeTruthy();
      });

      // Abrir modal
      const textBtn = screen.getByText('Texto accesible');
      fireEvent.press(textBtn);

      await waitFor(() => {
        expect(screen.getByText('Texto alternativo accesible')).toBeTruthy();
        expect(screen.getByText(/1\. HIDRATACIÓN CONSTANTE/)).toBeTruthy();
      });

      // Cerrar modal
      const closeBtn = screen.getByText('Cerrar lectura');
      fireEvent.press(closeBtn);

      await waitFor(() => {
        expect(screen.queryByText('Texto alternativo accesible')).toBeNull();
      });
    });

    it('cierra el visor llamando a router.back cuando puede retroceder', async () => {
      mockUseLocalSearchParams.mockReturnValue({ recurso: 'edu-infografia-alimentacion' });
      (router.canGoBack as jest.Mock).mockReturnValue(true);

      await render(<InfographicViewerScreen />);

      await waitFor(() => {
        expect(screen.getByText('Infografía: Guía nutricional en quimioterapia')).toBeTruthy();
      });

      const closeBtn = screen.getByLabelText('Cerrar visor de infografía');
      fireEvent.press(closeBtn);

      expect(router.back).toHaveBeenCalled();
    });

    it('redirige a /educacion si no hay historial para retroceder', async () => {
      mockUseLocalSearchParams.mockReturnValue({ recurso: 'edu-infografia-alimentacion' });
      (router.canGoBack as jest.Mock).mockReturnValue(false);

      await render(<InfographicViewerScreen />);

      await waitFor(() => {
        expect(screen.getByText('Infografía: Guía nutricional en quimioterapia')).toBeTruthy();
      });

      const closeBtn = screen.getByLabelText('Cerrar visor de infografía');
      fireEvent.press(closeBtn);

      expect(router.replace).toHaveBeenCalledWith('/educacion');
    });
  });

  describe('Biblioteca unificada y descargas masivas (Bloque 3)', () => {
    it('la ruta legacy /educacion/copias redirige a /educacion?filtro=offline', async () => {
      await render(<LegacyCopiesRedirect />);

      expect(mockRedirect).toHaveBeenCalledWith(
        expect.objectContaining({
          href: '/educacion?filtro=offline',
        }),
      );
    });

    it('el botón Mis copias guardadas en la portada educativa navega a /educacion?filtro=offline', async () => {
      mockUseLocalSearchParams.mockReturnValue({});

      await render(<EducationScreen />);

      await waitFor(() => {
        expect(screen.getByText('Mis copias guardadas')).toBeTruthy();
      });

      const copiesCard = screen.getByLabelText('Ver mis copias guardadas sin conexión');
      fireEvent.press(copiesCard);

      expect(router.navigate).toHaveBeenCalledWith('/educacion?filtro=offline');
    });

    it('al acceder con filtro=offline, muestra la biblioteca unificada con las copias físicas válidas', async () => {
      mockUseLocalSearchParams.mockReturnValue({ filtro: 'offline' });
      mockRepository.education.listLocalCopies.mockResolvedValueOnce([
        {
          patientId: 'paciente-a',
          contentId: 'edu-infografia-alimentacion',
          rutaRelativa: 'edu-infografia-alimentacion.12345.png',
          formato: 'png',
          tamanoBytes: 4096,
          estado: 'descargado',
          revisionDeclarada: true,
          revisionDeclaradaEn: '2026-10-18T10:00:00Z',
          titulo: 'Guía nutricional en quimioterapia',
        },
      ]);
      mockResourceFileExists.mockReturnValue(true);

      await render(<EducationScreen />);

      await waitFor(() => {
        expect(screen.getByText('Filtro: Sin conexión')).toBeTruthy();
        expect(screen.getByText('Guía nutricional en quimioterapia')).toBeTruthy();
        expect(screen.getByText('Infografía · Disponible sin internet')).toBeTruthy();
      });

      // Tocar la tarjeta abre el visor a pantalla completa en 1 toque
      const copyCard = screen.getByLabelText(
        'Guía nutricional en quimioterapia, Infografía · Disponible sin internet',
      );
      fireEvent.press(copyCard);

      expect(router.push).toHaveBeenCalledWith(
        '/visor-infografia?recurso=' + encodeURIComponent('edu-infografia-alimentacion'),
      );
    });

    it('en la biblioteca offline, muestra estado vacío cuando el paciente no tiene copias', async () => {
      mockUseLocalSearchParams.mockReturnValue({ filtro: 'offline' });
      mockRepository.education.listLocalCopies.mockResolvedValueOnce([]);

      await render(<EducationScreen />);

      await waitFor(() => {
        expect(screen.getByText('Sin copias guardadas')).toBeTruthy();
      });

      const returnBtn = screen.getByLabelText('Ver todas las categorías');
      fireEvent.press(returnBtn);

      expect(router.navigate).toHaveBeenCalledWith('/educacion');
    });

    it('muestra el botón para guardar todas las infografías sin conexión en la portada', async () => {
      mockUseLocalSearchParams.mockReturnValue({});

      await render(<EducationScreen />);

      await waitFor(() => {
        expect(screen.getByText('Guardar todas las infografías sin conexión')).toBeTruthy();
      });
    });

    it('al presionar guardar todas, reporta resultados parciales y permite reintentar pendientes', async () => {
      mockUseLocalSearchParams.mockReturnValue({});
      const runBulkSpy = jest
        .spyOn(bulkCoordinator, 'runBulkInfographicDownload')
        .mockResolvedValueOnce({
          total: 2,
          downloaded: 1,
          skipped: 0,
          failed: 1,
          pendingResources: [
            {
              id: 'fail-info',
              title: 'Infografía con error',
              category: 1,
              categoryName: 'General',
              description: 'Desc',
              type: 'infografia',
              version: '1.0.0',
            },
          ],
          errors: [
            { resourceId: 'fail-info', title: 'Infografía con error', message: 'Disco lleno' },
          ],
          cancelled: false,
          alreadyUpToDate: false,
          message: 'Se guardaron 1 de 2 infografías. 1 pendiente.',
        });

      await render(<EducationScreen />);

      const saveAllBtn = await screen.findByText('Guardar todas las infografías sin conexión');
      await fireEvent.press(saveAllBtn);

      await waitFor(() => {
        expect(screen.getByText('Se guardaron 1 de 2 infografías. 1 pendiente.')).toBeTruthy();
        expect(screen.getByText('Reintentar pendientes')).toBeTruthy();
      });

      // Presionar reintentar pendientes invoca nuevamente la descarga masiva
      runBulkSpy.mockResolvedValueOnce({
        total: 1,
        downloaded: 1,
        skipped: 0,
        failed: 0,
        pendingResources: [],
        errors: [],
        cancelled: false,
        alreadyUpToDate: false,
        message: '1 infografía guardada para ver sin conexión.',
      });

      const retryBtn = screen.getByText('Reintentar pendientes');
      await fireEvent.press(retryBtn);

      await waitFor(() => {
        expect(screen.getByText('1 infografía guardada para ver sin conexión.')).toBeTruthy();
        expect(screen.queryByText('Reintentar pendientes')).toBeNull();
      });
    });

    it('muestra estado Cancelando… mientras se interrumpe la descarga masiva', async () => {
      mockUseLocalSearchParams.mockReturnValue({});
      let resolveRun!: (val: bulkCoordinator.BulkDownloadResult) => void;
      const runningPromise = new Promise<bulkCoordinator.BulkDownloadResult>((res) => {
        resolveRun = res;
      });

      jest.spyOn(bulkCoordinator, 'runBulkInfographicDownload').mockImplementation(async (opts) => {
        opts.onProgress?.({
          current: 1,
          total: 2,
          percent: 50,
          currentTitle: 'Infografía en curso',
        });
        return runningPromise;
      });

      await render(<EducationScreen />);

      const saveAllBtn = await screen.findByText('Guardar todas las infografías sin conexión');
      await fireEvent.press(saveAllBtn);

      await waitFor(() => {
        expect(screen.getByText(/Guardando 1 de 2/)).toBeTruthy();
        expect(screen.getByText('Cancelar descarga')).toBeTruthy();
      });

      // Presionar cancelar
      const cancelBtn = screen.getByText('Cancelar descarga');
      await fireEvent.press(cancelBtn);

      await waitFor(() => {
        expect(screen.getAllByText('Cancelando…').length).toBeGreaterThanOrEqual(1);
      });

      // Resolver la descarga cancelada
      resolveRun({
        total: 2,
        downloaded: 1,
        skipped: 0,
        failed: 0,
        pendingResources: [],
        errors: [],
        cancelled: true,
        alreadyUpToDate: false,
        message: 'Descarga cancelada. Se conservaron 1 infografía completada.',
      });

      await waitFor(() => {
        expect(screen.getByText(/Descarga cancelada/)).toBeTruthy();
      });
    });

    it('en Educación, el toque en tarjeta de video invoca executeYouTubeLaunch con guardas de época y paciente', async () => {
      mockUseLocalSearchParams.mockReturnValue({ categoria: '1' });
      setEducationalCatalogReader(
        new InMemoryEducationalCatalogReader([
          {
            id: 'test-vid-guard',
            title: 'Video cuidados especiales',
            category: 1,
            categoryName: 'General',
            description: 'Desc',
            type: 'video',
            version: '1.0.0',
            youtubeVideoId: 'xyz123',
          },
        ]),
      );

      await render(<EducationCategoryScreen />);

      const videoCard = await screen.findByLabelText(
        'Video cuidados especiales, Video · Requiere internet',
      );
      await fireEvent.press(videoCard);

      expect(mockOpenURL).toHaveBeenCalledWith('https://www.youtube.com');
      expect(mockRepository.education.recordYouTubeInteraction).toHaveBeenCalledWith({
        contentId: 'test-vid-guard',
        youtubeVideoId: 'xyz123',
        versionOrigen: '1.0.0',
      });
    });
  });
});
