import { describe, it, expect } from 'vitest';
import type { GatewayRecordatorio } from '@quimiocare/contracts';
import { sharedReminderStatus } from './shared-reminder-status';
import type { AgendaCoverage } from './agenda-coordinator';
const rule: GatewayRecordatorio = {
  id: 'ed21a163-0102-4b25-98af-4b3552cc87ad',
  tipo: 'signos',
  titulo: 'Registro',
  zona_horaria: 'America/Santiago',
  horas: ['08:00'],
  dias_semana: [1, 2, 3, 4, 5, 6, 7],
  fecha_inicio: '2026-01-01',
  fecha_fin: null,
  activo: true,
  version: 1,
  creado_en: '2026-10-01T00:00:00Z',
  actualizado_en: '2026-10-01T00:00:00Z',
  canal: 'push_con_respaldo_local',
  respaldo_segundos: 120,
};
const now = '2026-10-29T10:59:00Z',
  occurrence = rule.id + ':1:2026-10-29:0800',
  jobs = [{ occurrence_id: occurrence, native_id: 'native-1', state: 'scheduled' }];
const coverage: AgendaCoverage = {
  nativeIds: ['native-1'],
  permission: true,
  confirmed: 1,
  wanted: 1,
  truncated: 0,
  until: '2026-10-29T11:02:00Z',
  horizonEndsAt: '2026-11-12T03:00:00Z',
  pendingCancellations: 0,
  checkedAt: now,
};
describe('Estado de agenda compartida en Inicio', () => {
  it('solo anuncia programado si el ID consta en la conciliación nativa', () => {
    expect(sharedReminderStatus([rule], new Set(), jobs, coverage, now)).toMatchObject({
      status: 'scheduled',
      ruleId: rule.id,
      fechaPrevistaUtc: '2026-10-29T11:00:00.000Z',
    });
    expect(
      sharedReminderStatus([rule], new Set(), jobs, { ...coverage, nativeIds: [] }, now).status,
    ).toBe('pending_scheduling');
  });
  it('un SAVE local no vuelve a anunciar el aviso del mismo día', () => {
    expect(
      sharedReminderStatus([rule], new Set(['signos:2026-10-29']), jobs, coverage, now),
    ).toMatchObject({ status: 'pending_scheduling', fechaCivilLocal: '2026-10-30' });
  });
  it('distingue agenda vacía, horario pausado y permiso pendiente', () => {
    expect(sharedReminderStatus([], new Set(), [], null, now).status).toBe('no_configured');
    expect(
      sharedReminderStatus([{ ...rule, activo: false }], new Set(), [], coverage, now).status,
    ).toBe('rule_disabled');
    expect(sharedReminderStatus([rule], new Set(), [], null, now).deviceAvailability).toBe(
      'permission_required',
    );
  });
});

describe('Hora elegida y orden de la próxima medición', () => {
  it('no salta al día siguiente solo porque el aviso más cercano aún no tiene respaldo confirmado', () => {
    const laterId = rule.id + ':1:2026-10-30:0800';
    const laterJob = { occurrence_id: laterId, native_id: 'later-native', state: 'scheduled' };
    expect(
      sharedReminderStatus(
        [rule],
        new Set(),
        [laterJob],
        { ...coverage, nativeIds: ['later-native'] },
        now,
      ),
    ).toMatchObject({
      status: 'pending_scheduling',
      fechaPrevistaUtc: '2026-10-29T11:00:00.000Z',
      fechaCivilLocal: '2026-10-29',
    });
  });
  it('una hora ya alcanzada deja de ser la próxima aunque su respaldo aún esté pendiente', () => {
    expect(
      sharedReminderStatus(
        [{ ...rule, horas: ['08:00', '09:00'] }],
        new Set(),
        [],
        coverage,
        '2026-10-29T11:00:30Z',
      ),
    ).toMatchObject({ fechaPrevistaUtc: '2026-10-29T12:00:00.000Z', horaMinutoLocal: '09:00' });
  });
  it('elige el horario más cercano entre reglas, sin depender de su orden de lectura', () => {
    const later = { ...rule, id: 'ad21a163-0102-4b25-98af-4b3552cc87ad', horas: ['09:00'] };
    for (const rules of [
      [later, rule],
      [rule, later],
    ]) {
      expect(sharedReminderStatus(rules, new Set(), jobs, coverage, now)).toMatchObject({
        status: 'scheduled',
        ruleId: rule.id,
        fechaPrevistaUtc: '2026-10-29T11:00:00.000Z',
      });
    }
  });
  it('conserva la fecha civil y hora elegidas cuando el respaldo cae al día siguiente', () => {
    expect(
      sharedReminderStatus(
        [{ ...rule, horas: ['23:59'] }],
        new Set(),
        [],
        coverage,
        '2026-10-30T02:58:00Z',
      ),
    ).toMatchObject({
      fechaPrevistaUtc: '2026-10-30T02:59:00.000Z',
      fechaCivilLocal: '2026-10-29',
      horaMinutoLocal: '23:59',
    });
  });
});
