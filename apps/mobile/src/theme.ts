export const typography = {
  screenTitle: { fontSize: 28, lineHeight: 34, fontWeight: '700' as const },
  sectionTitle: { fontSize: 20, lineHeight: 26, fontWeight: '700' as const },
  body: { fontSize: 16, lineHeight: 24 },
  label: { fontSize: 16, lineHeight: 22, fontWeight: '600' as const },
  editableValue: { fontSize: 18, lineHeight: 24 },
  button: { fontSize: 16, lineHeight: 22, fontWeight: '700' as const },
  helper: { fontSize: 14, lineHeight: 20 },
} as const;

export const theme = {
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { sm: 12, md: 18 },
  typography,
} as const;

export const PALETTE_OPTIONS = [
  {
    id: 'turquoise',
    label: 'Turquesa',
    light: '#00695C',
    dark: '#80CBC4',
    lightContainer: '#E0F2EF',
    darkContainer: '#263533',
    onLightContainer: '#183B36',
    onDarkContainer: '#D9F5F0',
  },
  {
    id: 'blue',
    label: 'Azul',
    light: '#0D47A1',
    dark: '#90CAF9',
    lightContainer: '#E8F0FE',
    darkContainer: '#253246',
    onLightContainer: '#17304F',
    onDarkContainer: '#D8E6FF',
  },
  {
    id: 'violet',
    label: 'Violeta',
    light: '#6A1B9A',
    dark: '#CE93D8',
    lightContainer: '#F3E5F5',
    darkContainer: '#33263A',
    onLightContainer: '#3F1B46',
    onDarkContainer: '#F1D7F8',
  },
  {
    id: 'amber',
    label: 'Ámbar',
    light: '#8D3B00',
    dark: '#FFB74D',
    lightContainer: '#FFF3E0',
    darkContainer: '#3A2D1F',
    onLightContainer: '#4F2A05',
    onDarkContainer: '#FFE2B8',
  },
] as const;

export type PaletteId = (typeof PALETTE_OPTIONS)[number]['id'];
export type ColorScheme = 'light' | 'dark';

export type AppTheme = typeof theme & {
  colorScheme: ColorScheme;
  paletteId: PaletteId;
  colors: {
    background: string;
    surface: string;
    mutedSurface: string;
    border: string;
    inputBorder: string;
    inputBorderFocused: string;
    text: string;
    secondary: string;
    inverse: string;
    pressed: string;
    primary: string;
    onPrimary: string;
    primaryContainer: string;
    onPrimaryContainer: string;
    success: string;
    warning: string;
    warningContainer: string;
    onWarningContainer: string;
    error: string;
    onError: string;
    errorContainer: string;
    onErrorContainer: string;
  };
};

export function isPaletteId(value: string | null): value is PaletteId {
  return PALETTE_OPTIONS.some((palette) => palette.id === value);
}

export function resolveTheme(paletteId: PaletteId, colorScheme: ColorScheme): AppTheme {
  const palette = PALETTE_OPTIONS.find((option) => option.id === paletteId) ?? PALETTE_OPTIONS[0];
  const isDark = colorScheme === 'dark';

  return {
    ...theme,
    paletteId: palette.id,
    colorScheme,
    colors: {
      background: isDark ? '#121212' : '#FFFFFF',
      surface: isDark ? '#1E1E1E' : '#F3F3F3',
      mutedSurface: isDark ? '#2A2A2A' : '#E8E8E8',
      border: isDark ? '#484848' : '#D6D6D6',
      inputBorder: isDark ? '#757575' : '#767676',
      inputBorderFocused: isDark ? palette.dark : palette.light,
      text: isDark ? '#F5F5F5' : '#202020',
      secondary: isDark ? '#C2C2C2' : '#595959',
      inverse: isDark ? '#121212' : '#FFFFFF',
      pressed: isDark ? '#383838' : '#E0E0E0',
      primary: isDark ? palette.dark : palette.light,
      onPrimary: isDark ? '#202020' : '#FFFFFF',
      primaryContainer: isDark ? palette.darkContainer : palette.lightContainer,
      onPrimaryContainer: isDark ? palette.onDarkContainer : palette.onLightContainer,
      success: isDark ? '#81C784' : '#2E7D32',
      warning: isDark ? '#FFCC80' : '#8D5700',
      warningContainer: isDark ? '#3A2D1F' : '#FEF3C7',
      onWarningContainer: isDark ? '#FFE2B8' : '#5A3600',
      error: isDark ? '#EF9A9A' : '#B3261E',
      onError: isDark ? '#202020' : '#FFFFFF',
      errorContainer: isDark ? '#3E1C1A' : '#FDE8E8',
      onErrorContainer: isDark ? '#FFCDD2' : '#8A1C14',
    },
  };
}
