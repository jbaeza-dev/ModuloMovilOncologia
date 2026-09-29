import Feather from '@expo/vector-icons/Feather';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { NavigationCard } from '../../components/NavigationCard';
import { Screen } from '../../components/Screen';
import {
  BodyText,
  DemoBadge,
  DetailRow,
  InfoCard,
  SectionTitle,
  StatusPill,
  VisualButton,
} from '../../components/Visual';
import {
  formatDate,
  type LinkCodeRecord,
  type PatientProfileRecord,
  type TreatmentRecord,
} from '../../data/local/repository';
import { useFocusedValue } from '../../data/local/use-local-query';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { PALETTE_OPTIONS, theme } from '../../theme';

export function ProfileScreen() {
  const styles = useStyles();
  const { repository } = useLocalData();
  const load = useCallback(
    () => (repository ? repository.profile() : Promise.resolve(null)),
    [repository],
  );
  const { value: profile } = useFocusedValue(load, null as PatientProfileRecord | null);

  return (
    <Screen title="Mi perfil" backTo="/">
      <InfoCard>
        <Text style={styles.heading}>{profile?.nombre ?? 'Paciente en tratamiento'}</Text>
        <BodyText>{profile?.email ?? 'paciente@quimiocare.test'}</BodyText>
        <StatusPill>Disponible sin conexión</StatusPill>
      </InfoCard>
      <NavigationCard
        title="Datos personales"
        description="Información y antecedentes del paciente."
        icon="user"
        href="/perfil/datos"
      />
      <NavigationCard
        title="Perfil clínico"
        description="Información de quimioterapia y equipo médico."
        icon="file-text"
        href="/perfil/clinico"
      />
      <NavigationCard
        title="Código de vinculación"
        description="Código para compartir con tu equipo de salud."
        icon="link"
        href="/perfil/vinculacion"
      />
      <NavigationCard
        title="Consentimientos"
        description="Vista de los textos de ejemplo."
        icon="check-square"
        href="/perfil/consentimientos"
      />
      <NavigationCard
        title="Preferencias"
        description="Presentación de avisos y apariencia."
        icon="settings"
        href="/perfil/preferencias"
      />
    </Screen>
  );
}

export function PersonalDataScreen() {
  const { repository } = useLocalData();
  const load = useCallback(
    () => (repository ? repository.profile() : Promise.resolve(null)),
    [repository],
  );
  const { value: profile, loading } = useFocusedValue(load, null as PatientProfileRecord | null);

  return (
    <Screen title="Datos personales" backTo="/perfil">
      <InfoCard>
        <DetailRow
          label="Nombre"
          value={profile?.nombre ?? (loading ? 'Cargando…' : 'Sin registro')}
        />
        <DetailRow label="RUT" value={profile?.rut ?? (loading ? 'Cargando…' : 'Sin registro')} />
        <DetailRow
          label="Correo"
          value={profile?.email ?? (loading ? 'Cargando…' : 'Sin registro')}
        />
        <DetailRow
          label="Teléfono"
          value={profile?.telefono ?? (loading ? 'Cargando…' : 'Sin registro')}
        />
        <DetailRow
          label="Fecha de nacimiento"
          value={profile?.fecha_nacimiento ?? (loading ? 'Cargando…' : 'Sin registro')}
        />
        <DetailRow
          label="Ciudad"
          value={profile?.ciudad ?? (loading ? 'Cargando…' : 'Sin registro')}
        />
      </InfoCard>
      <BodyText>
        Información del paciente guardada en este dispositivo para consulta sin conexión.
      </BodyText>
    </Screen>
  );
}

