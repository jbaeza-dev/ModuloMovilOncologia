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

import {
  clampTranslation,
  computeFittedDimensions,
  computePinchTransform,
  DOUBLE_TAP_MAX_GAP_MS,
  DOUBLE_TAP_SCALE,
  DOUBLE_TAP_SLOP_PX,
  MAX_SCALE,
  MIN_SCALE,
  TAP_MAX_DURATION_MS,
  TAP_SLOP_PX,
} from './zoomable-image-geometry';

export {
  clampTranslation,
  computeFittedDimensions,
  computePinchTransform,
  DOUBLE_TAP_MAX_GAP_MS,
  DOUBLE_TAP_SCALE,
  DOUBLE_TAP_SLOP_PX,
  MAX_SCALE,
  MIN_SCALE,
  TAP_MAX_DURATION_MS,
  TAP_SLOP_PX,
};

export const ZoomableImageView = forwardRef<ZoomableImageViewRef, ZoomableImageViewProps>(
  function ZoomableImageView(
    { sourceUri, accessibilityLabel, onLoad, onError, onScaleChange, onZoomAnnouncement },
    ref,
  ) {
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
    const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);

    // Referencias mutables para evitar cierres obsoletos en PanResponder
    const containerSizeRef = useRef({ width: 0, height: 0 });
    const containerOffsetRef = useRef({ x: 0, y: 0 });
    const imageSizeRef = useRef<{ width: number; height: number } | null>(null);
    const containerViewRef = useRef<View | null>(null);

    const scale = useRef(new Animated.Value(1)).current;
    const translateX = useRef(new Animated.Value(0)).current;
    const translateY = useRef(new Animated.Value(0)).current;

    const currentScale = useRef(1);
    const currentTranslateX = useRef(0);
    const currentTranslateY = useRef(0);

    // Estado del gesto de pinza (2 dedos)
    const isPinchingRef = useRef(false);
    const initialDistanceRef = useRef(0);
    const baseScaleRef = useRef(1);
    const baseTranslateXRef = useRef(0);
    const baseTranslateYRef = useRef(0);
    const focalPoint0Ref = useRef({ x: 0, y: 0 });

    // Estado del gesto de arrastre (1 dedo)
    const basePanXRef = useRef(0);
    const basePanYRef = useRef(0);
    const panStartPosRef = useRef({ x: 0, y: 0 });

    // Detección de toque / descarte de arrastres rápidos
    const touchStartTimeRef = useRef(0);
    const touchStartPosRef = useRef({ x: 0, y: 0 });
    const touchCountMaxRef = useRef(0);
    const hasMovedBeyondSlopRef = useRef(false);

    // Registro de toque anterior para doble toque
    const lastTapTimeRef = useRef(0);
    const lastTapXRef = useRef(0);
    const lastTapYRef = useRef(0);

    const announce = (message: string) => {
      onZoomAnnouncement?.(message);
      if (Platform.OS === 'android' || Platform.OS === 'ios') {
        AccessibilityInfo.announceForAccessibility(message);
      }
    };

    const getActiveDimensions = () => {
      const cW = containerSizeRef.current.width || 360;
      const cH = containerSizeRef.current.height || 640;
      const fitted = computeFittedDimensions(cW, cH, imageSizeRef.current);
      const center = {
        x: containerOffsetRef.current.x + cW / 2,
        y: containerOffsetRef.current.y + cH / 2,
      };
      return { cW, cH, fitted, center };
    };

    const reclampCurrentTranslation = (
      cW: number,
      cH: number,
      img: { width: number; height: number } | null,
    ) => {
      if (currentScale.current <= 1.0) {
        currentTranslateX.current = 0;
        currentTranslateY.current = 0;
        translateX.setValue(0);
        translateY.setValue(0);
        return;
      }
      const fitted = computeFittedDimensions(cW, cH, img);
      const { clampedX, clampedY } = clampTranslation(
        currentTranslateX.current,
        currentTranslateY.current,
        currentScale.current,
        cW,
        cH,
        fitted.width,
        fitted.height,
      );
      if (clampedX !== currentTranslateX.current || clampedY !== currentTranslateY.current) {
        currentTranslateX.current = clampedX;
        currentTranslateY.current = clampedY;
        translateX.setValue(clampedX);
        translateY.setValue(clampedY);
      }
    };

    const animateTo = (
      targetScale: number,
      targetX: number,
      targetY: number,
      duration = process.env.NODE_ENV === 'test' ? 0 : 200,
    ) => {
      const { cW, cH, fitted } = getActiveDimensions();
      const { clampedX, clampedY } = clampTranslation(
        targetX,
        targetY,
        targetScale,
        cW,
        cH,
        fitted.width,
        fitted.height,
      );

      currentScale.current = targetScale;
      currentTranslateX.current = clampedX;
      currentTranslateY.current = clampedY;
      onScaleChange?.(targetScale);

      if (duration === 0) {
        scale.setValue(targetScale);
        translateX.setValue(clampedX);
        translateY.setValue(clampedY);
        return;
      }

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

    const toggleZoomAt = (tapPageX?: number, tapPageY?: number) => {
      if (currentScale.current > 1.2) {
        resetZoom();
      } else {
        const targetScale = DOUBLE_TAP_SCALE;
        let targetX = 0;
        let targetY = 0;
        if (tapPageX !== undefined && tapPageY !== undefined) {
          const { center } = getActiveDimensions();
          const vx = tapPageX - center.x;
          const vy = tapPageY - center.y;
          targetX = -vx * (targetScale - 1);
          targetY = -vy * (targetScale - 1);
        }
        animateTo(targetScale, targetX, targetY);
        announce(`Imagen ampliada al ${Math.round(targetScale * 100)}%`);
      }
    };

    useImperativeHandle(ref, () => ({
      zoomIn,
      zoomOut,
      resetZoom,
      toggleZoom: () => toggleZoomAt(),
      getScale: () => currentScale.current,
    }));

    const panResponder = useRef(
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gestureState) => {
          return (
            gestureState.numberActiveTouches >= 2 ||
            (currentScale.current > 1.02 &&
              (Math.abs(gestureState.dx) > 3 || Math.abs(gestureState.dy) > 3))
          );
        },
        onPanResponderGrant: (evt) => {
          const touches = evt.nativeEvent.touches;
          touchStartTimeRef.current = Date.now();
          touchCountMaxRef.current = touches.length;
          hasMovedBeyondSlopRef.current = false;

          if (touches.length > 0) {
            touchStartPosRef.current = { x: touches[0].pageX, y: touches[0].pageY };
            panStartPosRef.current = { x: touches[0].pageX, y: touches[0].pageY };
          }

          basePanXRef.current = currentTranslateX.current;
          basePanYRef.current = currentTranslateY.current;

          if (touches.length >= 2) {
            isPinchingRef.current = true;
            initialDistanceRef.current = Math.hypot(
              touches[0].pageX - touches[1].pageX,
              touches[0].pageY - touches[1].pageY,
            );
            baseScaleRef.current = currentScale.current;
            baseTranslateXRef.current = currentTranslateX.current;
            baseTranslateYRef.current = currentTranslateY.current;
            focalPoint0Ref.current = {
              x: (touches[0].pageX + touches[1].pageX) / 2,
              y: (touches[0].pageY + touches[1].pageY) / 2,
            };
          } else {
            isPinchingRef.current = false;
            initialDistanceRef.current = 0;
          }
        },
        onPanResponderMove: (evt) => {
          const touches = evt.nativeEvent.touches;
          touchCountMaxRef.current = Math.max(touchCountMaxRef.current, touches.length);

          const { cW, cH, fitted, center } = getActiveDimensions();

          if (touches.length >= 2) {
            // Transición de 1 a 2 dedos o continuidad de pinza
            if (!isPinchingRef.current) {
              isPinchingRef.current = true;
              initialDistanceRef.current = Math.hypot(
                touches[0].pageX - touches[1].pageX,
                touches[0].pageY - touches[1].pageY,
              );
              baseScaleRef.current = currentScale.current;
              baseTranslateXRef.current = currentTranslateX.current;
              baseTranslateYRef.current = currentTranslateY.current;
              focalPoint0Ref.current = {
                x: (touches[0].pageX + touches[1].pageX) / 2,
                y: (touches[0].pageY + touches[1].pageY) / 2,
              };
              hasMovedBeyondSlopRef.current = true;
              return;
            }

            // Gesto de pinza con punto focal
            if (initialDistanceRef.current > 5) {
              const { newScale, targetX, targetY } = computePinchTransform(
                [touches[0], touches[1]],
                initialDistanceRef.current,
                baseScaleRef.current,
                baseTranslateXRef.current,
                baseTranslateYRef.current,
                focalPoint0Ref.current,
                center,
              );

              const { clampedX, clampedY } = clampTranslation(
                targetX,
                targetY,
                newScale,
                cW,
                cH,
                fitted.width,
                fitted.height,
              );

              scale.setValue(newScale);
              translateX.setValue(clampedX);
              translateY.setValue(clampedY);
              currentScale.current = newScale;
              currentTranslateX.current = clampedX;
              currentTranslateY.current = clampedY;
              onScaleChange?.(newScale);
              hasMovedBeyondSlopRef.current = true;
            }
          } else if (touches.length === 1) {
            if (isPinchingRef.current) {
              // El usuario retiró un dedo: transicionar limpiamente a arrastre de 1 dedo
              isPinchingRef.current = false;
              basePanXRef.current = currentTranslateX.current;
              basePanYRef.current = currentTranslateY.current;
              panStartPosRef.current = { x: touches[0].pageX, y: touches[0].pageY };
              return;
            }

            const dx = touches[0].pageX - panStartPosRef.current.x;
            const dy = touches[0].pageY - panStartPosRef.current.y;

            if (Math.hypot(dx, dy) > TAP_SLOP_PX) {
              hasMovedBeyondSlopRef.current = true;
            }

            if (currentScale.current > 1.0) {
              const rawX = basePanXRef.current + dx;
              const rawY = basePanYRef.current + dy;

              const { clampedX, clampedY } = clampTranslation(
                rawX,
                rawY,
                currentScale.current,
                cW,
                cH,
                fitted.width,
                fitted.height,
              );

              translateX.setValue(clampedX);
              translateY.setValue(clampedY);
              currentTranslateX.current = clampedX;
              currentTranslateY.current = clampedY;
            }
          }
        },
        onPanResponderRelease: (evt) => {
          const changedTouch = evt.nativeEvent.changedTouches?.[0];
          const releasePos = changedTouch
            ? { x: changedTouch.pageX, y: changedTouch.pageY }
            : touchStartPosRef.current;
          const totalMovement = Math.hypot(
            releasePos.x - touchStartPosRef.current.x,
            releasePos.y - touchStartPosRef.current.y,
          );
          const duration = Date.now() - touchStartTimeRef.current;

          // Se clasifica como toque únicamente si fue un único dedo, movimiento menor al límite
          // y duración breve, descartando cualquier interacción que fue arrastre o pinza
          const isTap =
            touchCountMaxRef.current === 1 &&
            !hasMovedBeyondSlopRef.current &&
            totalMovement < TAP_SLOP_PX &&
            duration < TAP_MAX_DURATION_MS;

          isPinchingRef.current = false;

          if (!isTap) {
            // Fue un arrastre o pinza: invalidar el toque anterior para evitar falsos dobles toques
            lastTapTimeRef.current = 0;
          } else {
            const now = Date.now();
            const tapX = releasePos.x;
            const tapY = releasePos.y;

            if (
              now - lastTapTimeRef.current < DOUBLE_TAP_MAX_GAP_MS &&
              Math.hypot(tapX - lastTapXRef.current, tapY - lastTapYRef.current) <
                DOUBLE_TAP_SLOP_PX
            ) {
              // Doble toque rápido verificado
              lastTapTimeRef.current = 0;
              toggleZoomAt(tapX, tapY);
              return;
            }

            lastTapTimeRef.current = now;
            lastTapXRef.current = tapX;
            lastTapYRef.current = tapY;
          }

          // Reajustar límites de escala mínima y máxima (1.0x a 4.0x)
          let finalScale = currentScale.current;
          if (finalScale < MIN_SCALE) finalScale = MIN_SCALE;
          if (finalScale > MAX_SCALE) finalScale = MAX_SCALE;

          animateTo(
            finalScale,
            currentTranslateX.current,
            currentTranslateY.current,
            process.env.NODE_ENV === 'test' ? 0 : 150,
          );
          if (Math.abs(finalScale - baseScaleRef.current) > 0.1) {
            announce(`Nivel de zoom al ${Math.round(finalScale * 100)}%`);
          }
        },
        onPanResponderTerminate: () => {
          isPinchingRef.current = false;
          lastTapTimeRef.current = 0;
          let finalScale = currentScale.current;
          if (finalScale < MIN_SCALE) finalScale = MIN_SCALE;
          if (finalScale > MAX_SCALE) finalScale = MAX_SCALE;
          animateTo(
            finalScale,
            currentTranslateX.current,
            currentTranslateY.current,
            process.env.NODE_ENV === 'test' ? 0 : 150,
          );
        },
      }),
    ).current;

    const renderedFitted = computeFittedDimensions(
      containerSize.width,
      containerSize.height,
      imageSize,
    );

    return (
      <View
        ref={containerViewRef}
        style={styles.container}
        onLayout={(e: LayoutChangeEvent) => {
          const { width, height } = e.nativeEvent.layout;
          if (width > 0 && height > 0) {
            containerSizeRef.current = { width, height };
            setContainerSize({ width, height });
            containerViewRef.current?.measure((_x, _y, _w, _h, pageX, pageY) => {
              if (typeof pageX === 'number' && typeof pageY === 'number') {
                containerOffsetRef.current = { x: pageX, y: pageY };
              }
            });
            reclampCurrentTranslation(width, height, imageSizeRef.current);
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
            toggleZoomAt();
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
              width: renderedFitted.width,
              height: renderedFitted.height,
              transform: [{ translateX }, { translateY }, { scale }],
            },
          ]}
        >
          <Image
            source={{ uri: sourceUri }}
            style={{
              width: renderedFitted.width,
              height: renderedFitted.height,
            }}
            resizeMode="contain"
            onLoad={(e) => {
              const src = e.nativeEvent?.source;
              if (src?.width && src?.height) {
                imageSizeRef.current = { width: src.width, height: src.height };
                setImageSize({ width: src.width, height: src.height });
                reclampCurrentTranslation(
                  containerSizeRef.current.width || 360,
                  containerSizeRef.current.height || 640,
                  { width: src.width, height: src.height },
                );
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
