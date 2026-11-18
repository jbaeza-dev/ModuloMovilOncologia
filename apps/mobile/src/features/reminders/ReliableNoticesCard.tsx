import { Linking, Platform, Text, View } from 'react-native';

import { BodyText, InfoCard, SectionTitle, VisualButton } from '../../components/Visual';
import { useAppTheme } from '../../providers/ThemeProvider';
import { theme } from '../../theme';

/**
 * Marcas cuyo ahorro de batería cierra apps en segundo plano y puede borrar sus alarmas.
 * En un Redmi 13C (HyperOS) se comprobó que, con la app «Sin restricciones» y con inicio
 * automático, los avisos llegan aunque el sistema cierre la app (prueba 6a′ del Anexo D).
 */
const AGGRESSIVE_BATTERY_BRANDS =
  /xiaomi|redmi|poco|huawei|honor|oppo|vivo|realme|oneplus|meizu|asus|samsung/i;

export function needsBatteryGuide(manufacturer: string | null | undefined): boolean {
  return !!manufacturer && AGGRESSIVE_BATTERY_BRANDS.test(manufacturer);
}

export function deviceManufacturer(): string {
  if (Platform.OS !== 'android') return '';
  const constants = Platform.constants as { Manufacturer?: string; Brand?: string };
  return [constants.Manufacturer, constants.Brand].filter(Boolean).join(' ');
}

/**
 * Explica cómo evitar que el ahorro de batería del teléfono impida los avisos y abre los ajustes
 * de QuimioCare. Con `onlyWhenNeeded` se muestra solo en marcas con ahorro de batería agresivo.
 */
export function ReliableNoticesCard({
  onlyWhenNeeded = false,
  manufacturer = deviceManufacturer(),
}: {
  onlyWhenNeeded?: boolean;
  /** Para pruebas; por defecto se lee del teléfono. */
  manufacturer?: string;
}) {
  const { theme: appTheme } = useAppTheme();
  if (Platform.OS !== 'android') return null;
  if (onlyWhenNeeded && !needsBatteryGuide(manufacturer)) return null;
  const step = { color: appTheme.colors.text, fontSize: 16, lineHeight: 24 } as const;
  return (
    <InfoCard>
      <SectionTitle>Para que tus avisos lleguen siempre</SectionTitle>
      <BodyText>
        Algunos teléfonos, como Xiaomi, Redmi o POCO, cierran las apps para ahorrar batería y los
        avisos pueden no llegar. Para evitarlo:
      </BodyText>
      <View accessibilityRole="list" style={{ gap: theme.spacing.xs }}>
        <Text style={step}>
          1. En los ajustes de QuimioCare, entra a «Ahorro de batería» y elige «Sin restricciones».
        </Text>
        <Text style={step}>
          2. Activa el inicio automático de QuimioCare. En Xiaomi está en Ajustes → Apps → Permisos
          → «Autoencendido en segundo plano».
        </Text>
      </View>
      <VisualButton
        label="Abrir ajustes de QuimioCare"
        secondary
        onPress={() => {
          void Linking.openSettings();
        }}
      />
      <BodyText>Si tu teléfono no tiene estas opciones, no necesitas cambiar nada.</BodyText>
    </InfoCard>
  );
}
