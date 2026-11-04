import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { InfoCard, SectionTitle, StatusPill, VisualButton } from '../../components/Visual';
import { useAppTheme } from '../../providers/ThemeProvider';
import { isDemoMode } from '../../utils/environment';
import { useMedicationDay } from './use-medication-day';

export function MedicationDaySection({ medicamentoId }: { medicamentoId?: string } = {}) {
  const day = useMedicationDay(),
    { theme } = useAppTheme();
  if (!day.identity) return null;
  return (
    <View testID="medication-day-section" style={{ gap: 16 }}>
      <SectionTitle>Mis medicamentos de hoy</SectionTitle>
      <Text style={{ color: theme.colors.text }}>
        Tus confirmaciones corresponden a los avisos que configuraste. Sigue las indicaciones de tu
        equipo tratante.
      </Text>
      {day.loading ? (
        <Text style={{ color: theme.colors.text }}>Cargando medicamentos y avisos…</Text>
      ) : null}
      {day.error ? (
        <InfoCard>
          <Text accessibilityRole="alert" style={{ color: theme.colors.error }}>
            {day.error}
          </Text>
          <VisualButton
            label="Reintentar medicamentos y avisos"
            onPress={() => void day.refresh()}
          />
        </InfoCard>
      ) : null}
      {!day.loading &&
      !day.cards.some(
        (card) =>
          !medicamentoId || card.medication.id.toLowerCase() === medicamentoId.toLowerCase(),
      ) ? (
        <Text style={{ color: theme.colors.text }}>
          No hay medicamentos disponibles para hoy en la información recibida.
        </Text>
      ) : null}
      {day.cards
        .filter(
          (card) =>
            !medicamentoId || card.medication.id.toLowerCase() === medicamentoId.toLowerCase(),
        )
        .map((card) => (
          <InfoCard key={card.medication.id} testID={`medication-card-${card.medication.id}`}>
            {isDemoMode() ? <StatusPill>Ejemplo de prueba</StatusPill> : null}
            <SectionTitle>{card.medication.nombre || 'Nombre no informado'}</SectionTitle>
            {card.medication.dosis ? (
              <Text style={{ color: theme.colors.text }}>
                Dosis indicada: {card.medication.dosis}
              </Text>
            ) : null}
            {card.medication.frecuencia ? (
              <Text style={{ color: theme.colors.text }}>
                Frecuencia indicada: {card.medication.frecuencia}
              </Text>
            ) : null}
            {card.pendingChange ? (
              <Text style={{ color: theme.colors.warning }}>
                Hay un cambio de aviso pendiente de confirmar. Revisa Mis recordatorios.
              </Text>
            ) : null}
            {!day.loading && !day.error && card.slots.length === 0 ? (
              <Text style={{ color: theme.colors.text }}>
                {card.confirmedRules.some((r) => r.activo)
                  ? 'No tienes avisos de este medicamento para hoy.'
                  : 'Sin avisos confirmados para este medicamento.'}
              </Text>
            ) : null}
            {card.slots.map((slot) => (
              <View
                key={slot.key}
                testID={`medication-notice-${card.medication.id}-${slot.time}`}
                style={{
                  padding: 12,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  borderRadius: 12,
                  gap: 10,
                }}
              >
                <Text
                  accessibilityRole="header"
                  style={{ color: theme.colors.text, fontWeight: '700' }}
                >
                  Aviso de las {slot.time}
                </Text>
                <StatusPill>
                  {slot.intake
                    ? slot.intake.estado === 'taken'
                      ? 'Tomada'
                      : 'No tomada'
                    : slot.due
                      ? 'Sin confirmar'
                      : 'Más tarde'}
                </StatusPill>
                {slot.due && !day.error ? (
                  slot.intake ? (
                    <VisualButton
                      label={
                        slot.intake.estado === 'taken'
                          ? 'Corregir: no la tomé'
                          : 'Corregir: sí la tomé'
                      }
                      secondary
                      disabled={day.saving || day.isClosing}
                      onPress={() =>
                        day.confirm(
                          card,
                          slot,
                          slot.intake!.estado === 'taken' ? 'omitted' : 'taken',
                        )
                      }
                    />
                  ) : (
                    <>
                      <VisualButton
                        label={day.saving ? 'Guardando…' : 'Ya la tomé'}
                        disabled={day.saving || day.isClosing}
                        onPress={() => day.confirm(card, slot, 'taken')}
                      />
                      <VisualButton
                        label="No la tomé"
                        secondary
                        disabled={day.saving || day.isClosing}
                        onPress={() => day.confirm(card, slot, 'omitted')}
                      />
                    </>
                  )
                ) : !slot.due ? (
                  <Text style={{ color: theme.colors.text }}>
                    Podrás confirmar cuando llegue este horario.
                  </Text>
                ) : null}
              </View>
            ))}
            {card.historical.length > 0 ? (
              <View style={{ gap: 6 }}>
                <Text style={{ color: theme.colors.secondary }}>
                  Otros registros guardados hoy ({card.historical.length}). Se conservan aparte de
                  estos avisos.
                </Text>
                {card.historical.map((entry) => (
                  <Text key={entry.id} style={{ color: theme.colors.secondary }}>
                    {entry.estado === 'taken' ? 'Tomada' : 'No tomada'} ·{' '}
                    {new Date(entry.fecha_hora).toLocaleTimeString('es-CL', {
                      timeZone: 'America/Santiago',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                ))}
              </View>
            ) : null}
            <VisualButton
              label="Configurar aviso"
              secondary
              disabled={day.isClosing}
              onPress={() =>
                router.push({
                  pathname: '/recordatorios/editar',
                  params: { tipo: 'medicacion', medicamentoId: card.medication.id },
                })
              }
            />
            <VisualButton
              label="Ver indicaciones"
              secondary
              onPress={() => router.push('/perfil/medicacion')}
            />
          </InfoCard>
        ))}
      <VisualButton
        label="Ver todos mis medicamentos"
        secondary
        onPress={() => router.push('/perfil/medicacion')}
      />
    </View>
  );
}
