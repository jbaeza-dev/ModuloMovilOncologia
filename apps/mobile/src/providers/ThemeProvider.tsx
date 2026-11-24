import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useColorScheme } from 'react-native';

import { isPaletteId, resolveTheme, type AppTheme, type PaletteId } from '../theme';
import { devWarn } from '../services/diagnostics/dev-warn';

const PALETTE_STORAGE_KEY = 'quimiocare.appearance.palette';

type ThemeContextValue = {
  theme: AppTheme;
  paletteId: PaletteId;
  selectPalette: (paletteId: PaletteId) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemColorScheme = useColorScheme();
  const [paletteId, setPaletteId] = useState<PaletteId>('turquoise');
  const hasSelectedPalette = useRef(false);

  useEffect(() => {
    let mounted = true;

    AsyncStorage.getItem(PALETTE_STORAGE_KEY)
      .then((storedPalette) => {
        if (mounted && !hasSelectedPalette.current && isPaletteId(storedPalette)) {
          setPaletteId(storedPalette);
        }
      })
      .catch((error: unknown) => {
        devWarn('No se pudo leer la paleta guardada.', error);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const selectPalette = useCallback((nextPalette: PaletteId) => {
    hasSelectedPalette.current = true;
    setPaletteId(nextPalette);
    AsyncStorage.setItem(PALETTE_STORAGE_KEY, nextPalette).catch((error: unknown) => {
      if (__DEV__) devWarn('No se pudo guardar la paleta; se conservará en esta sesión.', error);
    });
  }, []);

  const theme = useMemo(
    () => resolveTheme(paletteId, systemColorScheme === 'dark' ? 'dark' : 'light'),
    [paletteId, systemColorScheme],
  );

  const value = useMemo(
    () => ({ theme, paletteId, selectPalette }),
    [theme, paletteId, selectPalette],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useAppTheme debe usarse dentro de ThemeProvider.');
  return context;
}
