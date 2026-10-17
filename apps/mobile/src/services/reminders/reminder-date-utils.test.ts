import { describe, expect, it } from 'vitest';

import {
  addCivilDays,
  applyInclusiveDurationWithBounds,
  calculateInclusiveEndDate,
  DEFAULT_VITAL_TIME,
  detectMedicationTemplate,
  getInclusiveDaysBetween,
  isValidCivilDate,
  isValidTimeHhMm,
  MEDICATION_SCHEDULE_TEMPLATES,
  resolveMedicationDateBounds,
  validateReminderDateRange,
} from './reminder-date-utils';
import { formatCivilDateDisplay, formatCoverageDateDisplay } from './reminder-status';

describe('reminder-date-utils (fechas civiles, duración inclusiva y plantillas desde 07:00)', () => {
  it('T-14: valida fechas civiles reales incluyendo años bisiestos y rechaza fechas inexistentes', () => {
    expect(isValidCivilDate('2026-10-16')).toBe(true);
    expect(isValidCivilDate('2028-02-29')).toBe(true); // 2028 es bisiesto
    expect(isValidCivilDate('2026-02-29')).toBe(false); // 2026 no es bisiesto
    expect(isValidCivilDate('2026-02-30')).toBe(false);
    expect(isValidCivilDate('2026-13-01')).toBe(false);
    expect(isValidCivilDate('16-10-2026')).toBe(false);
  });

  it('T-14: calcula fechaFin inclusiva exactamente como addCivilDays(fechaInicio, cantidadDias - 1)', () => {
    // 7 días desde 2026-10-16 -> 2026-10-22 (16, 17, 18, 19, 20, 21 y 22)
    expect(calculateInclusiveEndDate('2026-10-16', 7)).toBe('2026-10-22');
    expect(getInclusiveDaysBetween('2026-10-16', '2026-10-22')).toBe(7);

    // 1 día desde 2026-10-16 -> 2026-10-16
    expect(calculateInclusiveEndDate('2026-10-16', 1)).toBe('2026-10-16');
    expect(getInclusiveDaysBetween('2026-10-16', '2026-10-16')).toBe(1);

    // Cruce de fin de mes (5 días desde 2026-10-29 -> 2026-11-02)
    expect(calculateInclusiveEndDate('2026-10-29', 5)).toBe('2026-11-02');
    expect(addCivilDays('2026-10-29', 4)).toBe('2026-11-02');
  });

  it('T-14: acota la duración inclusiva al término del medicamento y rechaza fechaFin < fechaInicio', () => {
    const bounds = resolveMedicationDateBounds(
      { fecha_inicio: '2026-10-15', fecha_fin: '2026-10-20' },
      '2026-10-16',
    );
    expect(bounds.minDate).toBe('2026-10-15');
    expect(bounds.maxDate).toBe('2026-10-20');
    expect(bounds.defaultStartDate).toBe('2026-10-16');

    const applied = applyInclusiveDurationWithBounds('2026-10-16', 7, bounds);
    expect(applied.fechaFin).toBe('2026-10-20');
    expect(applied.clampedToMedicationEnd).toBe(true);

    expect(validateReminderDateRange('2026-10-18', '2026-10-16', bounds)).toContain(
      'no puede ser anterior',
    );
    expect(validateReminderDateRange('2026-10-14', '2026-10-18', bounds)).toContain(
      'inicio del tratamiento',
    );
    expect(validateReminderDateRange('2026-10-16', '2026-10-25', bounds)).toContain(
      'fin del tratamiento',
    );
    expect(validateReminderDateRange('2026-10-16', '2026-10-20', bounds)).toBeNull();
  });

  it('define plantillas desde las 07:00 para signos vitales y medicamentos', () => {
    expect(DEFAULT_VITAL_TIME).toBe('07:00');
    expect(MEDICATION_SCHEDULE_TEMPLATES.map((t) => [t.id, t.hours])).toEqual([
      ['morning', ['07:00']],
      ['twice_daily', ['07:00', '19:00']],
      ['three_daily', ['07:00', '15:00', '23:00']],
      ['custom', []],
    ]);

    expect(detectMedicationTemplate(['07:00'], [1, 2, 3, 4, 5, 6, 7], false)).toBe('morning');
    expect(detectMedicationTemplate(['07:00', '19:00'], [1, 2, 3, 4, 5, 6, 7], false)).toBe(
      'twice_daily',
    );
    expect(
      detectMedicationTemplate(['07:00', '15:00', '23:00'], [1, 2, 3, 4, 5, 6, 7], false),
    ).toBe('three_daily');
    expect(detectMedicationTemplate(['08:00'], [1, 2, 3, 4, 5, 6, 7], false)).toBe('custom');
    expect(isValidTimeHhMm('07:00')).toBe(true);
    expect(isValidTimeHhMm('24:00')).toBe(false);
  });

  it('formatea fechas civiles de inicio y fin sin desplazar días en zona horaria de Chile (America/Santiago)', () => {
    // 2026-10-17 en America/Santiago (UTC-3) no debe convertirse a 16-10-2026, 21:00
    expect(formatCivilDateDisplay('2026-10-17')).toBe('17/10/2026');
    expect(formatCivilDateDisplay('2026-10-01')).toBe('01/10/2026');
    expect(formatCivilDateDisplay('2026-12-31')).toBe('31/12/2026');
    expect(formatCivilDateDisplay('2027-01-01')).toBe('01/01/2027');

    // Fechas no estándar se retornan intactas
    expect(formatCivilDateDisplay('no-es-fecha')).toBe('no-es-fecha');

    // formatCoverageDateDisplay formatea el instante UTC al día civil en America/Santiago
    // 2026-10-17T03:00:00.000Z es medianoche en Chile (UTC-3 -> 00:00 del 17 de octubre)
    expect(formatCoverageDateDisplay('2026-10-17T03:00:00.000Z', 'America/Santiago')).toBe(
      '17/10/2026',
    );
    // 2026-10-17T02:59:59.000Z es 23:59:59 del 16 de octubre en Chile
    expect(formatCoverageDateDisplay('2026-10-17T02:59:59.000Z', 'America/Santiago')).toBe(
      '16/10/2026',
    );
  });
});
