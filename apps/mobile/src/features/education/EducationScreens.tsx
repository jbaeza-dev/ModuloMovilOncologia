import Feather from '@expo/vector-icons/Feather';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../components/Screen';
import {
  BodyText,
  DemoBadge,
  EmptyState,
  InfoCard,
  SectionTitle,
  StatusPill,
  VisualButton,
} from '../../components/Visual';
import { theme } from '../../theme';
import { educationCategories, educationResources } from '../preview/fixtures';

export function EducationScreen() {
  return (
    <Screen title="Contenido educativo">
      <DemoBadge />
      <BodyText>Biblioteca de muestra sobre quimioterapia.</BodyText>
      {educationCategories.map((category, index) => (
        <Pressable
          key={category.title}
          accessibilityRole="button"
          accessibilityLabel={category.title}
          onPress={() => router.navigate('/educacion/categoria?categoria=' + String(index))}
          style={styles.row}
        >
          <Feather name={category.icon} size={30} color={theme.colors.text} />
          <View style={styles.copy}>
            <Text style={styles.heading}>{category.title}</Text>
            <BodyText>{category.count}</BodyText>
          </View>
          <Feather name="chevron-right" size={22} color={theme.colors.text} />
        </Pressable>
      ))}
    </Screen>
  );
}
export function EducationCategoryScreen() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const { categoria } = useLocalSearchParams<{ categoria?: string }>();
  const categoryIndex = categoria === '1' || categoria === '2' ? Number(categoria) : 0;
  const resources = educationResources.filter((resource) => resource.category === categoryIndex);
  return (
    <Screen title={educationCategories[categoryIndex].title} backTo="/educacion">
      <DemoBadge />
      <BodyText>Títulos y estados de ejemplo. El contenido definitivo requiere revisión.</BodyText>
      {resources.map((resource) => (
        <InfoCard key={resource.title}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={'Ver descripción de ' + resource.title}
            accessibilityState={{ expanded: expanded === resource.title }}
            onPress={() => setExpanded(expanded === resource.title ? null : resource.title)}
            style={styles.row}
          >
            <Feather
              name={resource.type === 'Video' ? 'play' : 'file-text'}
              size={26}
              color={theme.colors.text}
            />
            <View style={styles.copy}>
              <Text style={styles.heading}>{resource.title}</Text>
              <BodyText>
                {resource.type} · {resource.duration}
              </BodyText>
            </View>
            <Feather
              name={expanded === resource.title ? 'chevron-up' : 'chevron-down'}
              size={22}
              color={theme.colors.text}
            />
          </Pressable>
          {expanded === resource.title ? (
            <View style={styles.stack}>
              <BodyText>Descripción de muestra del recurso educativo.</BodyText>
              <StatusPill>{resource.state}</StatusPill>
              <VisualButton
                label="Ver detalle"
                secondary
                onPress={() =>
                  router.navigate(
                    '/educacion/recurso?recurso=' + String(educationResources.indexOf(resource)),
                  )
                }
              />
            </View>
          ) : null}
        </InfoCard>
      ))}
    </Screen>
  );
}
export function EducationResourceScreen() {
  const { recurso } = useLocalSearchParams<{ recurso?: string }>();
  const requestedIndex = Number(recurso);
  const resource =
    educationResources[
      Number.isInteger(requestedIndex) &&
      requestedIndex >= 0 &&
      requestedIndex < educationResources.length
        ? requestedIndex
        : 0
    ];
  return (
    <Screen title={resource.title} backTo="/educacion">
      <DemoBadge />
      <InfoCard>
        <View style={styles.placeholder}>
          <Feather
            name={resource.type === 'Video' ? 'play-circle' : 'file-text'}
            size={60}
            color={theme.colors.text}
          />
        </View>
        <SectionTitle>
          {resource.type} · {resource.duration}
        </SectionTitle>
        <StatusPill>{resource.state}</StatusPill>
        <BodyText>
          Descripción de ejemplo. El material final será revisado por el equipo correspondiente.
        </BodyText>
      </InfoCard>
      <VisualButton
        label={
          resource.type === 'Video'
            ? 'Reproducir · disponible más adelante'
            : 'Abrir recurso · disponible más adelante'
        }
      />
    </Screen>
  );
}
export function EducationStateScreen() {
  const { estado } = useLocalSearchParams<{ estado?: string }>();
  const state =
    estado === 'cargando' || estado === 'error' || estado === 'sin-conexion' ? estado : 'vacia';
  const copy = {
    vacia: ['Sin recursos', 'Todavía no hay materiales en esta categoría.'],
    cargando: ['Cargando recursos', 'Estado de carga de ejemplo.'],
    error: ['No se pudo mostrar el contenido', 'Estado de error de ejemplo.'],
    'sin-conexion': ['Requiere conexión', 'Este recurso no está descargado.'],
  }[state];
  return (
    <Screen title="Estado de biblioteca" backTo="/educacion">
      <DemoBadge />
      <EmptyState
        icon={state === 'sin-conexion' ? 'wifi-off' : 'book-open'}
        title={copy[0]}
        description={copy[1]}
      />
    </Screen>
  );
}
const styles = StyleSheet.create({
  row: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
  },
  copy: { flex: 1, gap: theme.spacing.xs },
  heading: { fontSize: 17, fontWeight: '700', color: theme.colors.text },
  stack: { gap: theme.spacing.md },
  placeholder: {
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.mutedSurface,
  },
});
