import * as WebBrowser from 'expo-web-browser';
import * as Network from 'expo-network';
import { Platform } from 'react-native';

/** Online links observed on the author's site, 28-10-2026; ordered by the CUIDAQUIMIO PPT. */
export const CUIDAQUIMIO_PODCASTS = [
  { id: '1zWaInWBiNJ-_4XjAiEz5DZ1tIQfs0--7', title: 'El Cáncer', category: 'Conociendo el Cáncer' },
  {
    id: '1NH2579goZpnhR1PR5yDrGlzguXOcRFH6',
    title: 'La quimioterapia',
    category: 'Conociendo la Quimioterapia',
  },
  {
    id: '1-hw_XMI5y_u5Ehl76JxgnYyYc7djYRhz',
    title: 'Efectos secundarios de la quimioterapia',
    category: 'Efectos Secundarios',
  },
  {
    id: '1sMhlYuXe0dBdusc_IsKazPzbWBF5W1Jx',
    title: 'Signos de Alarma',
    category: 'Signos de Alarma',
  },
] as const;

export async function launchPodcast(id: string): Promise<{ opened: boolean; error?: string }> {
  // Only the four reviewed links can be opened. No audio bytes or listening claims are stored.
  if (!CUIDAQUIMIO_PODCASTS.some((item) => item.id === id))
    return { opened: false, error: 'Este podcast no pertenece al catálogo de CUIDAQUIMIO.' };
  try {
    const network = await Network.getNetworkStateAsync();
    if (!network.isConnected || network.isInternetReachable === false)
      return {
        opened: false,
        error: 'Este podcast requiere conexión a internet. Conéctate e intenta nuevamente.',
      };
    // Restrict Android's intent to a real Custom Tabs browser so Drive cannot intercept it.
    let browserPackage: string | undefined;
    if (Platform.OS === 'android') {
      const available = await WebBrowser.getCustomTabsSupportingBrowsersAsync();
      const supported = available.browserPackages.filter((name) =>
        available.servicePackages.includes(name),
      );
      browserPackage = [
        available.preferredBrowserPackage,
        available.defaultBrowserPackage,
        ...supported,
      ].find((name): name is string => Boolean(name && supported.includes(name)));
      if (!browserPackage)
        return {
          opened: false,
          error:
            'Necesitas un navegador compatible para escuchar el podcast. Configúralo e intenta nuevamente.',
        };
    }
    const result = await WebBrowser.openBrowserAsync(`https://drive.google.com/file/d/${id}/view`, {
      browserPackage,
    });
    if (result.type === 'locked')
      return {
        opened: false,
        error: 'Cierra la otra ventana del navegador e intenta abrir el podcast nuevamente.',
      };
    return { opened: true };
  } catch {
    return {
      opened: false,
      error: 'No se pudo abrir el podcast. Revisa tu conexión y vuelve a intentarlo.',
    };
  }
}
