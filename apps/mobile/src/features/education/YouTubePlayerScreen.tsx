import { AppIcon as Feather } from '../../components/AppIcon';
import * as Network from 'expo-network';
import * as ScreenOrientation from 'expo-screen-orientation';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  BackHandler,
  Linking,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Screen } from '../../components/Screen';
import {
  BodyText,
  InfoCard,
  SectionTitle,
  StatusPill,
  VisualButton,
} from '../../components/Visual';
import { MULTIMEDIA_AND_EDUCATION_COPY } from '../../content/patient-copy';
import { parseYouTubeVideoId } from '../../data/local/education/youtube';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { usePodcastPlayback } from './PodcastPlaybackContext';
import { getPublicVerifiedOrigin } from '../../utils/environment';
import { theme } from '../../theme';

export function buildYouTubeEmbedHtml(
  videoId: string,
  origin: string = getPublicVerifiedOrigin(),
): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      background-color: #000000;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #player {
      width: 100%;
      height: 100%;
    }
  </style>
</head>
<body>
  <div id="player"></div>
  <script>
    var tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    var firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

    var player;
    function onYouTubeIframeAPIReady() {
      player = new YT.Player('player', {
        height: '100%',
        width: '100%',
        videoId: '${videoId}',
        playerVars: {
          autoplay: 1,
          playsinline: 1,
          rel: 0,
          modestbranding: 1,
          enablejsapi: 1,
          origin: '${origin}'
        },
        events: {
          'onReady': onPlayerReady,
          'onStateChange': onPlayerStateChange,
          'onError': onPlayerError
        }
      });
    }

    function onPlayerReady(event) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'YT_READY' }));
      }
      checkAspectRatio();
    }

    function checkAspectRatio() {
      try {
        var video = document.querySelector('video');
        if (video && video.videoWidth && video.videoHeight) {
          var isVertical = video.videoHeight > video.videoWidth;
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'YT_ASPECT_RATIO',
              isVertical: isVertical
            }));
          }
        }
      } catch (e) {}
    }
    setInterval(checkAspectRatio, 400);

    function onPlayerStateChange(event) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'YT_STATE',
          state: event.data
        }));
      }
    }

    function onPlayerError(event) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'YT_ERROR',
          code: event.data
        }));
      }
    }
  </script>