export function ClinicalProfileScreen() {
  const styles = useStyles();
  const { theme: appTheme } = useAppTheme();
  const { repository } = useLocalData();
  const load = useCallback(
    () => (repository ? repository.treatment() : Promise.resolve(null)),
    [repository],
  );
  const { value: treatment, loading } = useFocusedValue(load, null as TreatmentRecord | null);
  const [open, setOpen] = useState<string | null>('Detalle farmacológico');

  const params = treatment?.parametros_json
    ? (JSON.parse(treatment.parametros_json) as {
        drogas?: string[];
        frecuencia?: string;
        observaciones?: string;
      })
    : null;

  return (
    <Screen title="Perfil clínico" backTo="/perfil">
      <InfoCard>
        <SectionTitle>Tratamiento de quimioterapia</SectionTitle>
        <DetailRow
          label="Esquema"
          value={treatment?.nombre ?? (loading ? 'Cargando…' : 'Sin tratamiento asignado')}
        />
        <DetailRow
          label="Equipo tratante"
          value={treatment?.equipo_tratante ?? (loading ? 'Cargando…' : 'Sin asignar')}
        />
        <DetailRow
          label="Ciclo actual"
          value={
            treatment?.ciclo_actual != null && treatment?.total_ciclos != null
              ? `Ciclo ${treatment.ciclo_actual} de ${treatment.total_ciclos}`
              : 'En curso'
          }
        />
        <DetailRow label="Inicio" value={treatment?.fecha_inicio ?? 'Sin fecha'} />
        <DetailRow label="Término estimado" value={treatment?.fecha_termino ?? 'En evaluación'} />
        <DetailRow label="Estado" value={treatment?.estado ?? 'activo'} />
      </InfoCard>

      {params ? (
        <InfoCard>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Detalle farmacológico"
            accessibilityState={{ expanded: open === 'Detalle farmacológico' }}
            onPress={() =>
              setOpen(open === 'Detalle farmacológico' ? null : 'Detalle farmacológico')
            }
            style={styles.disclosure}
          >
            <Text style={styles.heading}>Detalle farmacológico</Text>
            <Feather
              name={open === 'Detalle farmacológico' ? 'chevron-up' : 'chevron-down'}
              size={22}
              color={appTheme.colors.text}
            />
          </Pressable>
          {open === 'Detalle farmacológico' ? (
            <>
              {params.drogas ? (
                <DetailRow label="Fármacos" value={params.drogas.join(', ')} />
              ) : null}
              {params.frecuencia ? (
                <DetailRow label="Frecuencia" value={params.frecuencia} />
              ) : null}
              {params.observaciones ? (
                <DetailRow label="Monitoreo" value={params.observaciones} />
              ) : null}
            </>
          ) : null}
        </InfoCard>
      ) : null}

      <BodyText>
        Información de tratamiento disponible sin conexión. No realiza evaluación clínica
        automática.
      </BodyText>
    </Screen>
  );
}

export function LinkCodeScreen() {
  const styles = useStyles();
  const { repository, runSave, saving } = useLocalData();
  const load = useCallback(
    () => (repository ? repository.linkCode() : Promise.resolve(null)),
    [repository],
  );
  const {
    value: linkCode,
    loading,
    refresh,
  } = useFocusedValue(load, null as LinkCodeRecord | null);

  const [generating, setGenerating] = useState(false);
  const busy = generating || saving;

  async function handleRefreshCode() {
    if (busy || !repository) return;
    setGenerating(true);
    try {
      await runSave(() => repository.generateOrRefreshLinkCode());
      refresh();
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Screen title="Código de vinculación" backTo="/perfil">
      <InfoCard>
        <SectionTitle>Comparte este código</SectionTitle>
        <Text style={styles.code}>{linkCode?.codigo ?? (loading ? '…' : '--- ---')}</Text>
        <StatusPill>
          {linkCode ? `Válido hasta ${formatDate(linkCode.expira_en)}` : 'Sin código'}
        </StatusPill>
        <BodyText>
          Compártelo únicamente con tu equipo de salud. Este código se conserva en este dispositivo
          para consulta sin conexión.
        </BodyText>
        <VisualButton
          label={busy ? 'Generando…' : 'Generar nuevo código'}
          secondary
          disabled={busy || !repository}
          onPress={() => void handleRefreshCode()}
        />
      </InfoCard>
    </Screen>
  );
}

export function PreferencesScreen() {
  const styles = useStyles();
  const { theme: appTheme, paletteId, selectPalette } = useAppTheme();
  const [notices, setNotices] = useState(true);
  return (
    <Screen title="Preferencias" backTo="/perfil">
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
        <SectionTitle>Avisos</SectionTitle>
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel="Mostrar avisos"
          accessibilityState={{ checked: notices }}
          onPress={() => setNotices(!notices)}
          style={styles.disclosure}
        >
          <Text style={styles.heading}>Mostrar avisos</Text>
          <Feather
            name={notices ? 'toggle-right' : 'toggle-left'}
            size={28}
            color={appTheme.colors.text}
          />
        </Pressable>
        <BodyText>
          Control de presentación. La preferencia no se guarda ni activa notificaciones.
        </BodyText>
      </InfoCard>
      <InfoCard>
        <SectionTitle>Cuenta y seguridad</SectionTitle>
        <BodyText>La gestión de la cuenta se incorporará con el flujo de identidad.</BodyText>
      </InfoCard>
    </Screen>
  );
}

export function ConsentReviewScreen() {
  return (
    <Screen title="Consentimientos" backTo="/perfil">
      <DemoBadge />
      <InfoCard>
        <SectionTitle>Consentimiento de ejemplo</SectionTitle>
        <BodyText>
          Este texto ilustra la presentación de consentimientos. El contenido legal y clínico debe
          aprobarse antes de su uso.
        </BodyText>
      </InfoCard>
      <BodyText>No se registra aceptación en esta vista.</BodyText>
    </Screen>
  );
}

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
