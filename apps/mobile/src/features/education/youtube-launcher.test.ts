import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Linking from 'expo-linking';
import * as Network from 'expo-network';

import * as YouTubeModule from '../../data/local/education/youtube';
import type { AppRepository } from '../../data/local/repository';
import * as EnvModule from '../../utils/environment';
import { executeYouTubeLaunch, resetYouTubeLaunchDebounceForTesting } from './youtube-launcher';

vi.mock('expo-linking', () => ({
  openURL: vi.fn(),
  canOpenURL: vi.fn(),
}));

vi.mock('expo-network', () => ({
  getNetworkStateAsync: vi.fn(),
}));

describe('executeYouTubeLaunch', () => {
  const mockRepo = {
    education: {
      recordYouTubeInteraction: vi.fn(),
    },
  } as unknown as AppRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    resetYouTubeLaunchDebounceForTesting();
    vi.mocked(Network.getNetworkStateAsync).mockResolvedValue({
      isConnected: true,
      isInternetReachable: true,
    } as Network.NetworkState);
    vi.mocked(Linking.openURL).mockResolvedValue(undefined as never);
  });

  it('emite un aviso explicativo y no lanza la URL cuando el dispositivo está offline', async () => {
    vi.mocked(Network.getNetworkStateAsync).mockResolvedValue({
      isConnected: false,
      isInternetReachable: false,
    } as Network.NetworkState);

    const result = await executeYouTubeLaunch({
      resourceId: 'res-vid-1',
      youtubeVideoId: 'dQw4w9WgXcQ',
      version: '1.0.0',
      patientId: 'patient-1',
      repository: mockRepo,
    });

    expect(result.success).toBe(false);
    expect(result.isOffline).toBe(true);
    expect(result.error).toContain('requiere conexión a internet');
    expect(Linking.openURL).not.toHaveBeenCalled();
    expect(mockRepo.education.recordYouTubeInteraction).not.toHaveBeenCalled();
  });

  it('en modo demostración abre la portada de YouTube y rastrea la persistencia en background', async () => {
    vi.spyOn(EnvModule, 'isDemoMode').mockReturnValue(true);

    const result = await executeYouTubeLaunch({
      resourceId: 'res-vid-1',
      youtubeVideoId: 'dQw4w9WgXcQ',
      version: '1.0.0',
      patientId: 'patient-1',
      repository: mockRepo,
    });

    expect(result.success).toBe(true);
    expect(result.openedVia).toBe('web');
    expect(Linking.openURL).toHaveBeenCalledWith('https://www.youtube.com');
    expect(mockRepo.education.recordYouTubeInteraction).toHaveBeenCalledWith({
      contentId: 'res-vid-1',
      youtubeVideoId: 'dQw4w9WgXcQ',
      versionOrigen: '1.0.0',
    });
  });

  it('en modo normal delega en launchYouTubeVideo y persiste la interacción', async () => {
    vi.spyOn(EnvModule, 'isDemoMode').mockReturnValue(false);
    vi.spyOn(YouTubeModule, 'launchYouTubeVideo').mockResolvedValue({
      success: true,
      openedVia: 'app',
    });

    const result = await executeYouTubeLaunch({
      resourceId: 'res-vid-2',
      youtubeVideoId: 'abcdefghijk',
      version: '1.1.0',
      patientId: 'patient-2',
      repository: mockRepo,
    });

    expect(result.success).toBe(true);
    expect(result.openedVia).toBe('app');
    expect(YouTubeModule.launchYouTubeVideo).toHaveBeenCalledWith('abcdefghijk');
    expect(mockRepo.education.recordYouTubeInteraction).toHaveBeenCalledWith({
      contentId: 'res-vid-2',
      youtubeVideoId: 'abcdefghijk',
      versionOrigen: '1.1.0',
    });
  });

  it('notifica mediante onPersistenceError si la persistencia falla sin romper el retorno', async () => {
    vi.spyOn(EnvModule, 'isDemoMode').mockReturnValue(true);
    const persistenceError = new Error('Fallo SQLite');
    vi.mocked(mockRepo.education.recordYouTubeInteraction).mockRejectedValueOnce(persistenceError);

    const errorHandler = vi.fn();

    const result = await executeYouTubeLaunch({
      resourceId: 'res-vid-3',
      youtubeVideoId: 'dQw4w9WgXcQ',
      version: '1.0.0',
      patientId: 'patient-1',
      repository: mockRepo,
      onPersistenceError: errorHandler,
    });

    // La apertura física sigue siendo exitosa
    expect(result.success).toBe(true);
    // Esperar al tick de la promesa en background
    await vi.waitFor(() => {
      expect(errorHandler).toHaveBeenCalledWith(persistenceError);
    });
  });

  it('rechaza pulsaciones dobles dentro del período de debounce para evitar aperturas duplicadas', async () => {
    vi.spyOn(EnvModule, 'isDemoMode').mockReturnValue(true);

    const first = await executeYouTubeLaunch({
      resourceId: 'res-vid-4',
      youtubeVideoId: 'dQw4w9WgXcQ',
      version: '1.0.0',
      patientId: 'patient-1',
      repository: mockRepo,
    });
    expect(first.success).toBe(true);

    // Segundo lanzamiento inmediato
    const second = await executeYouTubeLaunch({
      resourceId: 'res-vid-4',
      youtubeVideoId: 'dQw4w9WgXcQ',
      version: '1.0.0',
      patientId: 'patient-1',
      repository: mockRepo,
    });
    expect(second.success).toBe(false);
    expect(second.error).toContain('Apertura en curso');
  });

  it('no persiste la interacción si el paciente cambió durante la comprobación o apertura de red', async () => {
    vi.spyOn(EnvModule, 'isDemoMode').mockReturnValue(true);

    let activePatientId = 'patient-1';
    vi.mocked(Linking.openURL).mockImplementation(async () => {
      activePatientId = 'patient-2';
      return true as never;
    });

    const result = await executeYouTubeLaunch({
      resourceId: 'res-vid-5',
      youtubeVideoId: 'dQw4w9WgXcQ',
      version: '1.0.0',
      patientId: 'patient-1',
      expectedPatientId: 'patient-1',
      getCurrentPatientId: () => activePatientId,
      repository: mockRepo,
    });

    expect(result.success).toBe(true);
    expect(Linking.openURL).toHaveBeenCalled();
    expect(mockRepo.education.recordYouTubeInteraction).not.toHaveBeenCalled();
  });

  it('no persiste la interacción si la época del contexto expiró durante la apertura', async () => {
    vi.spyOn(EnvModule, 'isDemoMode').mockReturnValue(true);

    let currentEpoch = 1;
    vi.mocked(Linking.openURL).mockImplementation(async () => {
      currentEpoch = 2;
      return true as never;
    });

    const result = await executeYouTubeLaunch({
      resourceId: 'res-vid-6',
      youtubeVideoId: 'dQw4w9WgXcQ',
      version: '1.0.0',
      patientId: 'patient-1',
      expectedEpoch: 1,
      getCurrentEpoch: () => currentEpoch,
      repository: mockRepo,
    });

    expect(result.success).toBe(true);
    expect(Linking.openURL).toHaveBeenCalled();
    expect(mockRepo.education.recordYouTubeInteraction).not.toHaveBeenCalled();
  });
});
