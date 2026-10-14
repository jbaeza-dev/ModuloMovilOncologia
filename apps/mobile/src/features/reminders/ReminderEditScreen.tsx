import Feather from '@expo/vector-icons/Feather';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Screen } from '../../components/Screen';
import { BodyText, DemoBadge, InfoCard, SectionTitle, VisualButton } from '../../components/Visual';
import type { ActiveMedicationRecord } from '../../data/local/clinical-context/clinical-context-types';
import type { ReminderType } from '../../data/local/reminders/reminder-types';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
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
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export function ReminderEditScreen() {
  const { theme: appTheme } = useAppTheme();
  const styles = useStyles();
  const { database, repository, patientId, coordinator, reconcileReminders, trackOperation } =
    useLocalData();
  const { id } = useLocalSearchParams<{ id?: string }>();

  const isEditing = Boolean(id);

  const [tipo, setTipo] = useState<ReminderType>('registro_vitales');
  const [medicamentoId, setMedicamentoId] = useState<string | null>(null);
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);
  // Inicialmente vacío y desactivado según plan aprobado
  const [selectedHours, setSelectedHours] = useState<string[]>([]);
  const [habilitado, setHabilitado] = useState(false);

  // Metadatos preservados de la regla
  const [zonaHoraria, setZonaHoraria] = useState<string | undefined>(undefined);
  const [fechaInicio, setFechaInicio] = useState<string | null | undefined>(undefined);
  const [fechaFin, setFechaFin] = useState<string | null | undefined>(undefined);

  // Entrada personalizada de hora
  const [customHour, setCustomHour] = useState('');
  const [customHourError, setCustomHourError] = useState<string | null>(null);

  const [medications, setMedications] = useState<ActiveMedicationRecord[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Cargar medicamentos activos del paciente (sin auto-selección para exigir elección explícita)
  useEffect(() => {
    if (!repository) return;
    repository.activeMedications().then((meds) => {
      setMedications(meds);
    });
  }, [repository]);

  // Si es edición, cargar la regla existente conservando todos sus metadatos
  useEffect(() => {
    if (!repository || !id) return;
    repository.reminders.getRule(id).then((rule) => {
      if (rule) {
        setTipo(rule.tipo);
        setMedicamentoId(rule.medicamentoId);
        setSelectedDays(rule.diasSemana);
        setSelectedHours(rule.horasMinutos);
        setHabilitado(rule.habilitado);
        setZonaHoraria(rule.zonaHoraria);
        setFechaInicio(rule.fechaInicio);
        setFechaFin(rule.fechaFin);
      }
    });
  }, [repository, id]);

  const toggleDay = (dayId: number) => {
    setSelectedDays((prev) => {
      if (prev.includes(dayId)) {
        if (prev.length === 1) return prev; // al menos 1 día
        return prev.filter((d) => d !== dayId);
      }
      return [...prev, dayId].sort((a, b) => a - b);
    });
  };

  const togglePresetHour = (hour: string) => {
    setSelectedHours((prev) =>
      prev.includes(hour) ? prev.filter((h) => h !== hour) : [...prev, hour].sort(),
    );
  };

  const removeHour = (hour: string) => {
    setSelectedHours((prev) => prev.filter((h) => h !== hour));
  };

  const handleAddCustomHour = () => {
    const trimmed = customHour.trim();
    if (!TIME_REGEX.test(trimmed)) {
      setCustomHourError('Formato inválido. Ingresa HH:mm entre 00:00 y 23:59 (ej: 08:30).');
      return;
    }
    setCustomHourError(null);
    setSelectedHours((prev) => (prev.includes(trimmed) ? prev : [...prev, trimmed].sort()));
    setCustomHour('');
  };

  const handleSave = async () => {
    if (!repository || !database || !patientId || saving) return;
    setErrorMsg(null);

    // Validaciones estrictas
    if (selectedDays.length === 0) {
      setErrorMsg('Debes seleccionar al menos un día de la semana.');
      return;
    }
    if (selectedHours.length === 0) {
      setErrorMsg('Debes añadir al menos una hora para el recordatorio.');
      return;
    }
    if (tipo === 'medicacion' && !medicamentoId) {
      setErrorMsg('Debes seleccionar un medicamento explícitamente para este recordatorio.');
      return;
    }

    setSaving(true);
    try {
      await trackOperation(async () => {
        await repository.reminders.saveRule({
          id,
          tipo,
          medicamentoId: tipo === 'medicacion' ? medicamentoId : null,
          diasSemana: selectedDays,
          horasMinutos: selectedHours,
          zonaHoraria,
          fechaInicio,
          fechaFin,
          habilitado,
        });

        // Reconciliar con la agenda del SO usando la guarda de contexto activo
        if (reconcileReminders) {
          await reconcileReminders(patientId);
        } else if (coordinator) {
          await coordinator.reconcile(patientId, () => true);
        }

        router.back();
      });
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
      await trackOperation(async () => {
        await repository.reminders.deleteRule(id);
        if (reconcileReminders) {
          await reconcileReminders(patientId);
        } else if (coordinator) {
          await coordinator.reconcile(patientId, () => true);
        }
        router.back();
      });
    } catch (err) {
      setErrorMsg((err as Error).message);
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

      {/* Switch de activación de la regla */}
      <InfoCard>
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel="Habilitar este recordatorio"
          accessibilityState={{ checked: habilitado }}
          onPress={() => setHabilitado((prev) => !prev)}
          style={styles.toggleRow}
        >
          <View style={{ flex: 1, paddingRight: theme.spacing.sm }}>
            <Text style={styles.heading}>Habilitar este recordatorio</Text>
            <BodyText>
              {habilitado
                ? 'El recordatorio está activo y programará avisos según los días y horas indicados.'
                : 'El recordatorio está guardado pero desactivado.'}
            </BodyText>
          </View>
          <Feather
            name={habilitado ? 'toggle-right' : 'toggle-left'}
            size={32}
            color={habilitado ? appTheme.colors.primary : appTheme.colors.secondary}
          />
        </Pressable>
      </InfoCard>

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
        <BodyText>Horarios seleccionados:</BodyText>
        {selectedHours.length === 0 ? (
          <BodyText style={{ color: appTheme.colors.secondary, fontStyle: 'italic' }}>
            No hay horarios seleccionados. Añade una hora personalizada o elige un preajuste abajo.
          </BodyText>
        ) : (
          <View style={styles.selectedHoursContainer}>
            {selectedHours.map((hour) => (
              <Pressable
                key={hour}
                accessibilityRole="button"
                accessibilityLabel={`Eliminar hora ${hour}`}
                onPress={() => removeHour(hour)}
                style={styles.selectedHourChip}
              >
                <Text style={styles.selectedHourChipText}>{hour}</Text>
                <Feather name="x" size={16} color="#ffffff" />
              </Pressable>
            ))}
          </View>
        )}

        <View style={{ marginTop: theme.spacing.md }}>
          <Text style={styles.subheading}>Añadir hora personalizada (HH:mm):</Text>
          <View style={styles.customHourRow}>
            <TextInput
              style={styles.timeInput}
              placeholder="08:30"
              placeholderTextColor={appTheme.colors.secondary}
              value={customHour}
              onChangeText={(text) => {
                setCustomHour(text);
                if (customHourError) setCustomHourError(null);
              }}
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              accessibilityLabel="Hora personalizada formato HH:mm"
            />
            <VisualButton label="Añadir hora" onPress={handleAddCustomHour} />
          </View>
          {customHourError ? (
            <BodyText style={{ color: '#dc2626', fontSize: 13, marginTop: 4 }}>
              {customHourError}
            </BodyText>
          ) : null}
        </View>

        <View style={{ marginTop: theme.spacing.md }}>
          <Text style={styles.subheading}>O selecciona horarios rápidos:</Text>
          <View style={styles.hoursGrid}>
            {PRESET_HOURS.map((hour) => {
              const isSelected = selectedHours.includes(hour);
              return (
                <Pressable
                  key={hour}
                  accessibilityRole="button"
                  accessibilityLabel={`Hora preajuste ${hour}`}
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => togglePresetHour(hour)}
                  style={[styles.hourPill, isSelected && styles.hourPillSelected]}
                >
                  <Text style={[styles.hourText, isSelected && styles.hourTextSelected]}>
                    {hour}
                  </Text>
                </Pressable>
              );
            })}
          </View>
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
    subheading: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
      marginBottom: theme.spacing.xs,
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
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
    selectedHoursContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.xs,
      marginBottom: theme.spacing.sm,
    },
    selectedHourChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: colors.primary,
    },
    selectedHourChipText: {
      fontSize: 15,
      fontWeight: '700',
      color: '#ffffff',
    },
    customHourRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      marginTop: 4,
    },
    timeInput: {
      flex: 1,
      height: 46,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: theme.radius.sm,
      paddingHorizontal: 12,
      fontSize: 16,
      color: colors.text,
      backgroundColor: colors.surface,
    },
    hoursGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.xs,
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
