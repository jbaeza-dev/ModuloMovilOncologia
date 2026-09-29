import Feather from '@expo/vector-icons/Feather';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { NavigationCard } from '../../components/NavigationCard';
import { Screen } from '../../components/Screen';
import {
  BodyText,
  DemoBadge,
  DetailRow,
  EmptyState,
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
  const {
    value: profile,
    loading,
    error,
    refresh,
  } = useFocusedValue(load, null as PatientProfileRecord | null);

  return (
    <Screen title="Mi perfil" backTo="/">
      {loading ? (
        <InfoCard>
          <BodyText>Cargando perfil…</BodyText>
        </InfoCard>
      ) : error ? (
        <InfoCard>
          <Text style={styles.heading}>Error al cargar perfil</Text>
          <BodyText>No se pudo consultar el almacenamiento local.</BodyText>
          <VisualButton label="Reintentar" onPress={refresh} />
        </InfoCard>
      ) : !profile ? (
        <InfoCard>
          <Text style={styles.heading}>Sin perfil asignado</Text>
          <BodyText>No hay datos registrados para este paciente.</BodyText>
        </InfoCard>
      ) : (
        <InfoCard>
          <Text style={styles.heading}>{profile.nombre}</Text>
          <BodyText>{profile.email ?? 'Sin correo registrado'}</BodyText>
          <StatusPill>Disponible sin conexión</StatusPill>
        </InfoCard>
      )}
      <NavigationCard
        title="Datos personales"
        description="Información y antecedentes del paciente."
        icon="user"
        href="/perfil/datos"
      />
      <NavigationCard
        title="Perfil clínico"
        description="Información de quimioterapia."
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
  const {
    value: profile,
    loading,
    error,
    refresh,
  } = useFocusedValue(load, null as PatientProfileRecord | null);

  return (
    <Screen title="Datos personales" backTo="/perfil">
      {loading ? (
        <InfoCard>
          <BodyText>Cargando información del paciente…</BodyText>
        </InfoCard>
      ) : error ? (
        <InfoCard>
          <BodyText>No se pudo cargar la información del paciente.</BodyText>
          <VisualButton label="Reintentar" onPress={refresh} />
        </InfoCard>
      ) : !profile ? (
        <EmptyState
          icon="user"
          title="Sin datos registrados"
          description="No hay información de perfil disponible para este paciente."
        />
      ) : (
        <InfoCard>
          <DetailRow label="Nombre" value={profile.nombre} />
          <DetailRow label="RUT" value={profile.rut ?? 'Sin registro'} />
          <DetailRow label="Correo" value={profile.email ?? 'Sin registro'} />
        </InfoCard>
      )}
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
  const {
    value: treatment,
    loading,
    error,
    refresh,
  } = useFocusedValue(load, null as TreatmentRecord | null);
  const [open, setOpen] = useState<string | null>('Parámetros de tratamiento');

  const params = treatment?.parametros_json
    ? (JSON.parse(treatment.parametros_json) as {
        ciclo_actual?: number;
        total_ciclos?: number;
        observaciones?: string;
      })
    : null;

  return (
    <Screen title="Perfil clínico" backTo="/perfil">
      {loading ? (
        <InfoCard>
          <BodyText>Cargando tratamiento…</BodyText>
        </InfoCard>
      ) : error ? (
        <InfoCard>
          <BodyText>No se pudo consultar el tratamiento local.</BodyText>
          <VisualButton label="Reintentar" onPress={refresh} />
        </InfoCard>
      ) : !treatment ? (
        <EmptyState
          icon="file-text"
          title="Sin tratamiento registrado"
          description="No se encontró un esquema de quimioterapia para este paciente."
        />
      ) : (
        <>
          <InfoCard>
            <SectionTitle>Tratamiento de quimioterapia</SectionTitle>
            <DetailRow
              label="Tratamiento"
              value={treatment.nombre ?? 'Tratamiento de quimioterapia'}
            />
            {params?.ciclo_actual != null && params?.total_ciclos != null ? (
              <DetailRow
                label="Ciclo actual"
                value={`Ciclo ${params.ciclo_actual} de ${params.total_ciclos}`}
              />
            ) : null}
            <DetailRow label="Inicio" value={treatment.fecha_inicio ?? 'Sin fecha'} />
            <DetailRow label="Término estimado" value={treatment.fecha_termino ?? 'En curso'} />
            <DetailRow label="Estado" value={treatment.estado} />
          </InfoCard>

          {params?.observaciones ? (
            <InfoCard>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Parámetros de tratamiento"
                accessibilityState={{ expanded: open === 'Parámetros de tratamiento' }}
                onPress={() =>
                  setOpen(open === 'Parámetros de tratamiento' ? null : 'Parámetros de tratamiento')
                }
                style={styles.disclosure}
              >
                <Text style={styles.heading}>Parámetros de tratamiento</Text>
                <Feather
                  name={open === 'Parámetros de tratamiento' ? 'chevron-up' : 'chevron-down'}
                  size={22}
                  color={appTheme.colors.text}
                />
              </Pressable>
              {open === 'Parámetros de tratamiento' ? (
                <DetailRow label="Observaciones" value={params.observaciones} />
              ) : null}
            </InfoCard>
          ) : null}
        </>
      )}

      <BodyText>
        Información de tratamiento disponible sin conexión. No realiza evaluación clínica
        automática.
      </BodyText>
    </Screen>
  );
}

export function LinkCodeScreen() {
  const styles = useStyles();
  const { repository } = useLocalData();
  const load = useCallback(
    () => (repository ? repository.linkCode() : Promise.resolve(null)),
    [repository],
  );
  const {
    value: linkCode,
    loading,
    error,
    refresh,
  } = useFocusedValue(load, null as LinkCodeRecord | null);

  const isExpired = linkCode ? new Date(linkCode.expira_en).getTime() <= Date.now() : false;

  return (
    <Screen title="Código de vinculación" backTo="/perfil">
      {loading ? (
        <InfoCard>
          <BodyText>Consultando código de vinculación…</BodyText>
        </InfoCard>
      ) : error ? (
        <InfoCard>
          <BodyText>No se pudo consultar el código de vinculación.</BodyText>
          <VisualButton label="Reintentar" onPress={refresh} />
        </InfoCard>
      ) : !linkCode || isExpired ? (
        <EmptyState
          icon="link-2"
          title="Código no disponible"
          description="Cuando el servicio de vinculación esté conectado, el código emitido por el equipo de salud aparecerá aquí. La aplicación no genera códigos sin conexión."
        />
      ) : (
        <InfoCard>
          <SectionTitle>Comparte este código</SectionTitle>
          <Text style={styles.code}>{linkCode.codigo}</Text>
          <StatusPill>Válido hasta {formatDate(linkCode.expira_en)}</StatusPill>
          <BodyText>
            Compártelo únicamente con tu equipo de salud. Este código se conserva en este
            dispositivo para consulta sin conexión.
          </BodyText>
        </InfoCard>
      )}
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
