/// <reference types="jest" />

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React, { createRef } from 'react';
import { AccessibilityInfo } from 'react-native';

import {
  DOUBLE_TAP_SCALE,
  MIN_SCALE,
  ZoomableImageView,
  type ZoomableImageViewRef,
} from '../features/education/ZoomableImageView';

let syntheticTimestamp = 1000;

function createTouchEvent(
  touches: Array<{ pageX: number; pageY: number }>,
  changedTouches = touches,
) {
  syntheticTimestamp += 20;
  const ts = syntheticTimestamp;
  return {
    nativeEvent: {
      touches,
      changedTouches,
    },
    touchHistory: {
      mostRecentTimeStamp: ts,
      numberActiveTouches: touches.length,
      touchBank: touches.map((t) => ({
        touchActive: true,
        startPageX: t.pageX,
        startPageY: t.pageY,
        startTimeStamp: ts,
        currentPageX: t.pageX,
        currentPageY: t.pageY,
        currentTimeStamp: ts,
        previousPageX: t.pageX,
        previousPageY: t.pageY,
        previousTimeStamp: ts - 20,
      })),
      indexOfSingleActiveTouch: touches.length === 1 ? 0 : 0,
    },
  };
}

describe('ZoomableImageView - Manejo de gestos táctiles y accesibilidad', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  });

  it('renderiza la imagen y expone los métodos imperativos de control de escala', async () => {
    const ref = createRef<ZoomableImageViewRef>();
    const onScaleChange = jest.fn();
    const onZoomAnnouncement = jest.fn();

    await render(
      <ZoomableImageView
        ref={ref}
        sourceUri="file:///test-image.png"
        accessibilityLabel="Infografía interactiva"
        onScaleChange={onScaleChange}
        onZoomAnnouncement={onZoomAnnouncement}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Infografía interactiva')).toBeTruthy();
      expect(ref.current?.getScale()).toBe(MIN_SCALE);
    });

    // Zoom in gradual
    await act(async () => {
      ref.current?.zoomIn();
    });
    expect(ref.current?.getScale()).toBe(1.75);
    expect(onScaleChange).toHaveBeenCalledWith(1.75);
    expect(onZoomAnnouncement).toHaveBeenCalledWith('Nivel de zoom al 175%');

    // Zoom in a escala de lectura
    await act(async () => {
      ref.current?.zoomIn();
    });
    expect(ref.current?.getScale()).toBe(2.5);

    // Zoom out gradual
    await act(async () => {
      ref.current?.zoomOut();
    });
    expect(ref.current?.getScale()).toBe(1.75);

    // Reset zoom a 100%
    await act(async () => {
      ref.current?.resetZoom();
    });
    expect(ref.current?.getScale()).toBe(MIN_SCALE);
    expect(onZoomAnnouncement).toHaveBeenCalledWith('Imagen ajustada a la pantalla (100%)');
  });

  it('soporta alternancia de zoom con toggleZoom entre 1.0x y 2.5x', async () => {
    const ref = createRef<ZoomableImageViewRef>();

    await render(
      <ZoomableImageView
        ref={ref}
        sourceUri="file:///test-image.png"
        accessibilityLabel="Infografía interactiva"
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Infografía interactiva')).toBeTruthy();
      expect(ref.current?.getScale()).toBe(MIN_SCALE);
    });

    // Conmuta a 2.5x
    await act(async () => {
      ref.current?.toggleZoom();
    });
    expect(ref.current?.getScale()).toBe(DOUBLE_TAP_SCALE);

    // Conmuta de vuelta a 1.0x
    await act(async () => {
      ref.current?.toggleZoom();
    });
    expect(ref.current?.getScale()).toBe(MIN_SCALE);
  });

  it('responde a las acciones de accesibilidad nativas de TalkBack (activate, increment, decrement)', async () => {
    const ref = createRef<ZoomableImageViewRef>();
    const onZoomAnnouncement = jest.fn();

    await render(
      <ZoomableImageView
        ref={ref}
        sourceUri="file:///test-image.png"
        accessibilityLabel="Infografía interactiva"
        onZoomAnnouncement={onZoomAnnouncement}
      />,
    );

    let imageNode!: ReturnType<typeof screen.getByLabelText>;
    await waitFor(() => {
      imageNode = screen.getByLabelText('Infografía interactiva');
      expect(imageNode).toBeTruthy();
    });

    // Acción TalkBack: activate -> conmuta a 250%
    fireEvent(imageNode, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    await waitFor(() => {
      expect(ref.current?.getScale()).toBe(DOUBLE_TAP_SCALE);
      expect(onZoomAnnouncement).toHaveBeenCalledWith('Imagen ampliada al 250%');
    });

    // Acción TalkBack: increment -> pasa al siguiente nivel (3.5x)
    fireEvent(imageNode, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    await waitFor(() => {
      expect(ref.current?.getScale()).toBe(3.5);
    });

    // Acción TalkBack: decrement -> regresa a 2.5x
    fireEvent(imageNode, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    await waitFor(() => {
      expect(ref.current?.getScale()).toBe(2.5);
    });
  });

  it('gesto de pinza: detecta la transición de 1 a 2 dedos e inicializa la escala proporcionalmente', async () => {
    const ref = createRef<ZoomableImageViewRef>();
    const onScaleChange = jest.fn();

    await render(
      <ZoomableImageView
        ref={ref}
        sourceUri="file:///test-image.png"
        accessibilityLabel="Infografía interactiva"
        onScaleChange={onScaleChange}
      />,
    );

    let imageNode!: ReturnType<typeof screen.getByLabelText>;
    await waitFor(() => {
      imageNode = screen.getByLabelText('Infografía interactiva');
      expect(imageNode).toBeTruthy();
    });

    // Simular secuencia completa de pinza: 1 dedo -> 2 dedos -> separación al doble -> liberación
    await act(async () => {
      imageNode.props.onResponderGrant(createTouchEvent([{ pageX: 100, pageY: 200 }]));
      imageNode.props.onResponderMove(
        createTouchEvent([
          { pageX: 100, pageY: 200 },
          { pageX: 200, pageY: 200 },
        ]),
      );
      imageNode.props.onResponderMove(
        createTouchEvent([
          { pageX: 50, pageY: 200 },
          { pageX: 250, pageY: 200 },
        ]),
      );
      imageNode.props.onResponderRelease(createTouchEvent([], [{ pageX: 50, pageY: 200 }]));
    });

    expect(ref.current?.getScale()).toBe(2.0);
    expect(onScaleChange).toHaveBeenCalledWith(2.0);
  });

  it('dos arrastres rápidos sucesivos se descartan y no se confunden con un doble toque', async () => {
    const ref = createRef<ZoomableImageViewRef>();

    await render(
      <ZoomableImageView
        ref={ref}
        sourceUri="file:///test-image.png"
        accessibilityLabel="Infografía interactiva"
      />,
    );

    let imageNode!: ReturnType<typeof screen.getByLabelText>;
    await waitFor(() => {
      imageNode = screen.getByLabelText('Infografía interactiva');
      expect(imageNode).toBeTruthy();
    });

    // Establecer primero en 250% mediante acción accesible
    fireEvent(imageNode, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    await waitFor(() => {
      expect(ref.current?.getScale()).toBe(DOUBLE_TAP_SCALE);
    });

    // Primer arrastre rápido: desplazamiento de 50 px (> 10 px)
    await act(async () => {
      imageNode.props.onResponderGrant(createTouchEvent([{ pageX: 100, pageY: 200 }]));
      imageNode.props.onResponderMove(createTouchEvent([{ pageX: 150, pageY: 200 }]));
      imageNode.props.onResponderRelease(createTouchEvent([], [{ pageX: 150, pageY: 200 }]));
    });

    // Segundo arrastre rápido inmediato: desplazamiento de 60 px
    await act(async () => {
      imageNode.props.onResponderGrant(createTouchEvent([{ pageX: 150, pageY: 200 }]));
      imageNode.props.onResponderMove(createTouchEvent([{ pageX: 210, pageY: 200 }]));
      imageNode.props.onResponderRelease(createTouchEvent([], [{ pageX: 210, pageY: 200 }]));
    });

    // La escala NO debe haber conmutado a 1.0x (se mantiene en 2.5x)
    expect(ref.current?.getScale()).toBe(DOUBLE_TAP_SCALE);
  });

  it('un doble toque auténtico (breve y sin desplazamiento) conmuta la ampliación de 100% a 250%', async () => {
    const ref = createRef<ZoomableImageViewRef>();

    await render(
      <ZoomableImageView
        ref={ref}
        sourceUri="file:///test-image.png"
        accessibilityLabel="Infografía interactiva"
      />,
    );

    let imageNode!: ReturnType<typeof screen.getByLabelText>;
    await waitFor(() => {
      imageNode = screen.getByLabelText('Infografía interactiva');
      expect(ref.current?.getScale()).toBe(MIN_SCALE);
    });

    // Primer toque breve (sin movimiento)
    await act(async () => {
      imageNode.props.onResponderGrant(createTouchEvent([{ pageX: 150, pageY: 200 }]));
      imageNode.props.onResponderRelease(createTouchEvent([], [{ pageX: 150, pageY: 200 }]));
    });

    // Segundo toque breve en la misma posición (< 300 ms)
    await act(async () => {
      imageNode.props.onResponderGrant(createTouchEvent([{ pageX: 152, pageY: 201 }]));
      imageNode.props.onResponderRelease(createTouchEvent([], [{ pageX: 152, pageY: 201 }]));
    });

    // Conmuta a 250%
    expect(ref.current?.getScale()).toBe(DOUBLE_TAP_SCALE);
  });

  it('recalcula las dimensiones y límites al disparar onLayout en el contenedor', async () => {
    const ref = createRef<ZoomableImageViewRef>();

    await render(
      <ZoomableImageView
        ref={ref}
        sourceUri="file:///test-image.png"
        accessibilityLabel="Infografía interactiva"
      />,
    );

    let imageNode!: ReturnType<typeof screen.getByLabelText>;
    await waitFor(() => {
      imageNode = screen.getByLabelText('Infografía interactiva');
      expect(ref.current?.getScale()).toBe(MIN_SCALE);
    });

    // Disparar evento de layout con dimensiones de pantalla reales
    await act(async () => {
      imageNode.props.onLayout({
        nativeEvent: {
          layout: { x: 0, y: 0, width: 400, height: 800 },
        },
      });
    });

    expect(ref.current?.getScale()).toBe(MIN_SCALE);
  });
});
