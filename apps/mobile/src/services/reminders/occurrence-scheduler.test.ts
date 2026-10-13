import { describe, expect, it } from 'vitest';

import type { ReminderRule } from '../../data/local/reminders/reminder-types';
import {
  calculateOccurrences,
  civilToUtcIso,
  type MedicationContext,
} from './occurrence-scheduler';

describe('OccurrenceScheduler', () => {
  const fakeRule = (overrides: Partial<ReminderRule> = {}): ReminderRule => ({
    id: 'rule-test-1',
    pacienteId: 'patient-a',
    tipo: 'registro_vitales',
    medicamentoId: null,
    diasSemana: [1, 2, 3, 4, 5, 6, 7],
    horasMinutos: ['09:00'],
    zonaHoraria: 'America/Santiago',
    fechaInicio: null,
    fechaFin: null,
    habilitado: true,
    revision: 1,
    eliminadoEl: null,
    creadoEl: '2026-10-13T00:00:00Z',
    actualizadoEl: '2026-10-13T00:00:00Z',
    ...overrides,
  });

  it('no genera ocurrencias en horas pasadas del día actual y respeta now < fechaPrevistaUtc', () => {
    // Si en Santiago son las 10:30 del 13 de Octubre de 2026 (13:30 UTC con UTC-3)
    const now = new Date('2026-10-13T13:30:00Z');
    const rule = fakeRule({
      horasMinutos: ['08:00', '12:00'], // 08:00 ya pasó; 12:00 es futuro
    });

    const result = calculateOccurrences([rule], [], {
      now,
      zonaHoraria: 'America/Santiago',
      ventanaDias: 2, // ventana de 2 días que cubre completamente el día siguiente
    });

    // Para el día de hoy, solo 12:00 debe figurar; 08:00 no debe estar
    const hoyOcurrencias = result.seleccionadas.filter((c) => c.fechaCivilLocal === '2026-10-13');
    expect(hoyOcurrencias).toHaveLength(1);
    expect(hoyOcurrencias[0].horaMinutoLocal).toBe('12:00');

    // Para mañana (14 de octubre), ambas 08:00 y 12:00 deben figurar
    const mananaOcurrencias = result.seleccionadas.filter(
      (c) => c.fechaCivilLocal === '2026-10-14',
    );
    expect(mananaOcurrencias).toHaveLength(2);
  });

  it('respeta días de la semana ISO (1=Lunes .. 7=Domingo)', () => {
    // Supongamos un Lunes (2026-10-19 es Lunes) a las 00:00 UTC
    const now = new Date('2026-10-19T00:00:00Z');
    const rule = fakeRule({
      diasSemana: [1, 3, 5], // Lunes, Miércoles, Viernes
      horasMinutos: ['09:00'],
    });

    const result = calculateOccurrences([rule], [], {
      now,
      zonaHoraria: 'America/Santiago',
      ventanaDias: 7,
    });

    // 2026-10-19 (Lunes = 1), 2026-10-21 (Miércoles = 3), 2026-10-23 (Viernes = 5), 2026-10-26 (Lunes = 1)
    const fechas = result.seleccionadas.map((c) => c.fechaCivilLocal);
    expect(fechas).toContain('2026-10-19');
    expect(fechas).toContain('2026-10-21');
    expect(fechas).toContain('2026-10-23');
    expect(fechas).not.toContain('2026-10-20'); // Martes excluido
    expect(fechas).not.toContain('2026-10-22'); // Jueves excluido
  });

  it('filtra por límites de medicación y descarta medicamentos inactivos', () => {
    const now = new Date('2026-10-13T00:00:00Z');
    const medicationActive: MedicationContext = {
      id: 'med-ondansetron',
      nombre: 'Ondansetrón',
      fechaInicio: '2026-10-15',
      fechaFin: '2026-10-17',
      estadoActivo: true,
    };
    const medicationInactive: MedicationContext = {
      id: 'med-dexametasona',
      nombre: 'Dexametasona',
      fechaInicio: null,
      fechaFin: null,
      estadoActivo: false,
    };

    const ruleActive = fakeRule({
      id: 'rule-active',
      tipo: 'medicacion',
      medicamentoId: 'med-ondansetron',
      diasSemana: [1, 2, 3, 4, 5, 6, 7],
      horasMinutos: ['10:00'],
    });

    const ruleInactive = fakeRule({
      id: 'rule-inactive',
      tipo: 'medicacion',
      medicamentoId: 'med-dexametasona',
      diasSemana: [1, 2, 3, 4, 5, 6, 7],
      horasMinutos: ['10:00'],
    });

    const result = calculateOccurrences(
      [ruleActive, ruleInactive],
      [medicationActive, medicationInactive],
      { now, zonaHoraria: 'America/Santiago', ventanaDias: 14 },
    );

    // No debe haber ninguna ocurrencia de la medicación inactiva
    expect(result.seleccionadas.some((c) => c.recordatorioId === 'rule-inactive')).toBe(false);

    // La medicación activa solo debe tener ocurrencias entre 2026-10-15 y 2026-10-17
    const fechasActiva = result.seleccionadas
      .filter((c) => c.recordatorioId === 'rule-active')
      .map((c) => c.fechaCivilLocal);

    expect(fechasActiva).toEqual(['2026-10-15', '2026-10-16', '2026-10-17']);
  });

  it('aplica el límite de 128 trabajos y reporta truncamiento y reglas afectadas', () => {
    // 10 horas diarias por 14 días = 140 ocurrencias generadas
    const now = new Date('2026-10-13T00:00:00Z');
    const horas = [
      '07:00',
      '08:00',
      '09:00',
      '10:00',
      '11:00',
      '12:00',
      '13:00',
      '14:00',
      '15:00',
      '16:00',
    ];
    const ruleHeavy = fakeRule({
      id: 'rule-heavy',
      diasSemana: [1, 2, 3, 4, 5, 6, 7],
      horasMinutos: horas,
    });

    const result = calculateOccurrences([ruleHeavy], [], {
      now,
      zonaHoraria: 'America/Santiago',
      ventanaDias: 14,
      limiteTrabajos: 128,
    });

    expect(result.totalCalculadas).toBeGreaterThan(128);
    expect(result.seleccionadas).toHaveLength(128);
    expect(result.truncadas).toBe(result.totalCalculadas - 128);
    expect(result.cubiertoHastaIso).toBe(result.seleccionadas[127].fechaPrevistaUtc);
    expect(result.reglasAfectadas).toContain('rule-heavy');
  });

  it('maneja conversiones en America/Santiago deterministamente', () => {
    const utcIso = civilToUtcIso(2026, 10, 15, 9, 0, 'America/Santiago');
    // En octubre en Chile el huso horario es UTC-3 (horario de verano de Chile)
    expect(utcIso).toBe('2026-10-15T12:00:00.000Z');
  });

  it('aplica estrictamente la ventana de 14 días (regla diaria a las 21:00 produce exactamente 14 ocurrencias)', () => {
    // Si now es a las 10:00 del 13 de Octubre de 2026 en Santiago
    const now = new Date('2026-10-13T13:00:00Z');
    const dailyRule = fakeRule({
      diasSemana: [1, 2, 3, 4, 5, 6, 7],
      horasMinutos: ['21:00'],
    });

    const result = calculateOccurrences([dailyRule], [], {
      now,
      zonaHoraria: 'America/Santiago',
      ventanaDias: 14,
    });

    // Debe producir exactamente 14 ocurrencias (1 por día, descartando el día 14 a las 21:00 que supera finDeVentana a las 10:00)
    expect(result.seleccionadas).toHaveLength(14);
  });

  it('desplaza hora inexistente en cambio de horario de primavera (06-sept-2026 00:30 a 01:00 válido)', () => {
    // El 6 de septiembre de 2026 a medianoche, los relojes saltan de 23:59:59 a 01:00:00 (UTC-3)
    // 00:30 no existe en America/Santiago. El plan exige desplazarse al siguiente minuto válido (01:00:00 local = 04:00:00Z)
    const shiftedUtc = civilToUtcIso(2026, 9, 6, 0, 30, 'America/Santiago');
    expect(shiftedUtc).toBe('2026-09-06T04:00:00.000Z');
  });

  it('resuelve deterministamente horas repetidas en cambio de horario de otoño', () => {
    // El primer fin de semana de abril de 2026, los relojes retroceden 1 hora (de UTC-3 a UTC-4)
    // Una regla en el horario repetido debe generar una ocurrencia única y determinista
    const rule = fakeRule({
      diasSemana: [6, 7], // Sábado y Domingo
      horasMinutos: ['23:30'],
    });
    const now = new Date('2026-04-04T12:00:00Z');
    const result = calculateOccurrences([rule], [], {
      now,
      zonaHoraria: 'America/Santiago',
      ventanaDias: 3,
    });
    // Verifica que no haya duplicados para el mismo día
    const ocurrencias4Abril = result.seleccionadas.filter(
      (c) => c.fechaCivilLocal === '2026-04-04',
    );
    expect(ocurrencias4Abril).toHaveLength(1);
  });
});
