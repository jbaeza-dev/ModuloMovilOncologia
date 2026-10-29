import { describe, expect, it } from 'vitest';
import type { VitalWithSyncRecord } from '../../data/local/repository';
import {
  formatRecordTime,
  formatVitalCardAccessibilityLabel,
  formatVitalsSummary,
  getDaySectionTitle,
  groupVitalsByDay,
} from './vitals-formatters';

describe('vitals-formatters', () => {
  const baseRecord: VitalWithSyncRecord = {
    id: 'vital-1',
    paciente_id: 'paciente-demo-001',
    fecha_registro: '2026-10-17T13:30:00.000Z',
    temperatura: null,
    presion_sistolica: null,
    presion_diastolica: null,
    pulso: null,
    saturacion_o2: null,
    fecha_subida: null,
    estado_envio: 'pendiente',
  };

  describe('formatVitalsSummary', () => {
    it('muestra una presión aislada sin ocultarla ni inventar la otra', () => {
      expect(formatVitalsSummary({ ...baseRecord, presion_sistolica: 120 })).toBe(
        'Presión sistólica: 120 mmHg',
      );
      expect(formatVitalsSummary({ ...baseRecord, presion_diastolica: 80 })).toBe(
        'Presión diastólica: 80 mmHg',
      );
    });

    it('construye resumen para solo presión arterial', () => {
      const summary = formatVitalsSummary({
        ...baseRecord,
        presion_sistolica: 120,
        presion_diastolica: 80,
      });
      expect(summary).toBe('Presión: 120/80 mmHg');
    });

    it('construye resumen para temperatura y pulso con coma decimal', () => {
      const summary = formatVitalsSummary({
        ...baseRecord,
        temperatura: 36.8,
        pulso: 72,
      });
      expect(summary).toBe('Temperatura: 36,8 °C · Pulso: 72 latidos/min');
    });

    it('construye resumen para solo saturación', () => {
      const summary = formatVitalsSummary({
        ...baseRecord,
        saturacion_o2: 98,
      });
      expect(summary).toBe('Saturación: 98 %');
    });

    it('construye resumen completo cuando todas las mediciones están presentes', () => {
      const summary = formatVitalsSummary({
        temperatura: 36.5,
        presion_sistolica: 118,
        presion_diastolica: 78,
        pulso: 70,
        saturacion_o2: 99,
      });
      expect(summary).toBe(
        'Presión: 118/78 mmHg · Temperatura: 36,5 °C · Pulso: 70 latidos/min · Saturación: 99 %',
      );
    });

    it('devuelve mensaje descriptivo si no hay mediciones presentes', () => {
      expect(formatVitalsSummary(baseRecord)).toBe('Sin mediciones registradas');
    });
  });

  describe('formatRecordTime', () => {
    it('formatea la hora en formato 24h para America/Santiago', () => {
      // 2026-10-17T13:30:00Z en Chile (UTC-3 en horario de verano) -> 10:30
      const timeStr = formatRecordTime('2026-10-17T13:30:00.000Z', 'America/Santiago');
      expect(timeStr).toBe('10:30');
    });
  });

  describe('getDaySectionTitle', () => {
    const nowIso = '2026-10-17T15:00:00.000Z'; // 2026-10-17 en Chile

    it('devuelve Hoy para la fecha actual', () => {
      expect(getDaySectionTitle('2026-10-17', nowIso, 'America/Santiago')).toBe('Hoy');
    });

    it('devuelve Ayer para el día anterior', () => {
      expect(getDaySectionTitle('2026-10-16', nowIso, 'America/Santiago')).toBe('Ayer');
    });

    it('devuelve fecha formateada DD/MM/YYYY para fechas anteriores', () => {
      expect(getDaySectionTitle('2026-10-15', nowIso, 'America/Santiago')).toBe('15/10/2026');
    });

    it('devuelve Ayer correctamente alrededor del cambio de hora de Chile (DST)', () => {
      // El 7 de septiembre de 2026 a las 00:30 en Santiago (UTC-3 tras adelanto DST) -> 2026-09-07T03:30:00.000Z
      const dstTransitionNow = '2026-09-07T03:30:00.000Z';
      expect(getDaySectionTitle('2026-09-06', dstTransitionNow, 'America/Santiago')).toBe('Ayer');
      expect(getDaySectionTitle('2026-09-05', dstTransitionNow, 'America/Santiago')).toBe(
        '05/09/2026',
      );
    });
  });

  describe('groupVitalsByDay', () => {
    const nowIso = '2026-10-17T15:00:00.000Z';

    it('agrupa por fecha civil, deduplica por ID y ordena descendente', () => {
      const records: VitalWithSyncRecord[] = [
        {
          ...baseRecord,
          id: 'v-today-1',
          fecha_registro: '2026-10-17T12:00:00.000Z',
          temperatura: 36.6,
        },
        {
          ...baseRecord,
          id: 'v-today-2',
          fecha_registro: '2026-10-17T14:00:00.000Z',
          pulso: 75,
        },
        {
          ...baseRecord,
          id: 'v-today-1', // Duplicado de ID
          fecha_registro: '2026-10-17T12:00:00.000Z',
          temperatura: 36.6,
        },
        {
          ...baseRecord,
          id: 'v-yesterday',
          fecha_registro: '2026-10-16T12:00:00.000Z',
          saturacion_o2: 97,
        },
        {
          ...baseRecord,
          id: 'v-older',
          fecha_registro: '2026-10-10T12:00:00.000Z',
          presion_sistolica: 120,
          presion_diastolica: 80,
        },
      ];

      const sections = groupVitalsByDay(records, nowIso, 'America/Santiago');

      expect(sections).toHaveLength(3);

      expect(sections[0].title).toBe('Hoy');
      expect(sections[0].data).toHaveLength(2);
      expect(sections[0].data[0].id).toBe('v-today-2'); // 14:00 antes de 12:00
      expect(sections[0].data[1].id).toBe('v-today-1');

      expect(sections[1].title).toBe('Ayer');
      expect(sections[1].data).toHaveLength(1);
      expect(sections[1].data[0].id).toBe('v-yesterday');

      expect(sections[2].title).toBe('10/10/2026');
      expect(sections[2].data).toHaveLength(1);
      expect(sections[2].data[0].id).toBe('v-older');
    });
  });

  describe('formatVitalCardAccessibilityLabel', () => {
    it('anuncia la captura SDK pendiente sin confundirla con un registro solo local', () => {
      const record: VitalWithSyncRecord = {
        ...baseRecord,
        id: 'sdk-pending',
        fecha_registro: '2026-10-17T13:30:00.000Z',
        temperatura: 36.5,
        estado_envio: 'pendiente',
        gestor_envio: 'powersync',
      };
      const label = formatVitalCardAccessibilityLabel(
        record,
        '2026-10-17T15:00:00.000Z',
        'America/Santiago',
      );
      expect(label).toContain('Guardado · Pendiente de envío');
      expect(label).not.toContain('Aceptado por el servidor');
    });

    it('genera una etiqueta de accesibilidad completa y sin campos nulos', () => {
      const record: VitalWithSyncRecord = {
        ...baseRecord,
        id: 'v-1',
        fecha_registro: '2026-10-17T13:30:00.000Z',
        temperatura: 36.8,
        pulso: 72,
        estado_envio: 'pendiente',
      };
      const label = formatVitalCardAccessibilityLabel(
        record,
        '2026-10-17T15:00:00.000Z',
        'America/Santiago',
      );
      expect(label).toContain('Hoy a las 10:30');
      expect(label).toContain('Temperatura: 36,8 °C · Pulso: 72 latidos/min');
      expect(label).toContain('Guardado en este dispositivo');
      expect(label).not.toContain('Sin registro');
    });
  });
});
