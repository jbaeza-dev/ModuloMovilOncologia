import { describe, expect, it } from 'vitest';

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

describe('ZoomableImageView - Geometría, límites y cálculo de transformaciones', () => {
  describe('computeFittedDimensions', () => {
    it('ajusta la imagen al ancho cuando es proporcionalmente más ancha que el contenedor', () => {
      // Contenedor 400 x 800 (ratio 0.5), imagen 400 x 200 (ratio 2.0)
      const fitted = computeFittedDimensions(400, 800, { width: 400, height: 200 });
      expect(fitted.width).toBe(400);
      expect(fitted.height).toBe(200);
    });

    it('ajusta la imagen al alto cuando es proporcionalmente más alta que el contenedor', () => {
      // Contenedor 400 x 800 (ratio 0.5), imagen 200 x 800 (ratio 0.25)
      const fitted = computeFittedDimensions(400, 800, { width: 200, height: 800 });
      expect(fitted.height).toBe(800);
      expect(fitted.width).toBe(200);
    });

    it('usa el tamaño del contenedor como respaldo si la imagen aún no se ha medido', () => {
      const fitted = computeFittedDimensions(400, 800, null);
      expect(fitted.width).toBe(400);
      expect(fitted.height).toBe(800);
    });
  });

  describe('clampTranslation - Límites dinámicos con dimensiones vigentes', () => {
    it('con imagen de 400x200 en contenedor de 400x800 ampliada al 250%, acota el desplazamiento vertical estrictamente a 0', () => {
      // Caso reproducido: contenedor 400x800, imagen ajustada 400x200, escala 2.5x
      // scaledW = 1000 -> maxX = (1000 - 400) / 2 = 300
      // scaledH = 500  -> maxY = max(0, (500 - 800) / 2) = 0
      const { clampedX, clampedY, maxX, maxY } = clampTranslation(
        150,
        480, // intento de desplazamiento vertical previo
        2.5,
        400,
        800,
        400,
        200,
      );

      expect(maxX).toBe(300);
      expect(maxY).toBe(0);
      expect(clampedX).toBe(150);
      // El límite vertical correcto es 0: no se permite desplazamiento hacia el vacío
      expect(clampedY).toBe(0);
    });

    it('acota el desplazamiento horizontal al valor máximo permitido', () => {
      const { clampedX: positiveClamped } = clampTranslation(500, 0, 2.5, 400, 800, 400, 200);
      expect(positiveClamped).toBe(300);

      const { clampedX: negativeClamped } = clampTranslation(-600, 0, 2.5, 400, 800, 400, 200);
      expect(negativeClamped).toBe(-300);
    });

    it('al 100% (escala 1.0), los límites maxX y maxY son cero y anulan cualquier traslación residual', () => {
      const { clampedX, clampedY, maxX, maxY } = clampTranslation(50, -80, 1.0, 400, 800, 400, 200);
      expect(maxX).toBe(0);
      expect(maxY).toBe(0);
      expect(clampedX).toBe(0);
      expect(clampedY).toBe(0);
    });

    it('con imagen más alta que el contenedor ampliada, calcula límites verticales positivos', () => {
      // Contenedor 400x800, imagen 400x600 ampliada a 2.5x -> scaledH = 1500
      // maxY = (1500 - 800) / 2 = 350
      const { clampedY, maxY } = clampTranslation(0, 400, 2.5, 400, 800, 400, 600);
      expect(maxY).toBe(350);
      expect(clampedY).toBe(350);
    });
  });

  describe('computePinchTransform - Conservación del punto focal entre los dedos', () => {
    it('al pellizcar simétricamente alrededor del centro, no desplaza el centro de la imagen', () => {
      const containerCenter = { x: 200, y: 400 };
      const focalPoint0 = { x: 200, y: 400 };

      // Dedos se separan de distancia 100 a 200 simétricamente respecto al centro
      const touches: [{ pageX: number; pageY: number }, { pageX: number; pageY: number }] = [
        { pageX: 100, pageY: 400 },
        { pageX: 300, pageY: 400 },
      ];

      const { newScale, targetX, targetY } = computePinchTransform(
        touches,
        100, // distancia inicial
        1.0, // escala base
        0, // baseTx
        0, // baseTy
        focalPoint0,
        containerCenter,
      );

      expect(newScale).toBe(2.0);
      expect(targetX).toBe(0);
      expect(targetY).toBe(0);
    });

    it('al pellizcar en una zona lateral (desplazada del centro), traslada la imagen para que el punto bajo los dedos permanezca en su lugar', () => {
      const containerCenter = { x: 200, y: 400 };
      // Punto focal inicial desplazado 100 px a la derecha del centro (x = 300, y = 400)
      const focalPoint0 = { x: 300, y: 400 };

      // Dedos duplican la distancia (de 100 a 200 px) manteniendo el mismo punto focal
      const touches: [{ pageX: number; pageY: number }, { pageX: number; pageY: number }] = [
        { pageX: 200, pageY: 400 },
        { pageX: 400, pageY: 400 },
      ];

      const { newScale, targetX, targetY } = computePinchTransform(
        touches,
        100,
        1.0,
        0,
        0,
        focalPoint0,
        containerCenter,
      );

      expect(newScale).toBe(2.0);
      // El desplazamiento compensatorio debe ser -100 px para que el punto x=300 siga bajo los dedos
      expect(targetX).toBe(-100);
      expect(targetY).toBe(0);
    });

    it('protege contra división por cero si la distancia inicial es menor o igual a 5 px', () => {
      const containerCenter = { x: 200, y: 400 };
      const touches: [{ pageX: number; pageY: number }, { pageX: number; pageY: number }] = [
        { pageX: 200, pageY: 400 },
        { pageX: 202, pageY: 400 },
      ];

      const { newScale, targetX, targetY } = computePinchTransform(
        touches,
        0, // distancia inicial no inicializada
        1.0,
        15,
        25,
        { x: 200, y: 400 },
        containerCenter,
      );

      expect(newScale).toBe(1.0);
      expect(targetX).toBe(15);
      expect(targetY).toBe(25);
    });
  });

  describe('Constantes y umbrales del visor', () => {
    it('define escalas y límites de gestos coherentes', () => {
      expect(MIN_SCALE).toBe(1.0);
      expect(DOUBLE_TAP_SCALE).toBe(2.5);
      expect(MAX_SCALE).toBe(4.0);
      expect(TAP_MAX_DURATION_MS).toBe(280);
      expect(TAP_SLOP_PX).toBe(10);
      expect(DOUBLE_TAP_MAX_GAP_MS).toBe(300);
      expect(DOUBLE_TAP_SLOP_PX).toBe(35);
    });
  });
});
