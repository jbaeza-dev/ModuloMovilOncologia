import { describe, expect, it, afterEach } from 'vitest';
import type { GatewayRecordatorio } from '@quimiocare/contracts';
import { agendaDate, agendaInstant } from '@quimiocare/contracts/agenda';
import { medicationDay, type PatientMedication } from './medication-day';
import { createSqliteTestHarness } from '../../data/local/testing/sqlite-test-harness';
import { migrateDatabase, migrations } from '../../data/local/migrations';
import {
  getMedicationIntakesForDate,
  logMedicationIntake,
  generateIntakeLogId,
} from '../../data/local/medication-intake-log';
const medicine: PatientMedication = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  medicamento_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  nombre: 'Ejemplo A',
  dosis: 'Texto sintético',
  frecuencia: 'Texto sintético',
  activo: true,
  fecha_inicio: '2026-01-01',
  fecha_termino: null,
};
const rule: GatewayRecordatorio = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  tipo: 'medicacion',
  titulo: 'Aviso elegido',
  zona_horaria: 'America/Santiago',
  horas: ['08:00', '20:00'],
  dias_semana: [1, 2, 3, 4, 5, 6, 7],
  fecha_inicio: '2026-01-01',
  fecha_fin: null,
  activo: true,
  version: 1,
  creado_en: '2026-01-01T00:00:00Z',
  actualizado_en: '2026-01-01T00:00:00Z',
  canal: 'push_con_respaldo_local',
  respaldo_segundos: 120,
  medicamento_paciente_id: medicine.id,
};
const now = '2026-11-03T15:00:00.000Z';
const build = (rules = [rule], medications = [medicine]) =>
  medicationDay({ medications, rules, intakes: [], pendingIds: new Set(), now });
