import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Image,
  type LayoutChangeEvent,
  PanResponder,
  Platform,
  StyleSheet,
  View,
} from 'react-native';

export interface ZoomableImageViewRef {
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  toggleZoom: () => void;
  getScale: () => number;
}

export interface ZoomableImageViewProps {
  sourceUri: string;
  accessibilityLabel: string;
  onLoad?: () => void;
  onError?: () => void;
  onScaleChange?: (scale: number) => void;
  onZoomAnnouncement?: (message: string) => void;
}

const MIN_SCALE = 1.0;
const MAX_SCALE = 4.0;
const DOUBLE_TAP_SCALE = 2.5;

export const ZoomableImageView = forwardRef<ZoomableImageViewRef, ZoomableImageViewProps>(
  function ZoomableImageView(
    { sourceUri, accessibilityLabel, onLoad, onError, onScaleChange, onZoomAnnouncement },
    ref,
  ) {
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
    const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);

    const scale = useRef(new Animated.Value(1)).current;
    const translateX = useRef(new Animated.Value(0)).current;
    const translateY = useRef(new Animated.Value(0)).current;

    const currentScale = useRef(1);
    const currentTranslateX = useRef(0);
    const currentTranslateY = useRef(0);

    const baseScale = useRef(1);
    const baseTranslateX = useRef(0);
    const baseTranslateY = useRef(0);
    const initialDistance = useRef(0);

    const lastTapTime = useRef(0);
    const lastTapX = useRef(0);
    const lastTapY = useRef(0);

    const announce = (message: string) => {
      onZoomAnnouncement?.(message);
      if (Platform.OS === 'android' || Platform.OS === 'ios') {
        AccessibilityInfo.announceForAccessibility(message);
      }
    };

    // Dimensiones ajustadas dentro del contenedor conservando la relación de aspecto
    const fittedDimensions = (() => {
      const W = containerSize.width || 360;
      const H = containerSize.height || 640;
      if (!imageSize || imageSize.width <= 0 || imageSize.height <= 0) {
        return { width: W, height: H };
      }
      const imageRatio = imageSize.width / imageSize.height;
      const containerRatio = W / H;
      if (containerRatio > imageRatio) {
        const height = H;
        const width = H * imageRatio;
        return { width, height };
      } else {
        const width = W;
        const height = width / imageRatio;
        return { width, height };
      }
    })();

    const clampTranslation = (x: number, y: number, targetScale: number) => {
      const W = containerSize.width || 360;
      const H = containerSize.height || 640;
      const fittedW = fittedDimensions.width;
      const fittedH = fittedDimensions.height;

      const scaledW = fittedW * targetScale;
      const scaledH = fittedH * targetScale;

      const maxX = Math.max(0, (scaledW - W) / 2);
      const maxY = Math.max(0, (scaledH - H) / 2);

      const clampedX = Math.min(maxX, Math.max(-maxX, x));
      const clampedY = Math.min(maxY, Math.max(-maxY, y));

      return { clampedX, clampedY };
    };

    const animateTo = (targetScale: number, targetX: number, targetY: number, duration = 200) => {
      const { clampedX, clampedY } = clampTranslation(targetX, targetY, targetScale);
      currentScale.current = targetScale;
      currentTranslateX.current = clampedX;
      currentTranslateY.current = clampedY;
      onScaleChange?.(targetScale);

      Animated.parallel([
        Animated.timing(scale, {
          toValue: targetScale,
          duration,
          useNativeDriver: false,
        }),
        Animated.timing(translateX, {
          toValue: clampedX,
          duration,
          useNativeDriver: false,
        }),
        Animated.timing(translateY, {
          toValue: clampedY,
          duration,
          useNativeDriver: false,
        }),
      ]).start();
    };

    const zoomIn = () => {
      let nextScale: number;
      if (currentScale.current < 1.4) nextScale = 1.75;
      else if (currentScale.current < 2.2) nextScale = 2.5;
      else if (currentScale.current < 3.2) nextScale = 3.5;
      else nextScale = MAX_SCALE;

      animateTo(nextScale, currentTranslateX.current, currentTranslateY.current);
      announce(`Nivel de zoom al ${Math.round(nextScale * 100)}%`);
    };

    const zoomOut = () => {
      let prevScale: number;
      if (currentScale.current > 3.2) prevScale = 2.5;
      else if (currentScale.current > 2.2) prevScale = 1.75;
      else prevScale = MIN_SCALE;

      animateTo(prevScale, currentTranslateX.current, currentTranslateY.current);
      announce(`Nivel de zoom al ${Math.round(prevScale * 100)}%`);
    };

    const resetZoom = () => {
      animateTo(MIN_SCALE, 0, 0);
      announce('Imagen ajustada a la pantalla (100%)');
    };

    const toggleZoom = () => {
      if (currentScale.current > 1.2) {
        resetZoom();
      } else {
        animateTo(DOUBLE_TAP_SCALE, 0, 0);
        announce(`Imagen ampliada al ${Math.round(DOUBLE_TAP_SCALE * 100)}%`);
      }
    };

    useImperativeHandle(ref, () => ({
      zoomIn,
      zoomOut,
      resetZoom,
      toggleZoom,
      getScale: () => currentScale.current,
    }));

    const panResponder = useRef(
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gestureState) => {
          return (
            gestureState.numberActiveTouches === 2 ||
            (currentScale.current > 1.05 &&
              (Math.abs(gestureState.dx) > 3 || Math.abs(gestureState.dy) > 3))
          );
        },
        onPanResponderGrant: (evt) => {
          const touches = evt.nativeEvent.touches;
          if (touches.length === 2) {
            initialDistance.current = Math.hypot(
              touches[0].pageX - touches[1].pageX,
              touches[0].pageY - touches[1].pageY,
            );
            baseScale.current = currentScale.current;
          }
          baseTranslateX.current = currentTranslateX.current;
          baseTranslateY.current = currentTranslateY.current;
        },
        onPanResponderMove: (evt, gestureState) => {
          const touches = evt.nativeEvent.touches;
          if (touches.length === 2) {
            // Pellizco táctil (pinch to zoom)
            const currentDist = Math.hypot(
              touches[0].pageX - touches[1].pageX,
              touches[0].pageY - touches[1].pageY,
            );
            if (initialDistance.current > 0) {
              const factor = currentDist / initialDistance.current;
              const targetScale = Math.min(Math.max(baseScale.current * factor, 0.75), 4.5);
              scale.setValue(targetScale);
              currentScale.current = targetScale;
              onScaleChange?.(targetScale);
            }
          } else if (touches.length === 1 && currentScale.current > 1.0) {
            // Arrastre 2D libre cuando la imagen está ampliada
            const newX = baseTranslateX.current + gestureState.dx;
            const newY = baseTranslateY.current + gestureState.dy;
            translateX.setValue(newX);
            translateY.setValue(newY);
            currentTranslateX.current = newX;
            currentTranslateY.current = newY;
          }
        },
        onPanResponderRelease: (evt) => {
          const now = Date.now();
          const touches = evt.nativeEvent.changedTouches;
          const tapX = touches[0]?.pageX ?? 0;
          const tapY = touches[0]?.pageY ?? 0;

          // Detección de doble toque (< 300 ms y posición similar)
          if (
            now - lastTapTime.current < 300 &&
            Math.hypot(tapX - lastTapX.current, tapY - lastTapY.current) < 35
          ) {
            lastTapTime.current = 0;
            toggleZoom();
            return;
          }
          lastTapTime.current = now;
          lastTapX.current = tapX;
          lastTapY.current = tapY;

          // Reajustar límites de escala mínima y máxima
          let finalScale = currentScale.current;
          if (finalScale < MIN_SCALE) finalScale = MIN_SCALE;
          if (finalScale > MAX_SCALE) finalScale = MAX_SCALE;

          animateTo(finalScale, currentTranslateX.current, currentTranslateY.current, 150);
          if (Math.abs(finalScale - baseScale.current) > 0.1) {
            announce(`Nivel de zoom al ${Math.round(finalScale * 100)}%`);
          }
        },
      }),
    ).current;

    return (
      <View
        style={styles.container}
        onLayout={(e: LayoutChangeEvent) => {
          const { width, height } = e.nativeEvent.layout;
          if (width > 0 && height > 0) {
            setContainerSize({ width, height });
          }
        }}
        accessible={true}
        accessibilityRole="image"
        accessibilityLabel={accessibilityLabel}
        accessibilityActions={[
          { name: 'activate', label: 'Alternar ampliación' },
          { name: 'increment', label: 'Aumentar zoom' },
          { name: 'decrement', label: 'Reducir zoom' },
        ]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'activate') {
            toggleZoom();
          } else if (event.nativeEvent.actionName === 'increment') {
            zoomIn();
          } else if (event.nativeEvent.actionName === 'decrement') {
            zoomOut();
          }
        }}
        {...panResponder.panHandlers}
      >
        <Animated.View
          style={[
            styles.animatedWrapper,
            {
              width: fittedDimensions.width,
              height: fittedDimensions.height,
              transform: [{ translateX }, { translateY }, { scale }],
            },
          ]}
        >
          <Image
            source={{ uri: sourceUri }}
            style={{
              width: fittedDimensions.width,
              height: fittedDimensions.height,
            }}
            resizeMode="contain"
            onLoad={(e) => {
              const src = e.nativeEvent?.source;
              if (src?.width && src?.height) {
                setImageSize({ width: src.width, height: src.height });
              }
              onLoad?.();
            }}
            onError={onError}
          />
        </Animated.View>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  animatedWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
  },
});