</body>
</html>`;
}

export function YouTubePlayerScreen() {
  const { videoId, youtubeVideoId, resourceId, title, description, version } =
    useLocalSearchParams<{
      videoId?: string;
      youtubeVideoId?: string;
      resourceId?: string;
      title?: string;
      description?: string;
      version?: string;
    }>();

  const { theme: appTheme } = useAppTheme();
  const styles = createStyles(appTheme.colors);
  const { repository, patientId } = useLocalData();
  const { fontScale } = useWindowDimensions();
  const podcastPlayback = usePodcastPlayback();

  // Pausar podcast activo si existe al reproducir video
  useEffect(() => {
    if (podcastPlayback?.isPlaying) {
      podcastPlayback.pause();
    }
  }, [podcastPlayback]);

  const rawId = videoId || youtubeVideoId || '';
  const parsedVideoId = parseYouTubeVideoId(rawId);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const isShortInitial = Boolean(
    rawId.includes('/shorts/') ||
    rawId.toLowerCase().includes('short') ||
    (typeof title === 'string' && title.toLowerCase().includes('short')),
  );
  const [isVerticalVideo, setIsVerticalVideo] = useState(isShortInitial);
  const [isOffline, setIsOffline] = useState(false);
  const [checkingNetwork, setCheckingNetwork] = useState(true);

  type YouTubePlaybackStatus =
    | 'opening'
    | 'playing'
    | 'paused'
    | 'buffering'
    | 'embedding_error'
    | 'general_error';

  const [playbackStatus, setPlaybackStatus] = useState<YouTubePlaybackStatus>('opening');
  const [errorCode, setErrorCode] = useState<number | null>(null);

  const handleWebViewMessage = (event: { nativeEvent: { data: string } }) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'YT_ASPECT_RATIO') {
        if (typeof data.isVertical === 'boolean') {
          setIsVerticalVideo(data.isVertical);
        }
      } else if (data.type === 'YT_READY') {
        setPlaybackStatus((prev) => (prev === 'opening' ? 'buffering' : prev));
      } else if (data.type === 'YT_STATE') {
        if (data.state === 1) {
          setPlaybackStatus('playing');
          const targetId = resourceId || parsedVideoId;
          if (repository && targetId) {
            void repository.education.markCopyViewed(targetId).catch(() => {});
          }
        } else if (data.state === 2) {
          setPlaybackStatus('paused');
        } else if (data.state === 3) {
          setPlaybackStatus('buffering');
        }
      } else if (data.type === 'YT_ERROR') {
        setErrorCode(data.code);
        if (data.code === 101 || data.code === 150) {
          setPlaybackStatus('embedding_error');
        } else {
          setPlaybackStatus('general_error');
        }
      }
    } catch {
      // Ignorar mensajes no conformes
    }
  };

  // Comprobación de conectividad a internet en montaje
  useEffect(() => {
    let active = true;
    async function checkConnectivity() {
      try {
        const netInfo = await Network.getNetworkStateAsync();
        const offline = netInfo.isConnected === false || netInfo.isInternetReachable === false;
        if (active) {
          setIsOffline(offline);
        }
      } catch {
        // En emulador o entorno sin soporte se asume en línea
        if (active) setIsOffline(false);
      } finally {
        if (active) setCheckingNetwork(false);
      }
    }
    void checkConnectivity();
    return () => {
      active = false;
    };
  }, []);

  // Detectar automáticamente si el video es vertical (Shorts / 9:16) mediante URL canónica
  useEffect(() => {
    if (!parsedVideoId) return;
    let active = true;
    fetch(`https://www.youtube.com/watch?v=${parsedVideoId}`)
      .then((res) => (res.ok ? res.text() : ''))
      .then((html) => {
        if (!active || !html) return;
        const isShort =
          html.includes(`https://www.youtube.com/shorts/${parsedVideoId}`) ||
          html.includes('/shorts/') ||
          html.includes('"isShorts":true');
        const isStandardWatch = html.includes(
          `<link rel="canonical" href="https://www.youtube.com/watch?v=${parsedVideoId}"`,
        );
        if (isShort) {
          setIsVerticalVideo(true);
        } else if (isStandardWatch) {
          setIsVerticalVideo(false);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [parsedVideoId]);

  // Manejo de orientación de pantalla al entrar o salir de pantalla completa
  useEffect(() => {
    if (isFullscreen) {
      if (isVerticalVideo) {
        void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(
          () => {},
        );
      } else {
        void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(
          () => {},
        );
      }
    } else {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(
        () => {},
      );
    }
    return () => {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(
        () => {},
      );
    };
  }, [isFullscreen, isVerticalVideo]);

  // Manejo de botón Atrás en Android para salir de pantalla completa
  useEffect(() => {
    if (!isFullscreen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setIsFullscreen(false);
      return true;
    });
    return () => subscription.remove();
  }, [isFullscreen]);

  // Registro de interacción en SQLite (idempotente)
  useEffect(() => {
    if (patientId && repository && parsedVideoId && !isOffline && !checkingNetwork) {
      void repository.education
        .recordYouTubeInteraction({
          contentId: resourceId ?? parsedVideoId,
          youtubeVideoId: parsedVideoId,
          versionOrigen: version ?? '1.0',
        })
        .catch(() => {
          // No interrumpir la reproducción si falla el guardado analítico
        });
    }
  }, [patientId, repository, parsedVideoId, isOffline, checkingNetwork, resourceId, version]);

  const toggleFullscreen = () => {
    const next = !isFullscreen;
    setIsFullscreen(next);
    AccessibilityInfo.announceForAccessibility(
      next
        ? 'Modo de pantalla completa activado.'
        : 'Pantalla completa desactivada, volviendo a vista vertical.',
    );
  };

  const verifiedOrigin = getPublicVerifiedOrigin();
  const videoTitle = title || MULTIMEDIA_AND_EDUCATION_COPY.youtubeTitle;
  const embedHtml = parsedVideoId ? buildYouTubeEmbedHtml(parsedVideoId, verifiedOrigin) : null;

  // Estado: Sin conexión a internet
  if (isOffline) {
    return (
      <Screen isRoot={false} title="Video educativo">
        <View style={styles.offlineNav}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Volver a Educación"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
          >
            <Feather name="arrow-left" size={20} color={appTheme.colors.text} />
            <Text style={styles.backBtnText}>Volver a Educación</Text>
          </Pressable>
          <StatusPill>Video educativo</StatusPill>
        </View>

        <InfoCard>
          <View style={styles.bannerRow}>
            <Feather name="wifi-off" size={24} color={appTheme.colors.warning} />
            <View style={styles.bannerCopy}>
              <Text style={styles.bannerTitle}>Este video requiere conexión a internet</Text>
              <BodyText style={styles.bannerDescription}>
                {MULTIMEDIA_AND_EDUCATION_COPY.youtubeOffline}
              </BodyText>
            </View>
          </View>
        </InfoCard>

        <InfoCard>
          <SectionTitle>Guías de cuidado sin conexión</SectionTitle>
          <BodyText>
            Tienes guías de cuidado que puedes revisar sin conexión a internet ni gastar tus datos
            móviles.
          </BodyText>
          <View style={{ marginTop: theme.spacing.sm }}>
            <VisualButton
              label="Ir a Podcasts CUIDAQUIMIO"
              onPress={() => router.push('/educacion/podcasts')}
            />
          </View>
        </InfoCard>
      </Screen>
    );
  }

  // Estado: Modo Normal y Pantalla Completa con instancia única de WebView
  return (
    <SafeAreaView
      edges={isFullscreen ? [] : ['top', 'bottom', 'left', 'right']}
      style={isFullscreen ? styles.fullscreenSafe : styles.safeArea}
    >
      <View style={isFullscreen ? styles.fullscreenRoot : styles.container}>
        {/* Barra superior con navegación y pantalla completa */}
        {!isFullscreen ? (
          <View style={styles.topNav}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Volver a Educación"
              onPress={() => router.back()}
              style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
            >
              <Feather name="arrow-left" size={20} color={appTheme.colors.text} />
              <Text style={styles.backBtnText}>Volver a Educación</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={MULTIMEDIA_AND_EDUCATION_COPY.youtubeFullscreen}
              onPress={toggleFullscreen}
              style={({ pressed }) => [styles.fullscreenToggleBtn, pressed && styles.pressed]}
            >
              <Feather name="maximize-2" size={16} color={appTheme.colors.primary} />
              {fontScale < 1.3 ? (
                <Text style={styles.fullscreenToggleText}>
                  {MULTIMEDIA_AND_EDUCATION_COPY.youtubeFullscreen}
                </Text>
              ) : null}
            </Pressable>
          </View>
        ) : null}

        {/* Reproductor de Video con instancia única de WebView que se expande a pantalla completa */}
        <View
          style={
            isFullscreen
              ? styles.fullscreenOverlay
              : isVerticalVideo
                ? styles.verticalVideoContainer
                : styles.videoContainer
          }
        >
          {isFullscreen ? <StatusBar hidden /> : null}
          {isFullscreen ? (
            <View style={styles.fullscreenHeader}>
              <Text style={styles.fullscreenTitle} numberOfLines={1}>
                {videoTitle}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={isVerticalVideo ? 'Girar a horizontal' : 'Mantener vertical'}
                  onPress={() => {
                    const nextVertical = !isVerticalVideo;
                    setIsVerticalVideo(nextVertical);
                    void ScreenOrientation.lockAsync(
                      nextVertical
                        ? ScreenOrientation.OrientationLock.PORTRAIT_UP
                        : ScreenOrientation.OrientationLock.LANDSCAPE,
                    ).catch(() => {});
                  }}
                  style={({ pressed }) => [
                    styles.exitFullscreenBtn,
                    { marginRight: 8 },
                    pressed && styles.pressed,
                  ]}
                >
                  <Feather name="rotate-cw" size={18} color="#FFFFFF" />
                  <Text style={styles.exitFullscreenText}>
                    {isVerticalVideo ? 'Horizontal' : 'Vertical'}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={MULTIMEDIA_AND_EDUCATION_COPY.youtubeExitFullscreen}
                  onPress={toggleFullscreen}
                  style={({ pressed }) => [styles.exitFullscreenBtn, pressed && styles.pressed]}
                >
                  <Feather name="minimize-2" size={18} color="#FFFFFF" />
                  <Text style={styles.exitFullscreenText}>
                    {MULTIMEDIA_AND_EDUCATION_COPY.youtubeExitFullscreen}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          <View style={isFullscreen ? styles.fullscreenVideoWrap : { flex: 1 }}>
            {checkingNetwork ? (
              <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color={appTheme.colors.primary} />
                <BodyText style={{ marginTop: 8 }}>Cargando reproductor…</BodyText>
              </View>
            ) : embedHtml ? (
              <>
                <WebView
                  originWhitelist={['*']}
                  source={{
                    html: embedHtml,
                    baseUrl: verifiedOrigin,
                    headers: {
                      Referer: verifiedOrigin,
                    },
                  }}
                  style={styles.webView}
                  javaScriptEnabled
                  domStorageEnabled
                  allowsFullscreenVideo
                  allowsInlineMediaPlayback
                  mediaPlaybackRequiresUserAction={false}
                  onMessage={handleWebViewMessage}
                />
                {playbackStatus === 'embedding_error' ? (
                  <View style={styles.errorOverlay}>
                    <Feather name="alert-triangle" size={36} color={appTheme.colors.warning} />
                    <Text style={styles.errorOverlayTitle}>Video con restricción de inserción</Text>
                    <BodyText style={{ textAlign: 'center', marginTop: 4 }}>
                      Este video no puede reproducirse aquí. Puedes abrirlo en YouTube.
                    </BodyText>
                    <View style={{ marginTop: 12 }}>
                      <VisualButton
                        label="Abrir en YouTube"
                        onPress={() => {
                          if (parsedVideoId) {
                            void Linking.openURL(
                              `https://www.youtube.com/watch?v=${parsedVideoId}`,
                            );
                          }
                        }}
                      />
                    </View>
                  </View>
                ) : playbackStatus === 'general_error' ? (
                  <View style={styles.errorOverlay}>
                    <Feather name="alert-circle" size={36} color={appTheme.colors.error} />
                    <Text style={styles.errorOverlayTitle}>
                      No se pudo cargar el video educativo
                    </Text>
                    <BodyText style={{ textAlign: 'center', marginTop: 4 }}>
                      Ocurrió un error al cargar el video en el reproductor (código{' '}
                      {errorCode ?? 'desconocido'}). Como alternativa de contingencia, puedes
                      intentar abrirlo en YouTube.
                    </BodyText>
                    <View style={{ marginTop: 12 }}>
                      <VisualButton
                        label="Abrir en YouTube"
                        onPress={() => {
                          if (parsedVideoId) {
                            void Linking.openURL(
                              `https://www.youtube.com/watch?v=${parsedVideoId}`,
                            );
                          }
                        }}
                      />
                    </View>
                  </View>
                ) : null}
              </>
            ) : (
              <View style={styles.centerContainer}>
                <Feather name="alert-circle" size={32} color={appTheme.colors.warning} />
                <BodyText style={{ marginTop: 8 }}>Identificador de video no válido</BodyText>
              </View>
            )}
          </View>
        </View>

        {/* Ficha pedagógica y coordinación de audio */}
        {!isFullscreen ? (
          <ScrollView style={styles.infoScroll} contentContainerStyle={styles.infoScrollContent}>
            <InfoCard>
              <View style={styles.statusHeaderRow}>
                <StatusPill>Guía audiovisual recomendada</StatusPill>
                <StatusPill>
                  {playbackStatus === 'playing'
                    ? 'Reproduciendo'
                    : playbackStatus === 'paused'
                      ? 'En pausa'
                      : playbackStatus === 'embedding_error'
                        ? 'Inserción restringida'
                        : playbackStatus === 'general_error'
                          ? 'Error de video'
                          : 'Conectando…'}
                </StatusPill>
              </View>
              <Text style={styles.contentTitle}>{videoTitle}</Text>
              <Text style={styles.contentAuthor}>Contenido educativo</Text>

              <BodyText style={styles.contentDescription}>
                {description ||
                  'En este video explicativo se detallan los pasos y recomendaciones para tu tratamiento de quimioterapia y cuidados de apoyo en el hogar.'}
              </BodyText>

              <View style={styles.audioNotice}>
                <Feather name="check-circle" size={20} color={appTheme.colors.primary} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.audioNoticeTitle}>Audio coordinado</Text>
                  <Text style={styles.audioNoticeText}>
                    {MULTIMEDIA_AND_EDUCATION_COPY.audioCoordinatedWithVideo}
                  </Text>
                </View>
              </View>

              {/* Vía de contingencia documentada */}
              <View style={styles.contingencyContainer}>
                <Feather name="external-link" size={18} color={appTheme.colors.secondary} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.contingencyTitle}>Alternativa de contingencia</Text>
                  <Text style={styles.contingencyDescription}>
                    También puedes verlo en YouTube.
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Abrir en YouTube"
                    onPress={() => {
                      if (parsedVideoId) {
                        void Linking.openURL(`https://www.youtube.com/watch?v=${parsedVideoId}`);
                      }
                    }}
                    style={({ pressed }) => [styles.contingencyBtn, pressed && styles.pressed]}
                  >
                    <Feather name="arrow-up-right" size={14} color={appTheme.colors.primary} />
                    <Text style={styles.contingencyBtnText}>Abrir en YouTube</Text>
                  </Pressable>
                </View>
              </View>
            </InfoCard>
          </ScrollView>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    container: {
      flex: 1,
    },
    topNav: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
      marginBottom: theme.spacing.xs,
    },
    backBtn: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 6,
      borderRadius: theme.radius.sm,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    backBtnText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
    },
    fullscreenToggleBtn: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.xs,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 6,
      borderRadius: theme.radius.sm,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    fullscreenToggleText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.primary,
    },
    pressed: {
      opacity: 0.7,
    },
    videoContainer: {
      width: '100%',
      aspectRatio: 16 / 9,
      backgroundColor: '#000000',
      borderRadius: theme.radius.sm,
      overflow: 'hidden',
    },
    verticalVideoContainer: {
      width: '100%',
      aspectRatio: 9 / 16,
      maxHeight: 460,
      alignSelf: 'center',
      backgroundColor: '#000000',
      borderRadius: theme.radius.sm,
      overflow: 'hidden',
    },
    webView: {
      flex: 1,
      backgroundColor: '#000000',
    },
    centerContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing.md,
      backgroundColor: colors.mutedSurface,
    },
    infoScroll: {
      flex: 1,
      marginTop: theme.spacing.sm,
    },
    infoScrollContent: {
      paddingBottom: theme.spacing.xl,
    },
    contentTitle: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.text,
      marginTop: theme.spacing.xs,
      marginBottom: 2,
    },
    contentAuthor: {
      fontSize: 12.5,
      fontWeight: '600',
      color: colors.secondary,
      marginBottom: theme.spacing.sm,
    },
    contentDescription: {
      lineHeight: 21,
    },
    audioNotice: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.md,
      padding: theme.spacing.sm,
      borderRadius: theme.radius.sm,
      backgroundColor: colors.primaryContainer,
      borderWidth: 1,
      borderColor: colors.border,
    },
    audioNoticeTitle: {
      fontSize: 13.5,
      fontWeight: '700',
      color: colors.onPrimaryContainer,
    },
    audioNoticeText: {
      fontSize: 12.5,
      lineHeight: 18,
      color: colors.onPrimaryContainer,
    },
    offlineNav: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: theme.spacing.md,
    },
    bannerRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.md,
    },
    bannerCopy: {
      flex: 1,
      gap: 4,
    },
    bannerTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    bannerDescription: {
      fontSize: 13.5,
      lineHeight: 19,
    },
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    fullscreenSafe: {
      flex: 1,
      backgroundColor: '#000000',
    },
    fullscreenOverlay: {
      flex: 1,
      width: '100%',
      height: '100%',
      backgroundColor: '#000000',
    },
    fullscreenRoot: {
      flex: 1,
      backgroundColor: '#000000',
    },
    fullscreenHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
    },
    fullscreenTitle: {
      flex: 1,
      fontSize: 14,
      fontWeight: '700',
      color: '#FFFFFF',
      marginRight: theme.spacing.md,
    },
    exitFullscreenBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 6,
      borderRadius: theme.radius.sm,
      backgroundColor: 'rgba(255, 255, 255, 0.2)',
      borderWidth: 1,
      borderColor: 'rgba(255, 255, 255, 0.3)',
    },
    exitFullscreenText: {
      fontSize: 12,
      fontWeight: '700',
      color: '#FFFFFF',
    },
    fullscreenVideoWrap: {
      flex: 1,
    },
    statusHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: theme.spacing.xs,
    },
    errorOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing.md,
      zIndex: 10,
    },
    errorOverlayTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
      marginTop: 8,
      textAlign: 'center',
    },
    contingencyContainer: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.md,
      padding: theme.spacing.sm,
      borderRadius: theme.radius.sm,
      backgroundColor: colors.mutedSurface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    contingencyTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
    },
    contingencyDescription: {
      fontSize: 12.5,
      color: colors.secondary,
      lineHeight: 18,
    },
    contingencyBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      marginTop: 6,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: theme.radius.sm,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    contingencyBtnText: {
      fontSize: 12.5,
      fontWeight: '700',
      color: colors.primary,
    },
  });
}
