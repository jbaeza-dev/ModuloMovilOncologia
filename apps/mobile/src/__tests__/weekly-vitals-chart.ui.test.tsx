/// <reference types="jest" />

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { AccessibilityInfo } from 'react-native';

const mockTheme = {
  colors: {
    background: '#FFF7E7',
    surface: '#FFFFFF',
    mutedSurface: '#F3EFE6',
    primary: '#006A70',
    onPrimary: '#FFFFFF',
    primaryContainer: '#D1ECE8',
    onPrimaryContainer: '#002022',
    border: '#5C746C',
    inputBorder: '#5C746C',
    inputBorderFocused: '#006A70',
    text: '#191C1D',
    secondary: '#4A6360',
    error: '#BA1A1A',
    onError: '#FFFFFF',
    errorContainer: '#FFDAD6',
    onErrorContainer: '#410002',
    success: '#006A70',
    warning: '#7D5700',
    pressed: '#E0E0E0',
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { sm: 12, md: 18, full: 9999 },
};

jest.mock('../providers/ThemeProvider', () => ({
  useAppTheme: () => ({ theme: mockTheme }),
}));

import type { VitalWithSyncRecord } from '../data/local/repository';
import { WeeklyVitalsChart } from '../features/vitals/WeeklyVitalsChart';

const nowIso = new Date().toISOString();
const yesterdayIso = new Date(Date.now() - 86400000).toISOString();

const mockRecords: VitalWithSyncRecord[] = [
  {
    id: 'vit-1',
    paciente_id: 'paciente-a',
    fecha_registro: nowIso,
    fecha_subida: null,
    estado_envio: null,
    temperatura: 36.6,
    presion_sistolica: 120,
    presion_diastolica: 80,
    pulso: 72,
    saturacion_o2: 98,
  },
  {
    id: 'vit-2',
    paciente_id: 'paciente-a',
    fecha_registro: yesterdayIso,
    fecha_subida: null,
    estado_envio: null,
    temperatura: 37.2,
    presion_sistolica: 128,
    presion_diastolica: 84,
    pulso: 80,
    saturacion_o2: 97,
  },
];

describe('Weekly Vitals Chart UI (Etapa 8)', () => {
  it('conserva las ausencias por métrica sin sustituirlas por mediciones de ejemplo', async () => {
    await render(<WeeklyVitalsChart records={[{ ...mockRecords[0], temperatura: null }]} />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Ver gráfica de Temperatura' }));
    expect(screen.getAllByRole('button', { name: /Sin registros/ })).toHaveLength(7);
    await fireEvent.press(screen.getByRole('button', { name: 'Ver tabla de valores accesible' }));
    expect(screen.queryByText('36.5 °C')).toBeNull();
    expect(screen.queryByText('36.6 °C')).toBeNull();
  });

  it('amplía la escala para mostrar mediciones fuera de los límites iniciales sin recortarlas', async () => {
    await render(
      <WeeklyVitalsChart
        records={[{ ...mockRecords[0], presion_sistolica: 180, presion_diastolica: 55 }]}
      />,
    );
    expect(screen.getByText('Escala: 55 a 180 mmHg')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Sistólica 180, Diastólica 55/ })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Ver tabla de valores accesible' }));
    expect(screen.getByText('180 / 55 mmHg')).toBeTruthy();
  });
  it('renderiza la métrica de presión arterial por defecto con escala y leyenda diferenciada', async () => {
    await render(<WeeklyVitalsChart records={mockRecords} />);

    expect(screen.getByText('Presión arterial (mmHg)')).toBeTruthy();
    expect(screen.getByText(/Escala: 60 a 160 mmHg/)).toBeTruthy();
    expect(screen.getByText('▲ Sistólica (sólida)')).toBeTruthy();
    expect(screen.getByText('▼ Diastólica (punteada)')).toBeTruthy();
  });

  it('permite alternar métricas a Temperatura y Pulso con anuncios de accesibilidad', async () => {
    const announceSpy = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');

    await render(<WeeklyVitalsChart records={mockRecords} />);

    // Cambiar a Temperatura
    const tempTab = screen.getByRole('tab', { name: 'Ver gráfica de Temperatura' });
    expect(tempTab).toBeTruthy();
    await fireEvent.press(tempTab);

    expect(screen.getByText('Temperatura (°C)')).toBeTruthy();
    expect(screen.getByText(/Escala: 35 a 39 °C/)).toBeTruthy();
    expect(announceSpy).toHaveBeenCalledWith('Métrica cambiada a Temperatura (°C).');

    // Cambiar a Pulso
    const pulseTab = screen.getByRole('tab', { name: 'Ver gráfica de Pulso' });
    expect(pulseTab).toBeTruthy();
    await fireEvent.press(pulseTab);

    expect(screen.getByText('Pulso (lpm)')).toBeTruthy();
    expect(screen.getByText(/Escala: 50 a 110 lpm/)).toBeTruthy();
    expect(announceSpy).toHaveBeenCalledWith('Métrica cambiada a Pulso (lpm).');

    announceSpy.mockRestore();
  });

  it('despliega la tabla accesible TalkBack con los 7 días y valores exactos', async () => {
    await render(<WeeklyVitalsChart records={mockRecords} />);

    const toggleTable = screen.getByRole('button', {
      name: 'Ver tabla de valores accesible',
    });
    expect(toggleTable).toBeTruthy();
    await fireEvent.press(toggleTable);

    await waitFor(() => {
      expect(screen.getByText('Ocultar tabla de valores')).toBeTruthy();
    });

    // Muestra valores exactos en texto estructurado
    expect(screen.getByText('120 / 80 mmHg')).toBeTruthy();
    expect(screen.getByText('128 / 84 mmHg')).toBeTruthy();
  });
});
