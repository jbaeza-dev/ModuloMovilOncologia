import {
  Image,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useAppTheme } from '../providers/ThemeProvider';
import { theme } from '../theme';

export const MASCOT_POSES = [
  'saludo',
  'apoyo',
  'registro',
  'explicacion',
  'lectura',
  'reposo',
  'recordatorio',
  'resumen',
  'confirmacion',
] as const;

export type MascotPose = (typeof MASCOT_POSES)[number];

export type MascotSize = 'xs' | 'sm' | 'md' | 'lg' | 'hero';

/* eslint-disable @typescript-eslint/no-require-imports */
const MASCOT_LIGHT_SOURCES: Record<MascotPose, ImageSourcePropType> = {
  saludo: require('../../assets/mascot/light/saludo.png'),
  apoyo: require('../../assets/mascot/light/apoyo.png'),
  registro: require('../../assets/mascot/light/registro.png'),
  explicacion: require('../../assets/mascot/light/explicacion.png'),
  lectura: require('../../assets/mascot/light/lectura.png'),
  reposo: require('../../assets/mascot/light/reposo.png'),
  recordatorio: require('../../assets/mascot/light/recordatorio.png'),
  resumen: require('../../assets/mascot/light/resumen.png'),
  confirmacion: require('../../assets/mascot/light/confirmacion.png'),
};

const MASCOT_DARK_SOURCES: Record<MascotPose, ImageSourcePropType> = {
  saludo: require('../../assets/mascot/dark/saludo.png'),
  apoyo: require('../../assets/mascot/dark/apoyo.png'),
  registro: require('../../assets/mascot/dark/registro.png'),
  explicacion: require('../../assets/mascot/dark/explicacion.png'),
  lectura: require('../../assets/mascot/dark/lectura.png'),
  reposo: require('../../assets/mascot/dark/reposo.png'),
  recordatorio: require('../../assets/mascot/dark/recordatorio.png'),
  resumen: require('../../assets/mascot/dark/resumen.png'),
  confirmacion: require('../../assets/mascot/dark/confirmacion.png'),
};

export const BRAND_SYMBOL_LIGHT: ImageSourcePropType = require('../../assets/mascot/simbolo-color-512.png');
export const BRAND_SYMBOL_DARK: ImageSourcePropType = require('../../assets/mascot/simbolo-fondo-oscuro-512.png');
/* eslint-enable @typescript-eslint/no-require-imports */

const SIZE_MAP: Record<MascotSize, number> = {
  xs: 40,
  sm: 56,
  md: 72,
  lg: 92,
  hero: 108,
};

export interface MascotAvatarProps {
  pose: MascotPose;
  size?: MascotSize | number;
  /**
   * Por defecto es decorativo (`accessible={false}`, `importantForAccessibility="no-hide-descendants"`).
   * Si transmite un estado que no está expresado en el texto adyacente, pasar `accessibilityLabel`.
   */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  framed?: boolean;
}

export function MascotAvatar({
  pose,
  size = 'md',
  accessibilityLabel,
  style,
  testID,
  framed = true,
}: MascotAvatarProps) {
  const { theme: appTheme } = useAppTheme();
  const { fontScale } = useWindowDimensions();
  const isDark = appTheme.colorScheme === 'dark';

  const baseDimension = typeof size === 'number' ? size : SIZE_MAP[size];
  const dimension =
    fontScale >= 1.2 && baseDimension >= 72 ? Math.round(baseDimension * 0.78) : baseDimension;

  const source = isDark ? MASCOT_DARK_SOURCES[pose] : MASCOT_LIGHT_SOURCES[pose];
  const isAccessible = Boolean(accessibilityLabel && accessibilityLabel.trim().length > 0);

  return (
    <View
      testID={testID ?? `mascot-avatar-${pose}`}
      accessible={isAccessible}
      accessibilityRole={isAccessible ? 'image' : undefined}
      accessibilityLabel={isAccessible ? accessibilityLabel : undefined}
      importantForAccessibility={isAccessible ? 'yes' : 'no-hide-descendants'}
      style={[
        styles.avatarContainer,
        {
          width: dimension,
          height: dimension,
          borderRadius: Math.round(dimension * 0.28),
          backgroundColor: appTheme.colors.surfaceRaised ?? appTheme.colors.surface,
          borderColor: appTheme.colors.cardBorder ?? appTheme.colors.border,
        },
        style,
        !framed && { backgroundColor: 'transparent', borderWidth: 0 },
      ]}
    >
      <Image
        source={source}
        resizeMode="contain"
        accessible={false}
        style={{
          width: Math.round(dimension * 0.86),
          height: Math.round(dimension * 0.86),
        }}
      />
    </View>
  );
}

export interface MascotHeroProps {
  pose: MascotPose;
  eyebrow?: string;
  title: string;
  description?: string;
  compact?: boolean;
  centered?: boolean;
  testID?: string;
}

export function MascotHero({
  pose,
  eyebrow,
  title,
  description,
  compact = false,
  centered = false,
  testID,
}: MascotHeroProps) {
  const { theme: appTheme } = useAppTheme();
  const isCentered = centered && !compact;

  return (
    <View
      testID={testID ?? `mascot-hero-${pose}`}
      style={[
        styles.heroCard,
        compact ? styles.heroRow : isCentered ? styles.heroCentered : styles.heroRow,
        {
          backgroundColor: appTheme.colors.surface,
          borderColor: appTheme.colors.cardBorder ?? appTheme.colors.border,
        },
      ]}
    >
      <MascotAvatar pose={pose} size={compact ? 'md' : isCentered ? 'hero' : 'lg'} framed={false} />
      <View style={[styles.heroCopy, isCentered && styles.heroCopyCentered]}>
        {eyebrow ? (
          <Text
            style={[
              styles.eyebrow,
              { color: appTheme.colors.primary },
              isCentered && styles.textCentered,
            ]}
          >
            {eyebrow}
          </Text>
        ) : null}
        <Text
          accessibilityRole="header"
          style={[
            compact ? styles.compactTitle : styles.heroTitle,
            { color: appTheme.colors.heading ?? appTheme.colors.text },
            isCentered && styles.textCentered,
          ]}
        >
          {title}
        </Text>
        {description ? (
          <Text
            style={[
              styles.heroDescription,
              { color: appTheme.colors.secondary },
              isCentered && styles.textCentered,
            ]}
          >
            {description}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  avatarContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    overflow: 'hidden',
    flexShrink: 0,
  },
  heroCard: {
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1.5,
    gap: theme.spacing.md,
  },
  heroRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
  },
  heroCentered: {
    flexDirection: 'column',
    alignItems: 'center',
  },
  heroCopy: {
    flex: 1,
    gap: 4,
  },
  heroCopyCentered: {
    alignItems: 'center',
    flex: 0,
  },
  eyebrow: {
    fontFamily: 'NunitoSans-Bold',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  heroTitle: {
    ...theme.typography.screenTitle,
    fontSize: 24,
    lineHeight: 30,
  },
  compactTitle: {
    ...theme.typography.sectionTitle,
    fontSize: 22,
    lineHeight: 28,
  },
  heroDescription: {
    ...theme.typography.body,
    fontSize: 15,
    lineHeight: 22,
  },
  textCentered: {
    textAlign: 'center',
  },
});
