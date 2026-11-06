import * as Notifications from 'expo-notifications';
import { AppIcon as Feather } from '../../components/AppIcon';
import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ConfirmLogoutButton } from '../../components/ConfirmLogoutButton';
import { NavigationCard } from '../../components/NavigationCard';
import { Screen } from '../../components/Screen';
import { BodyText, DemoBadge, InfoCard, SectionTitle, VisualButton } from '../../components/Visual';
import { useFocusedValue } from '../../hooks/use-local-query';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { PALETTE_OPTIONS, theme } from '../../theme';
import { isDemoMode } from '../../utils/environment';

export { ProfileScreen, PersonalDataScreen, ClinicalProfileScreen } from './IdentityProfileScreens';

export { LinkCodeScreen } from './LinkCodeScreen';

export function PreferencesScreen() {
  const styles = useStyles();
  const {
    repository,
    coordinator,
    patientId,
    reconcileReminders,
    bumpRemindersRevision,
    trackOperation,
    closeActiveContext,
    isClosing,
  } = useLocalData();
  const { theme: appTheme, paletteId, selectPalette } = useAppTheme();

  const loadPrefs = useCallback(
    () =>
      repository
        ? repository.reminders.getPreferences()
        : Promise.resolve({ enabled: false, updatedAt: null }),
    [repository],
  );
  const { value: prefs, refresh: refreshPrefs } = useFocusedValue(loadPrefs, {
    enabled: false,
    updatedAt: null,
  });

  const toggleNotices = async () => {
    if (!repository) return;
    const nextVal = !prefs.enabled;
    await trackOperation(async () => {
      await repository.reminders.setPreferences(nextVal);
      bumpRemindersRevision?.();
      if (!nextVal) {
        if (typeof Notifications?.cancelAllScheduledNotificationsAsync === 'function') {
          await Notifications.cancelAllScheduledNotificationsAsync().catch(() => undefined);
        }
      }
      if (patientId) {
        if (reconcileReminders) {
          await reconcileReminders(patientId);
        } else if (coordinator) {
          await coordinator.reconcile(patientId, () => true);
        }
      }
    });
    await refreshPrefs();
  };

  return (
    <Screen mascotPose="lectura" title="Preferencias">
      <DemoBadge />
      <InfoCard>
        <SectionTitle>Accesibilidad y apariencia</SectionTitle>
        <BodyText>
          El modo claro u oscuro sigue el ajuste de tu dispositivo. El color principal se guarda en
          este dispositivo.
        </BodyText>
        <View accessibilityRole="radiogroup" accessibilityLabel="Color principal">
          {PALETTE_OPTIONS.map((palette) => {
            const selected = paletteId === palette.id;
            const swatchColor = appTheme.colorScheme === 'dark' ? palette.dark : palette.light;

            return (
              <Pressable
                key={palette.id}
                accessibilityRole="radio"
                accessibilityLabel={`Color principal ${palette.label}`}
                accessibilityState={{ selected }}
                accessibilityHint="Cambia el color principal de la aplicación."
                onPress={() => selectPalette(palette.id)}
                style={[styles.paletteOption, selected && styles.paletteOptionSelected]}
              >
                <View style={[styles.paletteSwatch, { backgroundColor: swatchColor }]} />
                <Text style={styles.heading}>{palette.label}</Text>
                <Feather
                  name={selected ? 'check-circle' : 'circle'}
                  size={22}
                  color={selected ? appTheme.colors.primary : appTheme.colors.secondary}
                  accessible={false}
                />
              </Pressable>
            );
          })}
        </View>
      </InfoCard>
      <InfoCard>
        <SectionTitle>Avisos y recordatorios</SectionTitle>
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel="Habilitar avisos"
          accessibilityState={{ checked: prefs.enabled }}
          onPress={toggleNotices}
          style={styles.disclosure}
        >
          <Text style={styles.heading}>Habilitar avisos</Text>
          <Feather
            name={prefs.enabled ? 'toggle-right' : 'toggle-left'}
            size={28}
            color={appTheme.colors.text}
          />
        </Pressable>
        <BodyText>
          {prefs.enabled
            ? 'Tus avisos están activados en este teléfono.'
            : 'Todos tus avisos están pausados. Tus horarios guardados se conservan.'}
        </BodyText>
      </InfoCard>
      <NavigationCard
        title="Configurar recordatorios"
        description="Gestiona horarios y reglas para signos vitales y medicación."
        icon="clock"
        href="/recordatorios"
      />
      <NavigationCard
        title="Bandeja de avisos"
        description="Consulta tus avisos y los recordatorios recibidos."
        icon="bell"
        href="/avisos"
      />
      <NavigationCard
        title="Términos y consentimiento"
        icon="shield"
        href="/perfil/consentimientos"
        compact
      />
      <InfoCard>
        <SectionTitle>Cuenta y seguridad</SectionTitle>
        <BodyText>
          {isDemoMode()
            ? 'Acceso al simulador con datos sintéticos. Puedes cambiar de paciente o cerrar sesión conservando sus capturas.'
            : 'Consulta el estado de tu sesión y los dispositivos asociados a tu cuenta.'}
        </BodyText>
        {isDemoMode() ? (
          <VisualButton
            label={isClosing ? 'Cerrando contexto…' : 'Cambiar paciente de prueba'}
            secondary
            disabled={isClosing}
            onPress={() => void closeActiveContext('change_patient')}
          />
        ) : null}
        <NavigationCard title="Sesión y dispositivos" icon="shield" href="/perfil/sesion" compact />
        <ConfirmLogoutButton />
      </InfoCard>
    </Screen>
  );
}

export { MedicationScreen } from './MedicationScreen';
export { MedicalTeamScreen } from './MedicalTeamScreen';
export { ConsentReviewScreen } from './ConsentReviewScreen';

function useStyles() {
  const { theme: appTheme } = useAppTheme();
  const colors = appTheme.colors;
  return StyleSheet.create({
    heading: { flex: 1, fontSize: 18, fontWeight: '700', color: colors.text },
    disclosure: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: theme.spacing.sm,
    },
    code: {
      fontSize: 34,
      fontWeight: '700',
      letterSpacing: 5,
      color: colors.text,
      textAlign: 'center',
      paddingVertical: theme.spacing.md,
    },
    paletteOption: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      paddingHorizontal: theme.spacing.sm,
      borderWidth: 2,
      borderColor: 'transparent',
      borderRadius: theme.radius.sm,
    },
    paletteOptionSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.primaryContainer,
    },
    paletteSwatch: { width: 28, height: 28, borderRadius: 14 },
  });
}
