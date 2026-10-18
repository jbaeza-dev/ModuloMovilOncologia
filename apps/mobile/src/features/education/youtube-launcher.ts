import * as Linking from 'expo-linking';
import * as Network from 'expo-network';

import { launchYouTubeVideo, type LaunchYouTubeResult } from '../../data/local/education/youtube';
import type { AppRepository } from '../../data/local/repository';
import { isDemoMode } from '../../utils/environment';

export interface ExecuteYouTubeLaunchOptions {
  resourceId: string;
  youtubeVideoId?: string | null;
  version: string;
  patientId: string | null;
  repository: AppRepository | null;
  runSave?: <T>(fn: () => Promise<T>) => Promise<T>;
  onPersistenceError?: (err: unknown) => void;
}

export interface ExecuteYouTubeLaunchResult {
  success: boolean;
  openedVia?: 'app' | 'web';
  error?: string;
  isOffline?: boolean;
}

let lastLaunchTimestamp = 0;
const LAUNCH_DEBOUNCE_MS = 1000;

export function resetYouTubeLaunchDebounceForTesting(): void {
  lastLaunchTimestamp = 0;
}

/**
 * Lanza un video educativo de YouTube previa comprobación de conectividad a internet,
 * protegiendo contra pulsaciones dobles y desacoplando la persistencia de la apertura física.
 */
export async function executeYouTubeLaunch(
  options: ExecuteYouTubeLaunchOptions,
): Promise<ExecuteYouTubeLaunchResult> {
  const now = Date.now();
  if (now - lastLaunchTimestamp < LAUNCH_DEBOUNCE_MS) {
    return { success: false, error: 'Apertura en curso…' };
  }
  lastLaunchTimestamp = now;

  // 1. Diagnóstico previo de red
  try {
    const netInfo = await Network.getNetworkStateAsync();
    const isOffline = netInfo.isConnected === false || netInfo.isInternetReachable === false;
    if (isOffline) {
      return {
        success: false,
        isOffline: true,
        error:
          'Este video requiere conexión a internet para reproducirse. Por favor, revisa tu conexión de datos o Wi-Fi.',
      };
    }
  } catch {
    // Si la API nativa de red falla en emulador o stub, se procede con la apertura
  }

  // 2. Apertura (modo demostrativo acordado o video definitivo)
  let result: LaunchYouTubeResult;

  if (isDemoMode() || !options.youtubeVideoId) {
    try {
      await Linking.openURL('https://www.youtube.com');
      result = { success: true, openedVia: 'web' };
    } catch {
      return {
        success: false,
        error: 'No se pudo abrir YouTube en este dispositivo.',
      };
    }
  } else {
    result = await launchYouTubeVideo(options.youtubeVideoId);
  }

  // 3. Persistencia rastreada si la apertura fue exitosa
  if (result.success && options.patientId && options.repository) {
    const targetRepository = options.repository;

    const persistTask = async () => {
      await targetRepository.education.recordYouTubeInteraction({
        contentId: options.resourceId,
        youtubeVideoId: options.youtubeVideoId ?? 'demo',
        versionOrigen: options.version,
      });
    };

    const taskPromise = options.runSave ? options.runSave(persistTask) : persistTask();
    taskPromise.catch((err) => {
      if (typeof options.onPersistenceError === 'function') {
        options.onPersistenceError(err);
      }
    });
  }

  return result;
}
