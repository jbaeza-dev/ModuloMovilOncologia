import { describe, expect, it } from 'vitest';
import type { GatewayRecordatorio } from '../src/generated-gateway.js';
import {
  agendaDate,
  agendaInstant,
  normalizedReminder,
  parseOccurrenceId,
  reminderOccurrence,
  upcomingAgendaOccurrences,
  validReminderDates,
} from '../src/agenda.js';

const rule: GatewayRecordatorio = {
  id: '12345678-1111-4111-8111-123456789012',
  tipo: 'signos',
  titulo: 'Mi horario',
  zona_horaria: 'America/Santiago',
  horas: ['08:00'],
  dias_semana: [1, 2, 3, 4, 5, 6, 7],
  fecha_inicio: '2026-01-01',
  fecha_fin: null,
  activo: true,
  version: 1,
  creado_en: '2026-01-01T00:00:00Z',
  actualizado_en: '2026-01-01T00:00:00Z',
  canal: 'push_con_respaldo_local',
  respaldo_segundos: 120,
};

describe('Agenda civil compartida por servidor y Android', () => {
  it.each([
    ['2026-10-29', '08:00', '2026-10-29T11:00:00.000Z'],
    ['2026-07-01', '08:00', '2026-07-01T12:00:00.000Z'],
    ['2026-04-04', '23:30', '2026-04-05T02:30:00.000Z'],
    ['2026-09-06', '00:30', '2026-09-06T04:00:00.000Z'],
  ])(
    'resuelve %s %s con zona, primer instante ambiguo y primer minuto válido',
    (date, time, utc) => {
      expect(agendaInstant(date, time)).toBe(utc);
    },
  );
  it('conserva la identidad civil solicitada durante el salto DST', () => {
    const occurrence = reminderOccurrence({ ...rule, horas: ['00:30'] }, '2026-09-06', '00:30')!;
    expect(occurrence.ocurrencia_id).toBe(`${rule.id}:1:2026-09-06:0030`);
    expect(occurrence.respaldo_en).toBe('2026-09-06T04:02:00.000Z');
    expect(parseOccurrenceId(occurrence.ocurrencia_id)).toEqual({
      id: rule.id,
      version: 1,
      date: '2026-09-06',
      time: '00:30',
    });
  });
  it('deriva el día en Santiago y rechaza fechas imposibles o fin anterior', () => {
    expect(agendaDate('2026-10-29T01:00:00Z')).toBe('2026-10-28');
    expect(validReminderDates({ ...rule, fecha_fin: '2025-12-31' })).toBe(false);
    expect(() => agendaInstant('2026-02-30', '08:00')).toThrow();
    expect(parseOccurrenceId(`${rule.id}:1:2026-02-30:0800`)).toBeNull();
  });
  it('conserva título y significado al ordenar horas y días', () => {
    const normalized = normalizedReminder({
      ...rule,
      titulo: '  Mi horario  ',
      horas: ['15:00', '08:00'],
      dias_semana: [7, 1],
    });
    expect(normalized.horas).toEqual(['08:00', '15:00']);
    expect(normalized.dias_semana).toEqual([1, 7]);
    expect(normalized.titulo).toBe('  Mi horario  ');
  });
  it('omite pausados, fechas ajenas y el tipo cumplido; conserva medicación', () => {
    const now = '2026-10-29T10:00:00Z';
    const medication = {
      ...rule,
      id: '12345678-2222-4222-8222-123456789012',
      tipo: 'medicacion' as const,
    };
    const list = upcomingAgendaOccurrences([rule, medication], now, new Set(['signos:2026-10-29']));
    expect(
      list.occurrences.filter((x) => x.fecha_local === '2026-10-29').map((x) => x.tipo_registro),
    ).toEqual(['medicacion']);
    expect(upcomingAgendaOccurrences([{ ...rule, activo: false }], now).total).toBe(0);
    expect(reminderOccurrence(rule, '2025-12-31', '08:00')).toBeNull();
  });
  it('conserva las 64 más próximas y el respaldo de la ocurrencia nominal recién pasada', () => {
    const many = {
      ...rule,
      horas: ['01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00', '08:00'],
    };
    const list = upcomingAgendaOccurrences([many], '2026-10-29T03:00:00Z');
    expect(list.total).toBe(112);
    expect(list.occurrences).toHaveLength(64);
    expect(list.truncated).toBe(48);
    const late = upcomingAgendaOccurrences([rule], '2026-10-29T11:01:00Z');
    expect(late.occurrences[0]?.respaldo_en).toBe('2026-10-29T11:02:00.000Z');
  });
});