describe('Día de medicamentos vinculado a avisos confirmados', () => {
  it('muestra todos los disponibles y separa medicamento, aviso, fecha y hora', () => {
    const second = { ...medicine, id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', nombre: 'Ejemplo B' };
    const model = build([rule], [medicine, second]);
    expect(model.cards).toHaveLength(2);
    expect(model.cards[0]!.slots.map((v) => [v.time, v.due])).toEqual([
      ['08:00', true],
      ['20:00', false],
    ]);
    expect(model.cards[1]!.slots).toEqual([]);
    expect(model.date).toBe('2026-11-03');
  });
  it('no asocia un aviso genérico, otro medicamento o un título que coincide por casualidad', () => {
    expect(
      build([{ ...rule, medicamento_paciente_id: null, titulo: medicine.nombre! }]).cards[0]!.slots,
    ).toEqual([]);
    expect(
      build([{ ...rule, medicamento_paciente_id: medicine.medicamento_id }]).cards[0]!.slots,
    ).toEqual([]);
  });
  it('excluye inactivos, futuros y terminados; aplica fechas inclusivas y el valor activo predeterminado del contrato', () => {
    expect(
      build(
        [rule],
        [
          { ...medicine, activo: false },
          { ...medicine, id: 'otro1', fecha_inicio: '2026-11-04' },
          { ...medicine, id: 'otro2', fecha_termino: '2026-11-02' },
        ],
      ).cards,
    ).toEqual([]);
    expect(
      build(
        [rule],
        [
          {
            ...medicine,
            activo: undefined,
            fecha_inicio: '2026-11-03',
            fecha_termino: '2026-11-03',
          },
        ],
      ).cards,
    ).toHaveLength(1);
  });
  it('respeta días, vigencia y estado de los avisos, sin fabricar una pauta desde frecuencia libre', () => {
    for (const change of [
      { activo: false },
      { dias_semana: [1] },
      { fecha_inicio: '2026-11-04' },
      { fecha_fin: '2026-11-02' },
    ])
      expect(build([{ ...rule, ...change }]).cards[0]!.slots).toEqual([]);
    expect(build([], [{ ...medicine, frecuencia: 'Cada 8 horas' }]).cards[0]!.slots).toEqual([]);
  });
  it('un cambio pendiente no habilita confirmaciones sobre el aviso antiguo', () => {
    const model = medicationDay({
      medications: [medicine],
      rules: [rule],
      intakes: [],
      pendingIds: new Set([rule.id]),
      now,
    });
    expect(model.cards[0]!.slots).toEqual([]);
    expect(model.cards[0]!.pendingChange).toBe(true);
  });
  it('dos avisos del mismo medicamento a la misma hora forman una sola confirmación con ambas referencias', () => {
    const model = build([rule, { ...rule, id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }]);
    expect(model.cards[0]!.slots).toHaveLength(2);
    expect(model.cards[0]!.slots[0]!.notices).toHaveLength(2);
  });
  it('no interpreta una toma manual antigua como confirmación de un aviso', () => {
    const model = medicationDay({
      medications: [medicine],
      rules: [rule],
      pendingIds: new Set(),
      now,
      intakes: [
        {
          id: 'legacy',
          paciente_id: 'p',
          medicamento_id: medicine.id,
          medicamento_nombre: 'Ejemplo A',
          fecha_civil: '2026-11-03',
          horario_programado: '08:00',
          fecha_hora: now,
          estado: 'taken',
          registrado_en: now,
        },
      ],
    });
    expect(model.cards[0]!.slots[0]!.intake).toBeNull();
    expect(model.cards[0]!.historical).toHaveLength(1);
  });
  it('renueva el día de Chile y programa el próximo cambio con reglas reales de zona horaria', () => {
    const before = medicationDay({
      medications: [medicine],
      rules: [rule],
      pendingIds: new Set(),
      intakes: [],
      now: '2026-11-04T02:59:59Z',
    });
    expect(before.date).toBe('2026-11-03');
    expect(before.nextRefreshAt).toBe('2026-11-04T03:00:00.000Z');
    expect(agendaDate(before.nextRefreshAt)).toBe('2026-11-04');
    const dst = medicationDay({
      medications: [medicine],
      rules: [rule],
      pendingIds: new Set(),
      intakes: [],
      now: agendaInstant('2026-09-05', '23:59'),
    });
    expect(dst.nextRefreshAt).toBe(agendaInstant('2026-09-06', '00:00'));
  });
});
const harness = createSqliteTestHarness();
afterEach(() => harness.cleanup());
describe('Persistencia y trazabilidad de confirmación', () => {
  it('no arrastra al día siguiente un registro nocturno por coincidir su fecha UTC', async () => {
    const db = harness.open();
    await migrateDatabase(db);
    await logMedicationIntake(db, {
      id: 'night',
      paciente_id: 'p',
      medicamento_id: medicine.id,
      medicamento_nombre: 'Ejemplo A',
      fecha_civil: '2026-11-03',
      horario_programado: 'sin_horario#1',
      fecha_hora: '2026-11-04T01:00:00Z',
      registrado_en: '2026-11-04T01:00:00Z',
      estado: 'taken',
    });
    expect(await getMedicationIntakesForDate(db, 'p', '2026-11-04')).toEqual([]);
    expect(await getMedicationIntakesForDate(db, 'p', '2026-11-03')).toHaveLength(1);
    expect(await getMedicationIntakesForDate(db, 'otro', '2026-11-03')).toEqual([]);
  });
  it('guarda las referencias exactas, deduplica un reintento y conserva el evento original al corregir', async () => {
    const db = harness.open();
    await migrateDatabase(db);
    const slot = build().cards[0]!.slots[0]!;
    const entry = {
      id: generateIntakeLogId('p', medicine.id, slot.date, slot.key),
      paciente_id: 'p',
      medicamento_id: medicine.id,
      medicamento_nombre: 'Ejemplo A',
      fecha_civil: slot.date,
      horario_programado: slot.key,
      es_programado: 1,
      fecha_hora: now,
      registrado_en: now,
      estado: 'taken' as const,
      avisos_confirmados: slot.notices,
    };
    await logMedicationIntake(db, entry);
    await logMedicationIntake(db, entry);
    expect(await db.first('SELECT count(*) n FROM qc_medication_intake_events')).toEqual({ n: 1 });
    await logMedicationIntake(db, {
      ...entry,
      estado: 'omitted',
      registrado_en: '2026-11-03T15:01:00Z',
      fecha_hora: '2026-11-03T15:01:00Z',
    });
    const rows = await getMedicationIntakesForDate(db, 'p', slot.date);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.estado).toBe('omitted');
    expect(JSON.parse(rows[0]!.avisos_confirmados_json!)).toEqual(slot.notices);
    const events = await db.all<{ estado_nuevo: string; avisos_confirmados_json: string }>(
      'SELECT estado_nuevo,avisos_confirmados_json FROM qc_medication_intake_events ORDER BY creado_en',
    );
    expect(events.map((v) => v.estado_nuevo)).toEqual(['taken', 'omitted']);
    expect(JSON.parse(events[0]!.avisos_confirmados_json)).toEqual(slot.notices);
  });
  it('rechaza referencias de otro día u hora sin escribir registros ni eventos', async () => {
    const db = harness.open();
    await migrateDatabase(db);
    const slot = build().cards[0]!.slots[0]!;
    await expect(
      logMedicationIntake(db, {
        id: 'bad',
        paciente_id: 'p',
        medicamento_id: medicine.id,
        medicamento_nombre: 'Ejemplo A',
        fecha_civil: '2026-11-04',
        horario_programado: slot.key,
        es_programado: 1,
        fecha_hora: now,
        registrado_en: now,
        estado: 'taken',
        avisos_confirmados: slot.notices,
      }),
    ).rejects.toThrow('aviso confirmado');
    expect(await db.first('SELECT count(*) n FROM qc_medication_intake_log')).toEqual({ n: 0 });
  });
  it('migra 19→20 conservando registros y eventos sin adjudicarles un aviso retrospectivo', async () => {
    const db = harness.open();
    await migrateDatabase(
      db,
      migrations.filter((v) => v.version <= 19),
    );
    await logMedicationIntake(db, {
      id: 'old',
      paciente_id: 'p',
      medicamento_id: medicine.id,
      medicamento_nombre: 'Ejemplo A',
      fecha_civil: '2026-11-03',
      horario_programado: 'sin_horario#1',
      fecha_hora: now,
      registrado_en: now,
      estado: 'taken',
    });
    await migrateDatabase(db);
    expect(await db.first('PRAGMA user_version')).toEqual({ user_version: 20 });
    expect(
      await db.first('SELECT id,fecha_hora,avisos_confirmados_json FROM qc_medication_intake_log'),
    ).toEqual({ id: 'old', fecha_hora: now, avisos_confirmados_json: null });
    expect(await db.first('SELECT count(*) n FROM qc_medication_intake_events')).toEqual({ n: 1 });
  });
});
