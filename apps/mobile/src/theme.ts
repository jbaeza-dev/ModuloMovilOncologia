export const typography = {
  screenTitle: {
    fontFamily: 'NunitoSans-Bold',
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800' as const,
  },
  sectionTitle: {
    fontFamily: 'NunitoSans-Bold',
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700' as const,
  },
  body: {
    fontFamily: 'NunitoSans-Regular',
    fontSize: 16,
    lineHeight: 24,
  },
  label: {
    fontFamily: 'NunitoSans-SemiBold',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600' as const,
  },
  editableValue: {
    fontFamily: 'NunitoSans-Regular',
    fontSize: 18,
    lineHeight: 24,
  },
  button: {
    fontFamily: 'NunitoSans-Bold',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700' as const,
  },
  helper: {
    fontFamily: 'NunitoSans-Regular',
    fontSize: 14,
    lineHeight: 20,
  },
} as const;

export const theme = {
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { sm: 12, md: 20 },
  typography,
} as const;

export const PALETTE_OPTIONS = [
  {
    id: 'turquoise',
    label: 'Turquesa',
    light: '#006A70',
    dark: '#82D9CD',
    lightContainer: '#D9EFEA',
    darkContainer: '#1E3E44',
    onLightContainer: '#06444A',
    onDarkContainer: '#E2F7F4',
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
    surfaceRaised: string;
    mutedSurface: string;
    border: string;
    cardBorder: string;
    inputBorder: string;
    inputBorderFocused: string;
    text: string;
    secondary: string;
    heading: string;
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
      background: isDark ? '#0E1C20' : '#FFF7E7',
      surface: isDark ? '#172C32' : '#FFFFFF',
      surfaceRaised: isDark ? '#1D353C' : '#FFFDF8',
      mutedSurface: isDark ? '#13252A' : '#F3EFE4',
      border: isDark ? '#7FA8A2' : '#5C746C',
      cardBorder: isDark ? '#7FA8A2' : '#5C746C',
      inputBorder: isDark ? '#7FA8A2' : '#5C746C',
      inputBorderFocused: isDark ? palette.dark : palette.light,
      text: isDark ? '#EDF5EF' : '#173940',
      secondary: isDark ? '#BDD0CA' : '#3F5957',
      heading: isDark ? '#82D9CD' : '#064E55',
      inverse: isDark ? '#0E1C20' : '#FFFFFF',
      pressed: isDark ? '#23444D' : '#E8DFCC',
      primary: isDark ? palette.dark : palette.light,
      onPrimary: isDark ? '#0E1C20' : '#FFFFFF',
      primaryContainer: isDark ? palette.darkContainer : palette.lightContainer,
      onPrimaryContainer: isDark ? palette.onDarkContainer : palette.onLightContainer,
      success: isDark ? '#81C784' : '#1E5E46',
      warning: isDark ? '#FFCC80' : '#8D5700',
      warningContainer: isDark ? '#3A2D1F' : '#FEF3C7',
      onWarningContainer: isDark ? '#FFE2B8' : '#5A3600',
      error: isDark ? '#EF9A9A' : '#9B2628',
      onError: isDark ? '#202020' : '#FFFFFF',
      errorContainer: isDark ? '#3E1C1A' : '#FDECEC',
      onErrorContainer: isDark ? '#FFCDD2' : '#9B2628',
    },
  };
}
