/// <reference types="jest" />

import { fireEvent, render, screen } from '@testing-library/react-native';
import React, { createRef } from 'react';
import * as ReactNative from 'react-native';
import { Text, type TextInput } from 'react-native';

import { Screen } from '../components/Screen';
import { DetailsDisclosure } from '../components/DetailsDisclosure';
import { DetailRow, FeedbackBanner, StatusPill, VisualField } from '../components/Visual';

jest.mock('expo-router', () => ({
  router: {
    back: jest.fn(),
    navigate: jest.fn(),
    push: jest.fn(),
    canGoBack: () => true,
  },
  useNavigationState: () => false,
}));

jest.mock('expo-router/react-navigation', () => ({
  useNavigationState: () => false,
}));

const mockTheme = {
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { sm: 12, md: 18 },
  colors: {
    background: '#FFFFFF',
    surface: '#F5F5F5',
    mutedSurface: '#E0E0E0',
    border: '#D0D0D0',
    inputBorder: '#767676',
    inputBorderFocused: '#00695C',
    text: '#212121',
    secondary: '#555555',
    inverse: '#FFFFFF',
    pressed: '#E0E0E0',
    primary: '#00695C',
    onPrimary: '#FFFFFF',
    primaryContainer: '#E0F2EF',
    onPrimaryContainer: '#183B36',
    success: '#2E7D32',
    warning: '#8D5700',
    error: '#B3261E',
    onError: '#FFFFFF',
    errorContainer: '#FDE8E8',
    onErrorContainer: '#8A1C14',
  },
  typography: {
    screenTitle: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
    sectionTitle: { fontSize: 20, lineHeight: 26, fontWeight: '700' },
    body: { fontSize: 16, lineHeight: 24 },
    label: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
    editableValue: { fontSize: 18, lineHeight: 24 },
    button: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
    helper: { fontSize: 14, lineHeight: 20 },
  },
};

jest.mock('../providers/ThemeProvider', () => ({
  useAppTheme: () => ({ theme: mockTheme }),
}));

