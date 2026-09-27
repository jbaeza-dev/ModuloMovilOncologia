import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

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
} from '../../components/Visual';
import { theme } from '../../theme';

export function ProfileScreen() {
  return (
    <Screen title="Mi perfil" backTo="/">
      <DemoBadge />
      <InfoCard>
        <Text style={styles.heading}>Paciente de ejemplo</Text>
        <BodyText>paciente.ejemplo@quimiocare.test</BodyText>
      </InfoCard>
      <NavigationCard
        title="Datos personales"
        description="Información de consulta."
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
        description="Vista para compartir con el equipo de salud."
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
        description="Presentación de avisos y cuenta."
        icon="settings"
        href="/perfil/preferencias"
      />
    </Screen>
  );
}

export function PersonalDataScreen() {
  return (
    <Screen title="Datos personales" backTo="/perfil">
      <DemoBadge />
      <InfoCard>
        <DetailRow label="Nombre" value="Paciente" />
        <DetailRow label="Apellido" value="Ejemplo" />
        <DetailRow label="Correo" value="paciente.ejemplo@quimiocare.test" />
        <DetailRow label="Teléfono" value="+56 9 0000 0000" />
        <DetailRow label="Fecha de nacimiento" value="01/01/1990" />
      </InfoCard>
      <BodyText>
        Datos ficticios de presentación. La edición de la información personal no forma parte de
        este prototipo.
      </BodyText>
    </Screen>
  );
}

const clinicalSections = [
  {
    title: 'Información personal',
    rows: [
      ['Sexo', 'Dato de ejemplo'],
      ['Ciudad', 'Ciudad de ejemplo'],
    ],
  },
  { title: 'Antecedentes médicos', rows: [['Antecedentes', 'Información de ejemplo']] },
  { title: 'Tratamiento farmacológico', rows: [['Tratamiento', 'Consulta de ejemplo']] },
  { title: 'Estilo de vida', rows: [['Información', 'Disponible en una etapa posterior']] },
] as const;

export function ClinicalProfileScreen() {
  const [open, setOpen] = useState<string | null>('Información personal');
  return (
    <Screen title="Perfil clínico" backTo="/perfil">
      <DemoBadge />
      <InfoCard>
        <SectionTitle>Tratamiento de quimioterapia</SectionTitle>
        <DetailRow label="Equipo tratante" value="Centro de ejemplo" />
        <DetailRow label="Inicio" value="Fecha de ejemplo" />
      </InfoCard>
      {clinicalSections.map((section) => (
        <InfoCard key={section.title}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={section.title}
            accessibilityState={{ expanded: open === section.title }}
            onPress={() => setOpen(open === section.title ? null : section.title)}
            style={styles.disclosure}
          >
            <Text style={styles.heading}>{section.title}</Text>
            <Feather
              name={open === section.title ? 'chevron-up' : 'chevron-down'}
              size={22}
              color={theme.colors.text}
            />
          </Pressable>
          {open === section.title
            ? section.rows.map(([label, value]) => (
                <DetailRow key={label} label={label} value={value} />
              ))
            : null}
        </InfoCard>
      ))}
    </Screen>
  );
}

export function LinkCodeScreen() {
  const { estado } = useLocalSearchParams<{ estado?: string }>();
  const view = estado === 'vinculado' || estado === 'sin-codigo' ? estado : 'codigo';
  return (
    <Screen title="Código de vinculación" backTo="/perfil">
      <DemoBadge />
      {view === 'sin-codigo' ? (
        <EmptyState
          icon="link-2"
          title="Código no disponible"
          description="Cuando el servicio de vinculación esté conectado, el estado aparecerá aquí."
        />
      ) : view === 'vinculado' ? (
        <InfoCard>
          <SectionTitle>Vínculo establecido</SectionTitle>
          <StatusPill>Ejemplo visual</StatusPill>
          <BodyText>
            Esta vista muestra cómo se presentaría un vínculo confirmado por el servicio
            correspondiente.
          </BodyText>
        </InfoCard>
      ) : (
        <InfoCard>
          <SectionTitle>Comparte este código</SectionTitle>
          <Text style={styles.code}>ABC 123</Text>
          <StatusPill>Código ficticio</StatusPill>
          <BodyText>
            Compártelo únicamente con tu equipo de salud. Esta vista no genera ni copia códigos
            reales.
          </BodyText>
        </InfoCard>
      )}
    </Screen>
  );
}

export function PreferencesScreen() {
  const [notices, setNotices] = useState(true);
  return (
    <Screen title="Preferencias" backTo="/perfil">
      <DemoBadge />
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
            color={theme.colors.text}
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

const styles = StyleSheet.create({
  heading: { flex: 1, fontSize: 18, fontWeight: '700', color: theme.colors.text },
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
    color: theme.colors.text,
    textAlign: 'center',
    paddingVertical: theme.spacing.md,
  },
});
