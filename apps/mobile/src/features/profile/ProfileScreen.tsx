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
  formatLinkCode,
  type ClinicalFileRecord,
  type LinkCodeRecord,
  type PatientProfileRecord,
  type TreatmentRecord,
} from '../../data/local/repository';
import { useFocusedValue } from '../../hooks/use-local-query';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { PALETTE_OPTIONS, theme } from '../../theme';
import { isDemoMode } from '../../utils/environment';

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
      <DemoBadge />
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
        description="Información de quimioterapia y ficha."
        icon="file-text"
        href="/perfil/clinico"
      />
      <NavigationCard
        title="Medicación activa"
        description="Fármacos y dosis en curso."
        icon="activity"
        href="/perfil/medicacion"
      />
      <NavigationCard
        title="Equipo tratante"
        description="Profesionales de salud vinculados."
        icon="users"
        href="/perfil/equipo"
      />
      <NavigationCard
        title="Código de vinculación"
        description="Código para compartir con tu equipo de salud."
        icon="link"
        href="/perfil/vinculacion"
      />
      <NavigationCard
        title="Consentimientos"
        description="Gestión y trazabilidad de términos."
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
      <DemoBadge />
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
  const loadData = useCallback(async () => {
    if (!repository) return { treatment: null, clinicalFile: null };
    const [treatment, clinicalFile] = await Promise.all([
      repository.treatment(),
      repository.clinicalFile(),
    ]);
    return { treatment, clinicalFile };
  }, [repository]);

  const {
    value: clinicalData,
    loading,
    error,
    refresh,
  } = useFocusedValue(loadData, {
    treatment: null as TreatmentRecord | null,
    clinicalFile: null as ClinicalFileRecord | null,
  });

  const treatment = clinicalData.treatment;
  const clinicalFile = clinicalData.clinicalFile;
  const [open, setOpen] = useState<string | null>('Parámetros de tratamiento');

  let params: {
    ciclo_actual?: number;
    total_ciclos?: number;
    observaciones?: string;
  } | null = null;

  if (treatment?.parametros_json) {
    try {
      params = JSON.parse(treatment.parametros_json) as {
        ciclo_actual?: number;
        total_ciclos?: number;
        observaciones?: string;
      };
    } catch {
      params = null;
    }
  }

  return (
    <Screen title="Perfil clínico" backTo="/perfil">
      <DemoBadge />
      {loading ? (
        <InfoCard>
          <BodyText>Cargando información clínica…</BodyText>
        </InfoCard>
      ) : error ? (
        <InfoCard>
          <BodyText>No se pudo consultar el tratamiento local.</BodyText>
          <VisualButton label="Reintentar" onPress={refresh} />
        </InfoCard>
      ) : !treatment && !clinicalFile ? (
        <EmptyState
          icon="file-text"
          title="Sin tratamiento registrado"
          description="No se encontró un esquema de quimioterapia para este paciente."
        />
      ) : (
        <>
          {clinicalFile ? (
            <InfoCard>
              <SectionTitle>Ficha clínica</SectionTitle>
              <DetailRow label="Identificador" value={clinicalFile.ficha_id} />
              <StatusPill>
                Ficha identificada · Información en caché ({formatDate(clinicalFile.obtenido_en)})
              </StatusPill>
            </InfoCard>
          ) : null}

          {treatment ? (
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
          ) : null}

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
  const isPending = linkCode?.estado_conocido === 'pendiente';
  const isValid = Boolean(linkCode && !isExpired && isPending);

  return (
    <Screen title="Código de vinculación" backTo="/perfil">
      <DemoBadge />
      <BodyText>
        Código de muestra sintético para demostración técnica del almacenamiento local.
      </BodyText>
      {loading ? (
        <InfoCard>
          <BodyText>Consultando código de vinculación…</BodyText>
        </InfoCard>
      ) : error ? (
        <InfoCard>
          <BodyText>No se pudo consultar el código de vinculación.</BodyText>
          <VisualButton label="Reintentar" onPress={refresh} />
        </InfoCard>
      ) : !linkCode ? (
        <EmptyState
          icon="link-2"
          title="Código no disponible"
          description="Cuando el servicio de vinculación esté conectado, el código emitido por el equipo de salud aparecerá aquí. La aplicación no genera códigos sin conexión."
        />
      ) : !isValid ? (
        <InfoCard>
          <SectionTitle>Código no vigente</SectionTitle>
          <Text style={styles.code}>{formatLinkCode(linkCode.codigo)}</Text>
          <StatusPill>
            {linkCode.estado_conocido === 'usado' ? 'Código ya utilizado' : 'Código expirado'}
          </StatusPill>
          <BodyText>
            {linkCode.estado_conocido === 'usado'
              ? 'Este código ya fue utilizado para vincular tu dispositivo con el equipo tratante.'
              : `Este código venció el ${formatDate(linkCode.expira_en)}. Solicita uno nuevo cuando cuentes con conexión.`}
          </BodyText>
        </InfoCard>
      ) : (
        <InfoCard>
          <SectionTitle>Comparte este código</SectionTitle>
          <Text style={styles.code}>{formatLinkCode(linkCode.codigo)}</Text>
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
  const { repository, coordinator, patientId, reconcileReminders, closeActiveContext, isClosing } =
    useLocalData();
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
    await repository.reminders.setPreferences(nextVal);
    if (patientId) {
      if (reconcileReminders) {
        await reconcileReminders(patientId);
      } else if (coordinator) {
        await coordinator.reconcile(patientId, () => true);
      }
    }
    await refreshPrefs();
  };

  return (
    <Screen title="Preferencias" backTo="/perfil">
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
          <Text style={styles.heading}>Habilitar avisos locales</Text>
          <Feather
            name={prefs.enabled ? 'toggle-right' : 'toggle-left'}
            size={28}
            color={appTheme.colors.text}
          />
        </Pressable>
        <BodyText>
          {prefs.enabled
            ? 'Los avisos locales están autorizados en este dispositivo para el paciente activo.'
            : 'Los avisos locales están desactivados. No se emitirán alertas nativas.'}
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
        description="Consulta la agenda de avisos locales y su historial de recepción."
        icon="bell"
        href="/avisos"
      />
      <InfoCard>
        <SectionTitle>Cuenta y seguridad</SectionTitle>
        <BodyText>
          {isDemoMode()
            ? 'Sesión demostrativa local. Puedes conmutar de paciente o salir hacia el acceso público.'
            : 'La gestión de la cuenta se integrará con el flujo de identidad.'}
        </BodyText>
        {isDemoMode() ? (
          <VisualButton
            label={isClosing ? 'Cerrando contexto…' : 'Cambiar paciente de prueba'}
            secondary
            disabled={isClosing}
            onPress={() => void closeActiveContext('change_patient')}
          />
        ) : null}
        <VisualButton
          label={isClosing ? 'Cerrando sesión…' : 'Cerrar contexto activo'}
          secondary
          disabled={isClosing}
          onPress={() => void closeActiveContext('manual_close')}
        />
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