describe('Componentes Accesibles Visual.tsx y Screen.tsx (B1 - UX-03 a UX-07)', () => {
  it('permite consultar y volver a ocultar información secundaria sin ocultar la acción principal', async () => {
    await render(
      <>
        <Text>Registrar medición</Text>
        <DetailsDisclosure title="Estado de mi información">
          <Text>Consultado hoy a las 12:00</Text>
        </DetailsDisclosure>
      </>,
    );
    const toggle = screen.getByRole('button', { name: 'Estado de mi información' });
    expect(toggle.props.accessibilityState.expanded).toBe(false);
    expect(screen.queryByText('Consultado hoy a las 12:00')).toBeNull();
    await fireEvent.press(toggle);
    expect(screen.getByText('Consultado hoy a las 12:00')).toBeTruthy();
    expect(screen.getByText('Registrar medición')).toBeTruthy();
    await fireEvent.press(toggle);
    expect(screen.queryByText('Consultado hoy a las 12:00')).toBeNull();
    expect(screen.getByText('Registrar medición')).toBeTruthy();
  });
  describe('VisualField', () => {
    it('muestra etiqueta visible, texto de ayuda y soporte de accesibilidad', async () => {
      await render(
        <VisualField
          label="Temperatura corporal (°C)"
          value="36.5"
          helperText="Ejemplo de formato: 36,8"
          accessibilityHint="Ingresa tu temperatura en grados Celsius"
        />,
      );

      expect(screen.getByText('Temperatura corporal (°C)')).toBeTruthy();
      expect(screen.getByText('Ejemplo de formato: 36,8')).toBeTruthy();
      const input = screen.getByDisplayValue('36.5');
      expect(input.props.accessibilityLabel).toBe('Temperatura corporal (°C)');
      expect(input.props.accessibilityHint).toBe('Ingresa tu temperatura en grados Celsius');
    });

    it('vincula la etiqueta visible al campo y usa la ayuda como pista para TalkBack', async () => {
      await render(
        <VisualField
          label="Temperatura corporal (°C)"
          value=""
          placeholder="Ej.: 36,8"
          helperText="Entrada de 30,0 a 45,0 °C"
        />,
      );

      const input = screen.getByPlaceholderText('Ej.: 36,8');
      const labelId = input.props.accessibilityLabelledBy as string;
      expect(labelId).toMatch(/-label$/);
      expect(screen.getByText('Temperatura corporal (°C)').props.nativeID).toBe(labelId);
      expect(input.props.accessibilityLabel).toBe('Temperatura corporal (°C)');
      expect(input.props.accessibilityHint).toBe('Entrada de 30,0 a 45,0 °C');
    });

    it('respeta el nativeID entregado para la etiqueta', async () => {
      await render(<VisualField label="Peso" value="70" nativeID="peso" />);
      expect(screen.getByDisplayValue('70').props.accessibilityLabelledBy).toBe('peso-label');
    });

    it('muestra error visible con anuncio accesible y borde destacado', async () => {
      await render(
        <VisualField label="Presión sistólica" value="abc" errorText="Ingresa un número válido" />,
      );

      expect(screen.getByText('Ingresa un número válido')).toBeTruthy();
      const input = screen.getByDisplayValue('abc');
      expect(input.props['aria-invalid']).toBe(true);
    });

    it('permite enfocar el TextInput mediante inputRef', async () => {
      const inputRef = createRef<TextInput>();
      await render(<VisualField label="Campo con foco" value="" inputRef={inputRef} />);

      expect(inputRef.current).not.toBeNull();
      expect(typeof inputRef.current?.focus).toBe('function');
    });

    it('aplica estilo editableValue con tipografía de 18dp e interlineado 24 cuando se habilita editableValueStyle', async () => {
      await render(<VisualField label="Temperatura editable" value="37.2" editableValueStyle />);

      const input = screen.getByDisplayValue('37.2');
      expect(input.props.style).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fontSize: mockTheme.typography.editableValue.fontSize,
            lineHeight: mockTheme.typography.editableValue.lineHeight,
          }),
        ]),
      );
    });
  });

  describe('StatusPill', () => {
    it('soporta variante default y variante danger con contraste adecuado', async () => {
      await render(
        <>
          <StatusPill>Activo</StatusPill>
          <StatusPill variant="danger">Error nativo</StatusPill>
        </>,
      );

      expect(screen.getByText('Activo')).toBeTruthy();
      const danger = screen.getByText('Error nativo');
      expect(danger).toBeTruthy();
      expect(danger.props.style).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            backgroundColor: mockTheme.colors.error,
            color: mockTheme.colors.onError,
          }),
        ]),
      );
    });
  });

  describe('DetailRow', () => {
    it('admite layout vertical para textos largos sin truncar', async () => {
      await render(
        <DetailRow
          label="Observaciones clínicas"
          value="Tratamiento de primera línea con buena tolerancia."
          layout="vertical"
        />,
      );

      expect(screen.getByText('Observaciones clínicas')).toBeTruthy();
      expect(screen.getByText('Tratamiento de primera línea con buena tolerancia.')).toBeTruthy();
    });
  });

  describe('FeedbackBanner', () => {
    it('muestra banner accesible con título, mensaje y acción opcional', async () => {
      const onAction = jest.fn();
      await render(
        <FeedbackBanner
          title="Medición guardada en este dispositivo"
          message="Los datos permanecen seguros en tu teléfono."
          variant="success"
          actionLabel="Ver registro"
          onAction={onAction}
        />,
      );

      expect(screen.getByText('Medición guardada en este dispositivo')).toBeTruthy();
      expect(screen.getByText('Los datos permanecen seguros en tu teléfono.')).toBeTruthy();
      const button = screen.getByText('Ver registro');
      expect(button).toBeTruthy();
      fireEvent.press(button);
      expect(onAction).toHaveBeenCalledTimes(1);
    });
  });

  describe('Screen con bottomAction', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('renderiza bottomAction dentro de la jerarquía de la pantalla', async () => {
      await render(
        <Screen
          title="Prueba de pantalla"
          bottomAction={<Text testID="bottom-btn">Guardar registro</Text>}
        >
          <Text>Contenido principal</Text>
        </Screen>,
      );

      expect(screen.getByText('Prueba de pantalla')).toBeTruthy();
      expect(screen.getByText('Contenido principal')).toBeTruthy();
      expect(screen.getByTestId('bottom-btn')).toBeTruthy();
    });

    it('renderiza bottomAction en contenedor fijo por defecto cuando las dimensiones son estándar', async () => {
      jest.spyOn(ReactNative, 'useWindowDimensions').mockReturnValue({
        width: 360,
        height: 800,
        scale: 2,
        fontScale: 1,
      });
      jest.spyOn(ReactNative.Dimensions, 'get').mockReturnValue({
        width: 360,
        height: 800,
        scale: 2,
        fontScale: 1,
      });

      await render(
        <Screen
          title="Prueba de pantalla normal"
          bottomAction={<Text testID="bottom-btn-normal">Guardar registro</Text>}
        >
          <Text>Contenido principal</Text>
        </Screen>,
      );

      expect(screen.getByTestId('screen-bottom-action-container')).toBeTruthy();
      expect(screen.queryByTestId('screen-bottom-action-inline')).toBeNull();
    });

    it('renderiza bottomAction inline dentro de ScrollView cuando fontScale > 1.3', async () => {
      jest.spyOn(ReactNative, 'useWindowDimensions').mockReturnValue({
        width: 360,
        height: 800,
        scale: 2,
        fontScale: 1.5,
      });
      jest.spyOn(ReactNative.Dimensions, 'get').mockReturnValue({
        width: 360,
        height: 800,
        scale: 2,
        fontScale: 1.5,
      });

      await render(
        <Screen
          title="Prueba de pantalla ampliada"
          bottomAction={<Text testID="bottom-btn-scaled">Guardar registro</Text>}
        >
          <Text>Contenido principal</Text>
        </Screen>,
      );

      expect(screen.getByTestId('screen-bottom-action-inline')).toBeTruthy();
      expect(screen.queryByTestId('screen-bottom-action-container')).toBeNull();
      expect(screen.getByTestId('bottom-btn-scaled')).toBeTruthy();
    });

    it('renderiza bottomAction inline dentro de ScrollView cuando height < 550', async () => {
      jest.spyOn(ReactNative, 'useWindowDimensions').mockReturnValue({
        width: 360,
        height: 480,
        scale: 2,
        fontScale: 1,
      });
      jest.spyOn(ReactNative.Dimensions, 'get').mockReturnValue({
        width: 360,
        height: 480,
        scale: 2,
        fontScale: 1,
      });

      await render(
        <Screen
          title="Prueba de pantalla reducida"
          bottomAction={<Text testID="bottom-btn-short">Guardar registro</Text>}
        >
          <Text>Contenido principal</Text>
        </Screen>,
      );

      expect(screen.getByTestId('screen-bottom-action-inline')).toBeTruthy();
      expect(screen.queryByTestId('screen-bottom-action-container')).toBeNull();
    });
  });
});
