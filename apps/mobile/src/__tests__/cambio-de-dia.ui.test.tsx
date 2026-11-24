/// <reference types="jest" />
import React from 'react';
import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';

const mockAppStateListeners: ((state: string) => void)[] = [];
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return { useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]) };
});
import { AppState } from 'react-native';
jest.spyOn(AppState, 'addEventListener').mockImplementation((_event: string, handler: unknown) => {
  const listener = handler as (state: string) => void;
  mockAppStateListeners.push(listener);
  return {
    remove: () => {
      const index = mockAppStateListeners.indexOf(listener);
      if (index !== -1) mockAppStateListeners.splice(index, 1);
    },
  } as unknown as ReturnType<typeof AppState.addEventListener>;
});
import { useFocusedList, useFocusedValue } from '../hooks/use-local-query';
import { useCivilDay } from '../hooks/use-civil-day';

// 23:59:30 del 23-11-2026 en Santiago (UTC-3 en horario de verano).
const beforeMidnight = new Date('2026-11-24T02:59:30.000Z');

function Value({ load }: { load: () => Promise<string> }) {
  const { value } = useFocusedValue(load, 'inicial');
  return <Text>{value}</Text>;
}
function List({ load }: { load: () => Promise<string[]> }) {
  const { items } = useFocusedList(load);
  return <Text>{items.join(',')}</Text>;
}
function Day() {
  return <Text>{useCivilDay()}</Text>;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(beforeMidnight);
  mockAppStateListeners.length = 0;
});
afterEach(() => {
  jest.useRealTimers();
});

describe('cambio de día con la app abierta', () => {
  it('una pantalla abierta antes de las 00:00 vuelve a cargar sus datos al pasar la medianoche', async () => {
    const load = jest.fn(async () => new Date().toISOString());
    await render(<Value load={load} />);
    await act(async () => {});
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(29_000);
    });
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(2_000);
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/^2026-11-24T03:00/)).toBeTruthy();
  });

  it('las listas también se recargan al cambiar el día', async () => {
    const load = jest.fn(async () => [new Date().toISOString().slice(11, 16)]);
    await render(<List load={load} />);
    await act(async () => {});
    await act(async () => {
      jest.advanceTimersByTime(31_000);
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('entrega la fecha de hoy en Chile y la cambia justo a la medianoche', async () => {
    await render(<Day />);
    expect(screen.getByText('2026-11-23')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(31_000);
    });
    expect(screen.getByText('2026-11-24')).toBeTruthy();
  });

  it('al volver del segundo plano después de la medianoche muestra el día nuevo', async () => {
    await render(<Day />);
    // Con la app en segundo plano el temporizador puede no ejecutarse a tiempo.
    jest.setSystemTime(new Date('2026-11-24T12:00:00.000Z'));
    await act(async () => {
      for (const listener of [...mockAppStateListeners]) listener('active');
    });
    expect(screen.getByText('2026-11-24')).toBeTruthy();
  });

  it('respeta la noche en que se atrasa el reloj por el fin del horario de verano', async () => {
    // 05-04-2026: a las 00:00 de Santiago el reloj vuelve a las 23:00 (UTC-3 → UTC-4).
    jest.setSystemTime(new Date('2026-04-05T02:30:00.000Z'));
    await render(<Day />);
    expect(screen.getByText('2026-04-04')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(31 * 60_000);
    });
    expect(screen.getByText('2026-04-04')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(60 * 60_000);
    });
    expect(screen.getByText('2026-04-05')).toBeTruthy();
  });
});
