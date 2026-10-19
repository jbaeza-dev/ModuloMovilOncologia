import { describe, expect, it } from 'vitest';
import {
  createDailyFormContext,
  formatDailyPeriodKey,
  getCivilDateInTimeZone,
  isDailyPeriodCurrent,
  parseDailyPeriodKey,
  DEFAULT_FORMS_TIMEZONE,
} from './daily-form-context';

describe('daily-form-context service', () => {
  describe('getCivilDateInTimeZone', () => {
    it('calcula la fecha civil en America/Santiago considerando UTC offset', () => {
      // 2026-10-18T01:30:00Z -> en Santiago (UTC-3 en octubre) son las 22:30 del 17 de octubre
      const utcDate = new Date('2026-10-18T01:30:00.000Z');
      expect(getCivilDateInTimeZone(utcDate, 'America/Santiago')).toBe('2026-10-17');

      // 2026-10-18T04:00:00Z -> en Santiago son las 01:00 del 18 de octubre
      const utcNext = new Date('2026-10-18T04:00:00.000Z');
      expect(getCivilDateInTimeZone(utcNext, 'America/Santiago')).toBe('2026-10-18');
    });

    it('maneja cambios de horario de verano e invierno (DST en Chile)', () => {
      // Invierno chileno (UTC-4), ej: Julio
      const winterUtc = new Date('2026-07-15T03:30:00.000Z');
      // 03:30Z - 4h = 23:30 del 14 de Julio
      expect(getCivilDateInTimeZone(winterUtc, 'America/Santiago')).toBe('2026-07-14');

      const winterMorning = new Date('2026-07-15T15:00:00.000Z');
      expect(getCivilDateInTimeZone(winterMorning, 'America/Santiago')).toBe('2026-07-15');
    });

    it('lanza error con fecha inválida', () => {
      expect(() => getCivilDateInTimeZone('fecha-invalida')).toThrow(/Fecha inválida/);
    });
  });

  describe('formatDailyPeriodKey y parseDailyPeriodKey', () => {
    it('formatea correctamente fecha civil a clave de período', () => {
      expect(formatDailyPeriodKey('2026-10-18')).toBe('dia:2026-10-18');
    });

    it('rechaza formato de fecha incorrecto', () => {
      expect(() => formatDailyPeriodKey('18-10-2026')).toThrow();
      expect(() => formatDailyPeriodKey('invalid')).toThrow();
    });

    it('parsea clave de período válida', () => {
      const parsed = parseDailyPeriodKey('dia:2026-10-18');
      expect(parsed).toEqual({ fechaSeguimiento: '2026-10-18' });
    });

    it('retorna null para claves no diarias o inválidas', () => {
      expect(parseDailyPeriodKey('legacy')).toBeNull();
      expect(parseDailyPeriodKey('semanal:2026-W42')).toBeNull();
      expect(parseDailyPeriodKey('dia:invalido')).toBeNull();
      expect(parseDailyPeriodKey('')).toBeNull();
    });
  });

  describe('createDailyFormContext', () => {
    it('crea un contexto temporal completo con ventana de recuerdo de 24 horas exactas', () => {
      const fixedNow = new Date('2026-10-18T14:30:00.000Z');
      const context = createDailyFormContext({ now: fixedNow, timeZone: DEFAULT_FORMS_TIMEZONE });

      expect(context.fechaSeguimiento).toBe('2026-10-18');
      expect(context.periodoClave).toBe('dia:2026-10-18');
      expect(context.zonaHoraria).toBe('America/Santiago');
      expect(context.iniciadoEn).toBe('2026-10-18T14:30:00.000Z');
      expect(context.ventanaHasta).toBe('2026-10-18T14:30:00.000Z');
      expect(context.ventanaDesde).toBe('2026-10-17T14:30:00.000Z');

      const windowDiffMs =
        new Date(context.ventanaHasta).getTime() - new Date(context.ventanaDesde).getTime();
      expect(windowDiffMs).toBe(24 * 60 * 60 * 1000);
    });
  });

  describe('isDailyPeriodCurrent', () => {
    it('comprueba si el período corresponde al día de hoy', () => {
      const fixedNow = new Date('2026-10-18T12:00:00.000Z');
      expect(isDailyPeriodCurrent('dia:2026-10-18', fixedNow)).toBe(true);
      expect(isDailyPeriodCurrent('dia:2026-10-17', fixedNow)).toBe(false);
      expect(isDailyPeriodCurrent('legacy', fixedNow)).toBe(false);
    });
  });
});
