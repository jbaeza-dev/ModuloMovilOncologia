import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setNotificationChannelAsync: vi.fn(async () => null),
  getPermissionsAsync: vi.fn(async () => ({ granted: true })),
  getNotificationChannelAsync: vi.fn(async () => ({ importance: 4 })),
  getAllScheduledNotificationsAsync: vi.fn(async () => [
    { identifier: 'aviso-1', content: { data: { ocurrencia_id: 'o1' } } },
  ]),
  scheduleNotificationAsync: vi.fn(async (req: { identifier: string }) => req.identifier),
  cancelScheduledNotificationAsync: vi.fn(async () => undefined),
}));
vi.mock('expo-notifications', () => ({
  ...mocks,
  AndroidImportance: { NONE: 0, HIGH: 4 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

import { ExpoAgendaNotifications } from './agenda-notifications';
import { reminderNotificationCopy } from '../notifications/notification-copy';

beforeEach(() => vi.clearAllMocks());

describe('avisos nativos de la agenda', () => {
  it('exige permiso y un canal no silenciado', async () => {
    const n = new ExpoAgendaNotifications();
    expect(await n.permission()).toBe(true);
    mocks.getNotificationChannelAsync.mockResolvedValueOnce({ importance: 0 });
    expect(await n.permission()).toBe(false);
    mocks.getPermissionsAsync.mockResolvedValueOnce({ granted: false });
    expect(await n.permission()).toBe(false);
    expect(mocks.setNotificationChannelAsync).toHaveBeenCalledWith(
      'quimiocare-agenda',
      expect.objectContaining({ showBadge: false }),
    );
  });

  it('lista los avisos programados con sus datos', async () => {
    expect(await new ExpoAgendaNotifications().list()).toEqual([
      { id: 'aviso-1', data: { ocurrencia_id: 'o1' } },
    ]);
  });

  it('programa un aviso con fecha usando el texto genérico del tipo', async () => {
    const n = new ExpoAgendaNotifications();
    await n.schedule('a1', '2026-11-05T12:00:00.000Z', {} as never, 'signos');
    const req = mocks.scheduleNotificationAsync.mock.calls[0]![0] as unknown as {
      content: { title: string; sound: boolean };
      trigger: { type: string; date: Date; channelId: string };
    };
    expect(req.content.title).toBe(reminderNotificationCopy('signos').title);
    expect(req.content.sound).toBe(false);
    expect(req.trigger).toEqual({
      type: 'date',
      date: new Date('2026-11-05T12:00:00.000Z'),
      channelId: 'quimiocare-agenda',
    });
  });

  it('programa un aviso inmediato cuando no hay fecha y permite cancelarlo', async () => {
    const n = new ExpoAgendaNotifications();
    await n.schedule('a2', null, {} as never);
    const req = mocks.scheduleNotificationAsync.mock.calls[0]![0] as unknown as {
      trigger: unknown;
    };
    expect(req.trigger).toEqual({ channelId: 'quimiocare-agenda' });
    await n.cancel('a2');
    expect(mocks.cancelScheduledNotificationAsync).toHaveBeenCalledWith('a2');
  });
});

describe('texto de los avisos sin datos clínicos', () => {
  it.each([
    ['signos', 'Es hora de registrar tus signos vitales'],
    ['epro', 'Recordatorio de seguimiento diario'],
    ['medicacion', 'Recordatorio de medicamentos'],
    [undefined, 'Recordatorio de QuimioCare'],
  ] as const)('el tipo %s usa un título genérico', (kind, titulo) => {
    const copy = reminderNotificationCopy(kind);
    expect(copy.title).toBe(titulo);
    expect(copy.body.length).toBeGreaterThan(0);
  });
});
