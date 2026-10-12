import * as Linking from 'expo-linking';

export interface LinkingAdapter {
  canOpenURL: (url: string) => Promise<boolean>;
  openURL: (url: string) => Promise<unknown>;
}

const defaultLinkingAdapter: LinkingAdapter = {
  canOpenURL: (url: string) => Linking.canOpenURL(url),
  openURL: async (url: string) => {
    await Linking.openURL(url);
  },
};

const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

/**
 * Extrae y valida estrictamente el identificador de 11 caracteres de YouTube
 * a partir de un ID directo o de una URL completa (web, corta o embebida).
 */
export function parseYouTubeVideoId(input: string): string | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (YOUTUBE_ID_REGEX.test(trimmed)) {
    return trimmed;
  }

  try {
    // Si no contiene protocolo, intentar parsear con https://
    const urlString =
      trimmed.startsWith('http://') || trimmed.startsWith('https://')
        ? trimmed
        : `https://${trimmed}`;
    const parsed = new URL(urlString);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');

    if (host === 'youtu.be') {
      const candidate = parsed.pathname.slice(1).split('/')[0];
      return YOUTUBE_ID_REGEX.test(candidate) ? candidate : null;
    }

    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (parsed.pathname === '/watch') {
        const v = parsed.searchParams.get('v');
        return v && YOUTUBE_ID_REGEX.test(v) ? v : null;
      }
      if (parsed.pathname.startsWith('/embed/') || parsed.pathname.startsWith('/shorts/')) {
        const parts = parsed.pathname.split('/').filter(Boolean);
        const candidate = parts[1];
        return candidate && YOUTUBE_ID_REGEX.test(candidate) ? candidate : null;
      }
    }
  } catch {
    // Ignorar fallo de parseo de URL
  }

  return null;
}

/**
 * Construye las URLs para apertura nativa (app de YouTube) y fallback web.
 */
export function buildYouTubeUrls(videoIdOrUrl: string): {
  videoId: string;
  appUrl: string;
  webUrl: string;
} {
  const videoId = parseYouTubeVideoId(videoIdOrUrl);
  if (!videoId) {
    throw new Error(
      `Identificador de video de YouTube inválido: "${videoIdOrUrl}". Se requiere un identificador de 11 caracteres.`,
    );
  }

  return {
    videoId,
    appUrl: `vnd.youtube:${videoId}`,
    webUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

export interface LaunchYouTubeResult {
  success: boolean;
  openedVia: 'app' | 'web';
  error?: string;
}

/**
 * Lanza el video externamente intentando primero la aplicación nativa de YouTube (vnd.youtube:...)
 * y degradando con gracia al navegador web si la app no está disponible.
 */
export async function launchYouTubeVideo(
  videoIdOrUrl: string,
  linking: LinkingAdapter = defaultLinkingAdapter,
): Promise<LaunchYouTubeResult> {
  const { appUrl, webUrl } = buildYouTubeUrls(videoIdOrUrl);

  try {
    const canOpenNative = await linking.canOpenURL(appUrl).catch(() => false);
    if (canOpenNative) {
      try {
        await linking.openURL(appUrl);
        return { success: true, openedVia: 'app' };
      } catch {
        // Fallback a web si el intento nativo falló en el sistema operativo
      }
    }

    await linking.openURL(webUrl);
    return { success: true, openedVia: 'web' };
  } catch (err) {
    return {
      success: false,
      openedVia: 'web',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
