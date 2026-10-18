export const MIN_SCALE = 1.0;
export const MAX_SCALE = 4.0;
export const DOUBLE_TAP_SCALE = 2.5;
export const TAP_MAX_DURATION_MS = 280;
export const TAP_SLOP_PX = 10;
export const DOUBLE_TAP_MAX_GAP_MS = 300;
export const DOUBLE_TAP_SLOP_PX = 35;

/**
 * Calcula las dimensiones ajustadas (aspect-fit) dentro del contenedor.
 */
export function computeFittedDimensions(
  containerW: number,
  containerH: number,
  imgSize: { width: number; height: number } | null,
): { width: number; height: number } {
  const W = containerW > 0 ? containerW : 360;
  const H = containerH > 0 ? containerH : 640;
  if (!imgSize || imgSize.width <= 0 || imgSize.height <= 0) {
    return { width: W, height: H };
  }
  const imageRatio = imgSize.width / imgSize.height;
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
}

/**
 * Acota las coordenadas de traslación para que la imagen no se desplace más allá
 * de sus bordes visibles dentro del contenedor para una escala determinada.
 */
export function clampTranslation(
  x: number,
  y: number,
  targetScale: number,
  containerW: number,
  containerH: number,
  fittedW: number,
  fittedH: number,
): { clampedX: number; clampedY: number; maxX: number; maxY: number } {
  const W = containerW > 0 ? containerW : 360;
  const H = containerH > 0 ? containerH : 640;

  const scaledW = fittedW * targetScale;
  const scaledH = fittedH * targetScale;

  const maxX = Math.max(0, (scaledW - W) / 2);
  const maxY = Math.max(0, (scaledH - H) / 2);

  const rawClampedX = Math.min(maxX, Math.max(-maxX, x));
  const rawClampedY = Math.min(maxY, Math.max(-maxY, y));

  const clampedX = Object.is(rawClampedX, -0) ? 0 : rawClampedX;
  const clampedY = Object.is(rawClampedY, -0) ? 0 : rawClampedY;

  return { clampedX, clampedY, maxX, maxY };
}

/**
 * Calcula la nueva escala y la traslación compensada para preservar el punto focal
 * (punto medio entre los dos dedos) durante un gesto de pinza.
 */
export function computePinchTransform(
  touches: [{ pageX: number; pageY: number }, { pageX: number; pageY: number }],
  initialDistance: number,
  baseScale: number,
  baseTranslateX: number,
  baseTranslateY: number,
  focalPoint0: { x: number; y: number },
  containerCenter: { x: number; y: number },
): { newScale: number; targetX: number; targetY: number } {
  const currentDist = Math.hypot(
    touches[0].pageX - touches[1].pageX,
    touches[0].pageY - touches[1].pageY,
  );
  if (initialDistance <= 5) {
    return {
      newScale: baseScale,
      targetX: baseTranslateX,
      targetY: baseTranslateY,
    };
  }

  const factor = currentDist / initialDistance;
  const newScale = Math.min(Math.max(baseScale * factor, 0.8), 4.5);

  const curFocal = {
    x: (touches[0].pageX + touches[1].pageX) / 2,
    y: (touches[0].pageY + touches[1].pageY) / 2,
  };

  const v0x = focalPoint0.x - containerCenter.x;
  const v0y = focalPoint0.y - containerCenter.y;

  const curVx = curFocal.x - containerCenter.x;
  const curVy = curFocal.y - containerCenter.y;

  const scaleRatio = newScale / (baseScale || 1);
  const targetX = curVx - scaleRatio * (v0x - baseTranslateX);
  const targetY = curVy - scaleRatio * (v0y - baseTranslateY);

  return { newScale, targetX, targetY };
}
