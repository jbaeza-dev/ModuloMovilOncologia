import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as WebBrowser from 'expo-web-browser';
import * as Network from 'expo-network';
import { CUIDAQUIMIO_PODCASTS, launchPodcast } from './podcasts';
vi.mock('expo-web-browser', () => ({
  openBrowserAsync: vi.fn(),
  getCustomTabsSupportingBrowsersAsync: vi.fn(),
}));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-network', () => ({ getNetworkStateAsync: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(Network.getNetworkStateAsync).mockResolvedValue({
    isConnected: true,
    isInternetReachable: true,
  } as Network.NetworkState);
  vi.mocked(WebBrowser.openBrowserAsync).mockResolvedValue({
    type: 'opened',
  } as WebBrowser.WebBrowserResult);
  vi.mocked(WebBrowser.getCustomTabsSupportingBrowsersAsync).mockResolvedValue({
    preferredBrowserPackage: 'com.android.chrome',
    browserPackages: ['com.android.chrome'],
    servicePackages: ['com.android.chrome'],
  });
});
describe('CUIDAQUIMIO podcasts online', () => {
  it('does not launch external audio offline, nor accept an arbitrary file ID', async () => {
    vi.mocked(Network.getNetworkStateAsync).mockResolvedValue({
      isConnected: false,
      isInternetReachable: false,
    } as Network.NetworkState);
    expect(await launchPodcast(CUIDAQUIMIO_PODCASTS[0].id)).toMatchObject({
      opened: false,
      error: expect.stringContaining('requiere conexión'),
    });
    expect(await launchPodcast('unreviewed')).toMatchObject({ opened: false });
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
  });
  it('opens the original Drive link and reports a recoverable external failure', async () => {
    vi.mocked(WebBrowser.getCustomTabsSupportingBrowsersAsync).mockResolvedValueOnce({
      preferredBrowserPackage: 'com.google.android.apps.docs',
      defaultBrowserPackage: 'com.android.chrome',
      browserPackages: ['com.google.android.apps.docs', 'com.android.chrome'],
      servicePackages: ['com.android.chrome'],
    });
    const item = CUIDAQUIMIO_PODCASTS[0];
    expect(await launchPodcast(item.id)).toEqual({ opened: true });
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(
      `https://drive.google.com/file/d/${item.id}/view`,
      { browserPackage: 'com.android.chrome' },
    );
    vi.mocked(WebBrowser.openBrowserAsync).mockRejectedValueOnce(new Error('No handler'));
    expect(await launchPodcast(item.id)).toMatchObject({
      opened: false,
      error: expect.stringContaining('vuelve a intentarlo'),
    });
  });
  it('does not claim an opening when no compatible browser exists or the browser is locked', async () => {
    vi.mocked(WebBrowser.getCustomTabsSupportingBrowsersAsync).mockResolvedValueOnce({
      browserPackages: [],
      servicePackages: [],
    });
    expect(await launchPodcast(CUIDAQUIMIO_PODCASTS[0].id)).toMatchObject({
      opened: false,
      error: expect.stringContaining('navegador compatible'),
    });
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
    vi.mocked(WebBrowser.openBrowserAsync).mockResolvedValueOnce({
      type: 'locked',
    } as WebBrowser.WebBrowserResult);
    expect(await launchPodcast(CUIDAQUIMIO_PODCASTS[0].id)).toMatchObject({
      opened: false,
      error: expect.stringContaining('Cierra la otra ventana'),
    });
  });
});
