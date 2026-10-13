import Feather from '@expo/vector-icons/Feather';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '../../components/Screen';
import { BodyText, DemoBadge, InfoCard, SectionTitle, VisualButton } from '../../components/Visual';
import type { ActiveMedicationRecord } from '../../data/local/clinical-context/clinical-context-types';
import type { ReminderType } from '../../data/local/reminders/reminder-types';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import { ExpoNotificationAdapter } from '../../services/notifications/expo-notification-adapter';
import { NotificationCoordinator } from '../../services/reminders/notification-coordinator';
import { theme } from '../../theme';

const DAYS = [
  { id: 1, label: 'Lunes', short: 'L' },
  { id: 2, label: 'Martes', short: 'M' },
  { id: 3, label: 'Miércoles', short: 'M' },
  { id: 4, label: 'Jueves', short: 'J' },
  { id: 5, label: 'Viernes', short: 'V' },
  { id: 6, label: 'Sábado', short: 'S' },
  { id: 7, label: 'Domingo', short: 'D' },
];

const PRESET_HOURS = ['08:00', '09:00', '12:00', '14:00', '20:00', '21:00'];

export function ReminderEditScreen() {
  const { theme: appTheme } = useAppTheme();
  const styles = useStyles();
  const { database, repository, patientId } = useLocalData();
  const adapter = useMemo(() => new ExpoNotificationAdapter(), []);
  const { id } = useLocalSearchParams<{ id?: string }>();

  const isEditing = Boolean(id);

  const [tipo, setTipo] = useState<ReminderType>('registro_vitales');
  const [medicamentoId, setMedicamentoId] = useState<string | null>(null);
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  const [selectedHours, setSelectedHours] = useState<string[]>(['09:00']);
  const [habilitado, setHabilitado] = useState(true);

  const [medications, setMedications] = useState<ActiveMedicationRecord[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Cargar medicamentos activos del paciente
  useEffect(() => {
    if (!repository) return;
    repository.activeMedications().then((meds) => {
      setMedications(meds);
      if (meds.length > 0 && !medicamentoId) {
        setMedicamentoId(meds[0].id);
      }
    });
  }, [repository, medicamentoId]);

  // Si es edición, cargar la regla existente
  useEffect(() => {
    if (!repository || !id) return;
    repository.reminders.getRule(id).then((rule) => {
      if (rule) {
        setTipo(rule.tipo);
        setMedicamentoId(rule.medicamentoId);
        setSelectedDays(rule.diasSemana);
        setSelectedHours(rule.horasMinutos);
        setHabilitado(rule.habilitado);
      }
    });
  }, [repository, id]);

  const toggleDay = (dayId: number) => {
    if (selectedDays.includes(dayId)) {
      if (selectedDays.length === 1) return; // al menos 1 día
      setSelectedDays(selectedDays.filter((d) => d !== dayId));
    } else {
      setSelectedDays([...selectedDays, dayId].sort((a, b) => a - b));
    }
  };

  const toggleHour = (hour: string) => {
    if (selectedHours.includes(hour)) {
      if (selectedHours.length === 1) return; // al menos 1 hora
      setSelectedHours(selectedHours.filter((h) => h !== hour));
    } else {
      setSelectedHours([...selectedHours, hour].sort());
    }
  };

  const handleSave = async () => {
    if (!repository || !database || !patientId || saving) return;
    setErrorMsg(null);
    setSaving(true);
    try {
      await repository.reminders.saveRule({
        id,
        tipo,
        medicamentoId: tipo === 'medicacion' ? medicamentoId : null,
        diasSemana: selectedDays,
        horasMinutos: selectedHours,
        habilitado,
      });

      // Reconciliar con la agenda del SO
      const coordinator = new NotificationCoordinator(database, adapter);
      await coordinator.reconcile(patientId);

      router.back();
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!repository || !database || !patientId || !id || saving) return;
    setSaving(true);
    try {
      await repository.reminders.deleteRule(id);
      const coordinator = new NotificationCoordinator(database, adapter);
      await coordinator.reconcile(patientId);
      router.back();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      title={isEditing ? 'Editar recordatorio' : 'Nuevo recordatorio'}
      backTo="/recordatorios"
    >
      <DemoBadge />

      {errorMsg ? (
        <InfoCard>
          <View style={styles.errorHeader}>
            <Feather name="alert-circle" size={20} color="#dc2626" />
            <Text style={[styles.heading, { color: '#dc2626' }]}>Error de validación</Text>
          </View>
          <BodyText style={{ color: '#dc2626' }}>{errorMsg}</BodyText>
        </InfoCard>
      ) : null}

      {/* Tipo de recordatorio */}
      <InfoCard>
        <SectionTitle>¿Qué deseas recordar?</SectionTitle>
        <View style={styles.optionsGroup}>
          <Pressable
            accessibilityRole="radio"
            accessibilityLabel="Registro de signos vitales"
            accessibilityState={{ selected: tipo === 'registro_vitales' }}
            onPress={() => setTipo('registro_vitales')}
            style={[styles.typeOption, tipo === 'registro_vitales' && styles.typeOptionSelected]}
          >
            <Feather
              name="activity"
              size={22}
              color={
                tipo === 'registro_vitales' ? appTheme.colors.primary : appTheme.colors.secondary
              }
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.optionTitle}>Signos vitales</Text>
              <Text style={styles.optionSubtitle}>Temperatura y pulso diario</Text>
            </View>
          </Pressable>

          <Pressable
            accessibilityRole="radio"
            accessibilityLabel="Consulta de medicación"
            accessibilityState={{ selected: tipo === 'medicacion' }}
            onPress={() => setTipo('medicacion')}
            style={[styles.typeOption, tipo === 'medicacion' && styles.typeOptionSelected]}
          >
            <Feather
              name="clock"
              size={22}
              color={tipo === 'medicacion' ? appTheme.colors.primary : appTheme.colors.secondary}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.optionTitle}>Medicación</Text>
              <Text style={styles.optionSubtitle}>Aviso para consultar tomas</Text>
            </View>
          </Pressable>
        </View>
      </InfoCard>

      {/* Selección de medicamento (si tipo es 'medicacion') */}
      {tipo === 'medicacion' ? (
        <InfoCard>
          <SectionTitle>Medicamento vinculado</SectionTitle>
          <BodyText>
            Selecciona el medicamento del paciente sobre el cual deseas configurar el aviso.
          </BodyText>
          {medications.length === 0 ? (
            <BodyText style={{ color: '#b45309' }}>
              No hay medicamentos prescritos registrados para este paciente.
            </BodyText>
          ) : (
            <View style={styles.optionsGroup}>
              {medications.map((med) => {
                const selected = medicamentoId === med.id;
                return (
                  <Pressable
                    key={med.id}
                    accessibilityRole="radio"
                    accessibilityLabel={med.nombre}
                    accessibilityState={{ selected }}
                    onPress={() => setMedicamentoId(med.id)}
                    style={[styles.medOption, selected && styles.medOptionSelected]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.medTitle}>{med.nombre}</Text>
                      <Text style={styles.medSubtitle}>
                        Dosis: {med.dosis} · Pauta: {med.frecuencia}
                      </Text>
                    </View>
                    <Feather
                      name={selected ? 'check-circle' : 'circle'}
                      size={22}
                      color={selected ? appTheme.colors.primary : appTheme.colors.secondary}
                    />
                  </Pressable>
                );
              })}
            </View>
          )}
        </InfoCard>
      ) : null}

      {/* Días de la semana */}
      <InfoCard>
        <SectionTitle>Días de la semana</SectionTitle>
        <BodyText>Selecciona los días en que debe emitirse este recordatorio.</BodyText>
        <View style={styles.daysRow}>
          {DAYS.map((day) => {
            const isSelected = selectedDays.includes(day.id);
            return (
              <Pressable
                key={day.id}
                accessibilityRole="button"
                accessibilityLabel={day.label}
                accessibilityState={{ selected: isSelected }}
                onPress={() => toggleDay(day.id)}
                style={[styles.dayButton, isSelected && styles.dayButtonSelected]}
              >
                <Text style={[styles.dayButtonText, isSelected && styles.dayButtonTextSelected]}>
                  {day.short}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </InfoCard>

      {/* Horas del recordatorio */}
      <InfoCard>
        <SectionTitle>Horas de aviso</SectionTitle>
        <BodyText>Selecciona una o más horas:</BodyText>
        <View style={styles.hoursGrid}>
          {PRESET_HOURS.map((hour) => {
            const isSelected = selectedHours.includes(hour);
            return (
              <Pressable
                key={hour}
                accessibilityRole="button"
                accessibilityLabel={`Hora ${hour}`}
                accessibilityState={{ selected: isSelected }}
                onPress={() => toggleHour(hour)}
                style={[styles.hourPill, isSelected && styles.hourPillSelected]}
              >
                <Text style={[styles.hourText, isSelected && styles.hourTextSelected]}>{hour}</Text>
              </Pressable>
            );
          })}
        </View>
      </InfoCard>

      {/* Botones de acción */}
      <View style={styles.actions}>
        <VisualButton
          label={saving ? 'Guardando...' : 'Guardar recordatorio'}
          onPress={handleSave}
          disabled={saving}
        />
        {isEditing ? (
          <VisualButton
            label="Eliminar recordatorio"
            secondary
            onPress={handleDelete}
            disabled={saving}
          />
        ) : null}
      </View>
    </Screen>
  );
}

function useStyles() {
  const { theme: appTheme } = useAppTheme();
  const colors = appTheme.colors;

  return StyleSheet.create({
    heading: {
      fontSize: 16,
      fontWeight: '700',
    },
    errorHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      marginBottom: 4,
    },
    optionsGroup: {
      gap: theme.spacing.sm,
      marginTop: theme.spacing.xs,
    },
    typeOption: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      padding: theme.spacing.md,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    typeOptionSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.surface,
    },
    optionTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    optionSubtitle: {
      fontSize: 13,
      color: colors.secondary,
      marginTop: 2,
    },
    medOption: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: theme.spacing.md,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    medOptionSelected: {
      borderColor: colors.primary,
    },
    medTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    medSubtitle: {
      fontSize: 13,
      color: colors.secondary,
      marginTop: 2,
    },
    daysRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: theme.spacing.sm,
    },
    dayButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    dayButtonSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    dayButtonText: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    dayButtonTextSelected: {
      color: '#ffffff',
    },
    hoursGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.sm,
    },
    hourPill: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    hourPillSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    hourText: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
    },
    hourTextSelected: {
      color: '#ffffff',
    },
    actions: {
      gap: theme.spacing.sm,
      marginTop: theme.spacing.md,
      marginBottom: theme.spacing.xl,
    },
  });
}
