/// <reference types="jest" />
import { ExpoAgendaNotifications } from '../services/agenda/agenda-notifications';
import * as Notifications from 'expo-notifications';
import type { NativeAgendaData } from '../services/agenda/agenda-coordinator';

jest.mock('expo-notifications', () => ({
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  scheduleNotificationAsync: jest.fn(async ({ identifier }: { identifier: string }) => identifier),
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));
const data: NativeAgendaData = {
  quimiocare_agenda: 1,
  contexto: 'contexto-sintetico',
  instalacion_id: '44444444-4444-4444-8444-444444444444',
  canal: 'respaldo',
  payload: {
    tipo: 'recordatorio',
    sesion_id: '33333333-3333-4333-8333-333333333333',
    recordatorio_id: 'ed21a163-0102-4b25-98af-4b3552cc87ad',
    version_recordatorio: 1,
    ocurrencia_id: 'ocurrencia-sintetica',
    programado_en: '2026-11-03T20:00:00Z',
    respaldo_en: '2026-11-03T20:02:00Z',
    vence_en: '2026-11-03T20:10:00Z',
  },
};
describe('Motivo visible en notificaciones nativas', () => {
  beforeEach(() => jest.clearAllMocks());
  it.each([
    ['signos', 'Es hora de registrar tus signos vitales', 'medición y dolor ENA'],
    ['epro', 'Recordatorio de seguimiento diario', 'formulario de seguimiento domiciliario'],
    ['medicacion', 'Recordatorio de medicamentos', 'medicamento y horario indicados'],
  ] as const)(
    'describe %s sin cambiar los datos ni la hora del respaldo',
    async (kind, title, body) => {
      const adapter = new ExpoAgendaNotifications();
      await adapter.schedule('prueba-sintetica', data.payload.respaldo_en, data, kind);
      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'prueba-sintetica',
          content: expect.objectContaining({ title, body: expect.stringContaining(body), data }),
          trigger: expect.objectContaining({ date: new Date(data.payload.respaldo_en) }),
        }),
      );
    },
  );
  it('usa el mismo motivo en una presentación push inmediata', async () => {
    await new ExpoAgendaNotifications().schedule(
      'prueba-push',
      null,
      { ...data, canal: 'push' },
      'epro',
    );
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({ title: 'Recordatorio de seguimiento diario' }),
        trigger: { channelId: 'quimiocare-agenda' },
      }),
    );
  });
  it('mantiene un texto de respaldo si no hay un tipo conocido', async () => {
    await new ExpoAgendaNotifications().schedule('prueba-sin-tipo', null, data);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({ title: 'Recordatorio de QuimioCare' }),
      }),
    );
  });
});
