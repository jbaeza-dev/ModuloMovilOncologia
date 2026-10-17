import Feather from '@expo/vector-icons/Feather';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DateTimePickerField } from '../../components/DateTimePickerField';
import { Screen } from '../../components/Screen';
import { BodyText, DemoBadge, InfoCard, SectionTitle, VisualButton } from '../../components/Visual';
import type { ActiveMedicationRecord } from '../../data/local/clinical-context/clinical-context-types';
import type { ReminderType } from '../../data/local/reminders/reminder-types';
import { formatDate } from '../../data/local/repository';
import { useLocalData } from '../../providers/LocalDataProvider';
import { useAppTheme } from '../../providers/ThemeProvider';
import {
  ALL_WEEK_DAYS,
  applyInclusiveDurationWithBounds,
  DEFAULT_VITAL_TIME,
  detectMedicationTemplate,
  getCivilDateInTimeZone,
  getInclusiveDaysBetween,
  INCLUSIVE_DURATION_PRESETS,
  MEDICATION_SCHEDULE_TEMPLATES,
  type MedicationTemplateId,
  resolveMedicationDateBounds,
  validateReminderDateRange,
} from '../../services/reminders/reminder-date-utils';
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

type DurationMode = 'treatment' | 'days' | 'custom_dates';

function normalizeParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function ReminderEditScreen() {
  const { theme: appTheme } = useAppTheme();
  const styles = useStyles();
  const {
    database,
    repository,
    patientId,
    coordinator,
    reconcileReminders,
    bumpRemindersRevision,
    trackOperation,
  } = useLocalData();
  const rawParams = useLocalSearchParams<{
    id?: string | string[];
    tipo?: string | string[];
    medicamentoId?: string | string[];
  }>();

  const id = normalizeParam(rawParams.id);
  const paramTipo = normalizeParam(rawParams.tipo);
  const paramMedicamentoId = normalizeParam(rawParams.medicamentoId);

  const isEditing = Boolean(id);
  const initialTipo: ReminderType = paramTipo === 'medicacion' ? 'medicacion' : 'registro_vitales';

  const [tipo, setTipo] = useState<ReminderType>(initialTipo);
  const [medicamentoId, setMedicamentoId] = useState<string | null>(
    initialTipo === 'medicacion' && paramMedicamentoId ? paramMedicamentoId : null,
  );
  const [selectedDays, setSelectedDays] = useState<number[]>([...ALL_WEEK_DAYS]);
  const [selectedHours, setSelectedHours] = useState<string[]>([DEFAULT_VITAL_TIME]);
  const [habilitado, setHabilitado] = useState(true);

  // Metadatos preservados de la regla
  const [zonaHoraria, setZonaHoraria] = useState<string | undefined>(undefined);
  const [fechaInicio, setFechaInicio] = useState<string | null>(null);
  const [fechaFin, setFechaFin] = useState<string | null>(null);

  // Controles de personalización y duración
  const [vitalCustomized, setVitalCustomized] = useState(false);
  const [medTemplate, setMedTemplate] = useState<MedicationTemplateId>('morning');
  const [durationMode, setDurationMode] = useState<DurationMode>('treatment');
  const [selectedDurationDays, setSelectedDurationDays] = useState<number | null>(7);
  const [clampedNotice, setClampedNotice] = useState<string | null>(null);

  const [medications, setMedications] = useState<ActiveMedicationRecord[]>([]);
  const [medicationsLoaded, setMedicationsLoaded] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const todayCivilDate = useMemo(
    () => getCivilDateInTimeZone(new Date(), zonaHoraria ?? 'America/Santiago'),
    [zonaHoraria],
  );

  // Cargar medicamentos activos del paciente (sin auto-selección cuando falta medicamentoId)
  useEffect(() => {
    if (!repository || typeof repository.activeMedications !== 'function') {
      setMedicationsLoaded(true);
      return;
    }
    let active = true;
    void repository.activeMedications().then(
      (meds) => {
        if (!active) return;
        setMedications(meds);
        setMedicationsLoaded(true);
        // Si paramMedicamentoId vino por ruta pero no existe en el catálogo y no es edición, limpiar para exigir elección explícita
        if (!isEditing && paramMedicamentoId && !meds.some((m) => m.id === paramMedicamentoId)) {
          setMedicamentoId(null);
        }
      },
      () => {
        if (!active) return;
        setMedications([]);
        setMedicationsLoaded(true);
      },
    );
    return () => {
      active = false;
    };
  }, [repository, isEditing, paramMedicamentoId]);

  const selectedMedication = useMemo(
    () => medications.find((m) => m.id === medicamentoId) ?? null,
    [medications, medicamentoId],
  );

  const medBounds = useMemo(
    () =>
      resolveMedicationDateBounds(
        selectedMedication,
        todayCivilDate,
        zonaHoraria ?? 'America/Santiago',
      ),
    [selectedMedication, todayCivilDate, zonaHoraria],
  );

  // Si es edición, cargar la regla existente conservando todos sus metadatos
  useEffect(() => {
    if (!repository || !id) return;
    let active = true;
    repository.reminders.getRule(id).then((rule) => {
      if (!active || !rule) return;
      setTipo(rule.tipo);
      setMedicamentoId(rule.medicamentoId);
      setSelectedDays(rule.diasSemana);
      setSelectedHours(rule.horasMinutos.length > 0 ? rule.horasMinutos : [DEFAULT_VITAL_TIME]);
      setHabilitado(rule.habilitado);
      setZonaHoraria(rule.zonaHoraria);
      setFechaInicio(rule.fechaInicio);
      setFechaFin(rule.fechaFin);

      const isAllDays =
        rule.diasSemana.length === 7 &&
        [...rule.diasSemana].sort((a, b) => a - b).every((d, idx) => d === idx + 1);
      const hasMultipleHours = rule.horasMinutos.length > 1;
      const hasDates = Boolean(rule.fechaInicio || rule.fechaFin);

      if (rule.tipo === 'registro_vitales') {
        setVitalCustomized(!isAllDays || hasMultipleHours || hasDates);
      } else {
        const detected = detectMedicationTemplate(rule.horasMinutos, rule.diasSemana, !isAllDays);
        setMedTemplate(detected);
        if (hasDates) {
          const inclusiveDays = getInclusiveDaysBetween(rule.fechaInicio, rule.fechaFin);
          if (
            inclusiveDays &&
            (INCLUSIVE_DURATION_PRESETS as readonly number[]).includes(inclusiveDays)
          ) {
            setDurationMode('days');
            setSelectedDurationDays(inclusiveDays);
          } else {
            setDurationMode('custom_dates');
          }
        } else {
          setDurationMode('treatment');
        }
      }
    });
    return () => {
      active = false;
    };
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

  const handleSelectMedicationTemplate = (templateId: MedicationTemplateId) => {
    setMedTemplate(templateId);
    const tpl = MEDICATION_SCHEDULE_TEMPLATES.find((t) => t.id === templateId);
    if (tpl && tpl.id !== 'custom') {
      setSelectedHours([...tpl.hours]);
      setSelectedDays([...ALL_WEEK_DAYS]);
    } else if (selectedHours.length === 0) {
      setSelectedHours([DEFAULT_VITAL_TIME]);
    }
  };

  const handleUpdateHourAtIndex = (index: number, nextHhMm: string) => {
    setSelectedHours((prev) => {
      const next = [...prev];
      next[index] = nextHhMm;
      return Array.from(new Set(next)).sort();
    });
  };

  const handleAddAnotherHour = () => {
    const candidates = ['07:00', '12:00', '15:00', '19:00', '21:00', '23:00'];
    const nextCandidate = candidates.find((c) => !selectedHours.includes(c)) ?? '08:00';
    setSelectedHours((prev) => Array.from(new Set([...prev, nextCandidate])).sort());
  };

  const removeHour = (hour: string) => {
    setSelectedHours((prev) => prev.filter((h) => h !== hour));
  };

  const handleSelectDurationMode = (mode: DurationMode) => {
    setDurationMode(mode);
    setClampedNotice(null);
    if (mode === 'treatment') {
      setFechaInicio(medBounds.minDate);
      setFechaFin(medBounds.maxDate);
    } else if (mode === 'days') {
      const days = selectedDurationDays ?? 7;
      setSelectedDurationDays(days);
      const start = fechaInicio ?? medBounds.defaultStartDate;
      const applied = applyInclusiveDurationWithBounds(start, days, medBounds);
      setFechaInicio(start);
      setFechaFin(applied.fechaFin);
      if (applied.clampedToMedicationEnd) {
        setClampedNotice(
          `La fecha de término se ajustó al fin del tratamiento (${applied.fechaFin}).`,
        );
      }
    } else {
      const start = fechaInicio ?? medBounds.defaultStartDate;
      setFechaInicio(start);
      if (!fechaFin || fechaFin < start) {
        const applied = applyInclusiveDurationWithBounds(start, 7, medBounds);
        setFechaFin(applied.fechaFin);
      }
    }
  };

  const handleSelectDurationPreset = (days: number) => {
    setDurationMode('days');
    setSelectedDurationDays(days);
    const start = fechaInicio ?? medBounds.defaultStartDate;
    const applied = applyInclusiveDurationWithBounds(start, days, medBounds);
    setFechaInicio(start);
    setFechaFin(applied.fechaFin);
    if (applied.clampedToMedicationEnd) {
      setClampedNotice(
        `La fecha de término se ajustó al fin del tratamiento (${applied.fechaFin}).`,
      );
    } else {
      setClampedNotice(null);
    }
  };

  const handleSave = async () => {
    if (!repository || !database || !patientId || saving) return;
    setErrorMsg(null);

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

    const effectiveStart =
      tipo === 'medicacion'
        ? durationMode === 'treatment'
          ? medBounds.minDate
          : fechaInicio
        : fechaInicio;
    const effectiveEnd =
      tipo === 'medicacion'
        ? durationMode === 'treatment'
          ? medBounds.maxDate
          : fechaFin
        : fechaFin;

    const dateError = validateReminderDateRange(
      effectiveStart,
      effectiveEnd,
      tipo === 'medicacion' ? medBounds : null,
    );
    if (dateError) {
      setErrorMsg(dateError);
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
          fechaInicio: effectiveStart,
          fechaFin: effectiveEnd,
          habilitado,
        });

        bumpRemindersRevision?.();

        if (reconcileReminders) {
          await reconcileReminders(patientId);
        } else if (coordinator) {
          await coordinator.reconcile(patientId, () => true);
        }
      });
      setSaving(false);
      router.back();
    } catch (err) {
      setSaving(false);
      setErrorMsg((err as Error).message);
    }
  };

  const handleDelete = async () => {
    if (!repository || !database || !patientId || !id || saving) return;
    setSaving(true);
    try {
      await trackOperation(async () => {
        await repository.reminders.deleteRule(id);
        bumpRemindersRevision?.();
        if (reconcileReminders) {
          await reconcileReminders(patientId);
        } else if (coordinator) {
          await coordinator.reconcile(patientId, () => true);
        }
      });
      setSaving(false);
      router.back();
    } catch (err) {
      setSaving(false);
      setErrorMsg((err as Error).message);
    }
  };

  const hasPreboundMedication =
    tipo === 'medicacion' &&
    Boolean(selectedMedication) &&
    (Boolean(paramMedicamentoId) || isEditing);

  const screenTitle = isEditing
    ? 'Editar recordatorio'
    : tipo === 'medicacion'
      ? 'Horario de medicamento'
      : 'Nuevo recordatorio';

  return (
    <Screen title={screenTitle}>
      <DemoBadge />

      {errorMsg ? (
        <InfoCard>
          <View style={styles.errorHeader}>
            <Feather name="alert-circle" size={20} color="#dc2626" />
            <Text style={[styles.heading, { color: '#dc2626' }]}>Revisa la configuración</Text>
          </View>
          <BodyText style={{ color: '#dc2626' }}>{errorMsg}</BodyText>
        </InfoCard>
      ) : null}

      {/* Selector de tipo cuando no viene fijado por medicamento preseleccionado */}
      {!hasPreboundMedication && !isEditing ? (
        <InfoCard>
          <SectionTitle>¿Qué deseas recordar?</SectionTitle>
          <View style={styles.optionsGroup}>
            <Pressable
              accessibilityRole="radio"
              accessibilityLabel="Registro de signos vitales"
              accessibilityState={{ selected: tipo === 'registro_vitales' }}
              onPress={() => {
                setTipo('registro_vitales');
                if (selectedHours.length === 0) setSelectedHours([DEFAULT_VITAL_TIME]);
              }}
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
              onPress={() => {
                setTipo('medicacion');
                handleSelectMedicationTemplate('morning');
              }}
              style={[styles.typeOption, tipo === 'medicacion' && styles.typeOptionSelected]}
            >
              <Feather
                name="clock"
                size={22}
                color={tipo === 'medicacion' ? appTheme.colors.primary : appTheme.colors.secondary}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.optionTitle}>Medicación</Text>
                <Text style={styles.optionSubtitle}>Aviso para tus medicamentos</Text>
              </View>
            </Pressable>
          </View>
        </InfoCard>
      ) : null}

      {/* FLUJO MEDICACIÓN: Encabezado clínico en solo lectura o selector explícito si falta medicamentoId */}
      {tipo === 'medicacion' ? (
        hasPreboundMedication && selectedMedication ? (
          <InfoCard>
            <SectionTitle>Medicamento</SectionTitle>
            <Text style={styles.medTitle}>{selectedMedication.nombre}</Text>
            {selectedMedication.dosis || selectedMedication.frecuencia ? (
              <BodyText>
                {[
                  selectedMedication.dosis ? `Dosis: ${selectedMedication.dosis}` : null,
                  selectedMedication.frecuencia ? `Pauta: ${selectedMedication.frecuencia}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </BodyText>
            ) : null}
            {medBounds.minDate || medBounds.maxDate ? (
              <BodyText style={{ fontSize: 13 }}>
                Vigencia indicada:{' '}
                {medBounds.minDate ? `Desde ${formatDate(medBounds.minDate)}` : 'Activo'}
                {medBounds.maxDate ? ` hasta ${formatDate(medBounds.maxDate)}` : ''}
              </BodyText>
            ) : null}
          </InfoCard>
        ) : (
          <InfoCard>
            <SectionTitle>Medicamento vinculado</SectionTitle>
            <BodyText>
              Selecciona el medicamento de tu tratamiento para configurar sus horarios de aviso.
            </BodyText>
            {medicationsLoaded && medications.length === 0 ? (
              <BodyText style={{ color: '#b45309' }}>
                Aún no hay medicamentos disponibles en tu perfil.
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
                        {med.dosis || med.frecuencia ? (
                          <Text style={styles.medSubtitle}>
                            Dosis: {med.dosis} · Pauta: {med.frecuencia}
                          </Text>
                        ) : null}
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
        )
      ) : null}

      {/* FLUJO MEDICIONES: Configuración rápida desde las 07:00 */}
      {tipo === 'registro_vitales' ? (
        <InfoCard>
          <SectionTitle>Horario de medición</SectionTitle>
          <BodyText>
            Elige la hora en que prefieres recibir el recordatorio diario para registrar tu
            temperatura y pulso.
          </BodyText>

          <DateTimePickerField
            mode="time"
            label="Hora del aviso"
            accessibilityLabel="Seleccionar hora del aviso de medición"
            value={selectedHours[0] ?? DEFAULT_VITAL_TIME}
            onChange={(nextTime) => handleUpdateHourAtIndex(0, nextTime)}
          />

          <View style={styles.frequencyRow}>
            <Pressable
              accessibilityRole="radio"
              accessibilityLabel="Todos los días"
              accessibilityState={{ selected: !vitalCustomized }}
              onPress={() => {
                setVitalCustomized(false);
                setSelectedDays([...ALL_WEEK_DAYS]);
                setSelectedHours((prev) => [prev[0] ?? DEFAULT_VITAL_TIME]);
                setFechaInicio(null);
                setFechaFin(null);
              }}
              style={[styles.freqOption, !vitalCustomized && styles.freqOptionSelected]}
            >
              <Text
                style={[styles.freqOptionText, !vitalCustomized && styles.freqOptionTextSelected]}
              >
                Todos los días
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="radio"
              accessibilityLabel="Personalizar"
              accessibilityState={{ selected: vitalCustomized }}
              onPress={() => setVitalCustomized(true)}
              style={[styles.freqOption, vitalCustomized && styles.freqOptionSelected]}
            >
              <Text
                style={[styles.freqOptionText, vitalCustomized && styles.freqOptionTextSelected]}
              >
                Personalizar
              </Text>
            </Pressable>
          </View>

          {vitalCustomized ? (
            <View style={styles.customSection}>
              <Text style={styles.subheading}>Días de la semana</Text>
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
                      <Text
                        style={[styles.dayButtonText, isSelected && styles.dayButtonTextSelected]}
                      >
                        {day.short}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {selectedHours.length > 1 ? (
                <View style={{ marginTop: theme.spacing.sm, gap: theme.spacing.xs }}>
                  <Text style={styles.subheading}>Horarios adicionales</Text>
                  {selectedHours.slice(1).map((hour, idx) => (
                    <View key={`${hour}-${idx}`} style={styles.extraHourRow}>
                      <View style={{ flex: 1 }}>
                        <DateTimePickerField
                          mode="time"
                          label={`Horario ${idx + 2}`}
                          value={hour}
                          onChange={(nextTime) => handleUpdateHourAtIndex(idx + 1, nextTime)}
                        />
                      </View>
                      <VisualButton label="Quitar" secondary onPress={() => removeHour(hour)} />
                    </View>
                  ))}
                </View>
              ) : null}

              <VisualButton
                label="Añadir otro horario en el día"
                secondary
                onPress={handleAddAnotherHour}
              />
            </View>
          ) : null}
        </InfoCard>
      ) : null}

      {/* FLUJO MEDICACIÓN: Plantillas desde las 07:00 y Duración inclusiva */}
      {tipo === 'medicacion' ? (
        <>
          <InfoCard>
            <SectionTitle>Horarios diarios</SectionTitle>
            <BodyText>
              Elige una pauta sugerida desde las 07:00 o personaliza las horas según la indicación
              de tu equipo de salud.
            </BodyText>

            <View style={styles.optionsGroup}>
              {MEDICATION_SCHEDULE_TEMPLATES.map((tpl) => {
                const selected = medTemplate === tpl.id;
                return (
                  <Pressable
                    key={tpl.id}
                    accessibilityRole="radio"
                    accessibilityLabel={tpl.label}
                    accessibilityState={{ selected }}
                    onPress={() => handleSelectMedicationTemplate(tpl.id)}
                    style={[styles.typeOption, selected && styles.typeOptionSelected]}
                  >
                    <Feather
                      name={selected ? 'check-circle' : 'circle'}
                      size={22}
                      color={selected ? appTheme.colors.primary : appTheme.colors.secondary}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.optionTitle}>{tpl.label}</Text>
                      <Text style={styles.optionSubtitle}>{tpl.subtitle}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.customSection}>
              <Text style={styles.subheading}>Horas de aviso seleccionadas</Text>
              {selectedHours.map((hour, index) => (
                <View key={`med-hour-${index}`} style={styles.extraHourRow}>
                  <View style={{ flex: 1 }}>
                    <DateTimePickerField
                      mode="time"
                      label={`Toma ${index + 1}`}
                      accessibilityLabel={`Seleccionar hora toma ${index + 1}`}
                      value={hour}
                      onChange={(nextTime) => handleUpdateHourAtIndex(index, nextTime)}
                    />
                  </View>
                  {selectedHours.length > 1 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Eliminar hora ${hour}`}
                      onPress={() => removeHour(hour)}
                      style={styles.removeHourBtn}
                    >
                      <Feather name="trash-2" size={18} color="#dc2626" />
                    </Pressable>
                  ) : null}
                </View>
              ))}

              {medTemplate === 'custom' ? (
                <>
                  <VisualButton label="Añadir otra hora" secondary onPress={handleAddAnotherHour} />
                  <Text style={[styles.subheading, { marginTop: theme.spacing.sm }]}>
                    Días de la semana
                  </Text>
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
                          <Text
                            style={[
                              styles.dayButtonText,
                              isSelected && styles.dayButtonTextSelected,
                            ]}
                          >
                            {day.short}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : null}
            </View>
          </InfoCard>

          <InfoCard>
            <SectionTitle>Duración del recordatorio</SectionTitle>
            <BodyText>Define por cuántos días deseas recibir estos avisos.</BodyText>

            <View style={styles.optionsGroup}>
              <Pressable
                accessibilityRole="radio"
                accessibilityLabel="Durante todo el tratamiento"
                accessibilityState={{ selected: durationMode === 'treatment' }}
                onPress={() => handleSelectDurationMode('treatment')}
                style={[
                  styles.typeOption,
                  durationMode === 'treatment' && styles.typeOptionSelected,
                ]}
              >
                <Feather
                  name={durationMode === 'treatment' ? 'check-circle' : 'circle'}
                  size={20}
                  color={
                    durationMode === 'treatment'
                      ? appTheme.colors.primary
                      : appTheme.colors.secondary
                  }
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionTitle}>Durante todo el tratamiento</Text>
                  <Text style={styles.optionSubtitle}>
                    {medBounds.maxDate
                      ? `Hasta el ${formatDate(medBounds.maxDate)}`
                      : 'Mientras el medicamento permanezca activo'}
                  </Text>
                </View>
              </Pressable>

              <Pressable
                accessibilityRole="radio"
                accessibilityLabel="Por cantidad de días"
                accessibilityState={{ selected: durationMode === 'days' }}
                onPress={() => handleSelectDurationMode('days')}
                style={[styles.typeOption, durationMode === 'days' && styles.typeOptionSelected]}
              >
                <Feather
                  name={durationMode === 'days' ? 'check-circle' : 'circle'}
                  size={20}
                  color={
                    durationMode === 'days' ? appTheme.colors.primary : appTheme.colors.secondary
                  }
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionTitle}>Por cantidad de días</Text>
                  <Text style={styles.optionSubtitle}>
                    Calcula automáticamente la fecha de término inclusiva
                  </Text>
                </View>
              </Pressable>

              <Pressable
                accessibilityRole="radio"
                accessibilityLabel="Elegir fechas de inicio y fin"
                accessibilityState={{ selected: durationMode === 'custom_dates' }}
                onPress={() => handleSelectDurationMode('custom_dates')}
                style={[
                  styles.typeOption,
                  durationMode === 'custom_dates' && styles.typeOptionSelected,
                ]}
              >
                <Feather
                  name={durationMode === 'custom_dates' ? 'check-circle' : 'circle'}
                  size={20}
                  color={
                    durationMode === 'custom_dates'
                      ? appTheme.colors.primary
                      : appTheme.colors.secondary
                  }
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.optionTitle}>Elegir fechas</Text>
                  <Text style={styles.optionSubtitle}>Seleccionar fecha de inicio y término</Text>
                </View>
              </Pressable>
            </View>

            {durationMode === 'days' ? (
              <View style={styles.customSection}>
                <Text style={styles.subheading}>Selecciona la duración en días:</Text>
                <View style={styles.hoursGrid}>
                  {INCLUSIVE_DURATION_PRESETS.map((days) => {
                    const isSelected = selectedDurationDays === days;
                    return (
                      <Pressable
                        key={days}
                        accessibilityRole="button"
                        accessibilityLabel={`Duración ${days} días`}
                        accessibilityState={{ selected: isSelected }}
                        onPress={() => handleSelectDurationPreset(days)}
                        style={[styles.hourPill, isSelected && styles.hourPillSelected]}
                      >
                        <Text style={[styles.hourText, isSelected && styles.hourTextSelected]}>
                          {days} días
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {fechaInicio && fechaFin ? (
                  <BodyText style={{ fontWeight: '600', color: appTheme.colors.primary }}>
                    Vigencia resultante: Desde {fechaInicio} hasta {fechaFin}
                  </BodyText>
                ) : null}
                {clampedNotice ? (
                  <BodyText style={{ color: '#b45309', fontSize: 13 }}>{clampedNotice}</BodyText>
                ) : null}
              </View>
            ) : null}

            {durationMode === 'custom_dates' ? (
              <View style={styles.customSection}>
                <DateTimePickerField
                  mode="date"
                  label="Fecha de inicio"
                  accessibilityLabel="Seleccionar fecha de inicio"
                  value={fechaInicio}
                  minimumDate={medBounds.minDate}
                  maximumDate={medBounds.maxDate}
                  onChange={(nextStart) => {
                    setFechaInicio(nextStart);
                    if (fechaFin && fechaFin < nextStart) {
                      setFechaFin(nextStart);
                    }
                  }}
                />
                <DateTimePickerField
                  mode="date"
                  label="Fecha de término"
                  accessibilityLabel="Seleccionar fecha de término"
                  value={fechaFin}
                  minimumDate={fechaInicio ?? medBounds.minDate}
                  maximumDate={medBounds.maxDate}
                  onChange={(nextEnd) => setFechaFin(nextEnd)}
                />
              </View>
            ) : null}
          </InfoCard>
        </>
      ) : null}

      {/* Opción para guardar pausado cuando se edita o en opciones avanzadas */}
      <InfoCard>
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel="Habilitar este recordatorio"
          accessibilityState={{ checked: habilitado }}
          onPress={() => setHabilitado((prev) => !prev)}
          style={styles.toggleRow}
        >
          <View style={{ flex: 1, paddingRight: theme.spacing.sm }}>
            <Text style={styles.heading}>Activar al guardar</Text>
            <BodyText>
              {habilitado
                ? 'Se activará y programará los próximos avisos al guardar.'
                : 'Se guardará pausado sin emitir avisos por ahora.'}
            </BodyText>
          </View>
          <Feather
            name={habilitado ? 'toggle-right' : 'toggle-left'}
            size={32}
            color={habilitado ? appTheme.colors.primary : appTheme.colors.secondary}
          />
        </Pressable>
      </InfoCard>

      {/* Botones de acción */}
      <View style={styles.actions}>
        <VisualButton
          label={saving ? 'Guardando...' : habilitado ? 'Guardar y activar' : 'Guardar sin activar'}
          onPress={() => void handleSave()}
          disabled={saving}
        />
        {isEditing ? (
          <VisualButton
            label="Eliminar recordatorio"
            secondary
            onPress={() => void handleDelete()}
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
      color: colors.text,
    },
    subheading: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
      marginBottom: theme.spacing.xs,
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 48,
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
      minHeight: 48,
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
      minHeight: 48,
    },
    medOptionSelected: {
      borderColor: colors.primary,
    },
    medTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    medSubtitle: {
      fontSize: 13,
      color: colors.secondary,
      marginTop: 2,
    },
    frequencyRow: {
      flexDirection: 'row',
      gap: theme.spacing.sm,
      marginTop: theme.spacing.xs,
    },
    freqOption: {
      flex: 1,
      minHeight: 46,
      borderRadius: theme.radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing.sm,
    },
    freqOptionSelected: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    freqOptionText: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    freqOptionTextSelected: {
      color: '#ffffff',
    },
    customSection: {
      marginTop: theme.spacing.md,
      gap: theme.spacing.sm,
      paddingTop: theme.spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    extraHourRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    removeHourBtn: {
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      padding: theme.spacing.xs,
    },
    daysRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: theme.spacing.xs,
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
      marginTop: theme.spacing.xs,
    },
    hourPill: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      minHeight: 44,
      justifyContent: 'center',
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
