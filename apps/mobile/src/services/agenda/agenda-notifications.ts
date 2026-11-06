import * as Notifications from 'expo-notifications';
import type { AgendaNotifications, NativeAgendaData } from './agenda-coordinator';
import {
  reminderNotificationCopy,
  type ReminderNotificationKind,
} from '../notifications/notification-copy';
const channel = 'quimiocare-agenda';
export class ExpoAgendaNotifications implements AgendaNotifications {
  private async ensureChannel() {
    await Notifications.setNotificationChannelAsync(channel, {
      name: 'Recordatorios de QuimioCare',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#0d9488',
      showBadge: false,
    });
  }
  async permission() {
    await this.ensureChannel();
    const p = await Notifications.getPermissionsAsync(),
      c = await Notifications.getNotificationChannelAsync(channel);
    return p.granted && c?.importance !== Notifications.AndroidImportance.NONE;
  }
  async list() {
    return (await Notifications.getAllScheduledNotificationsAsync()).map((v) => ({
      id: v.identifier,
      data: v.content.data,
    }));
  }
  async schedule(
    id: string,
    at: string | null,
    data: NativeAgendaData,
    kind?: ReminderNotificationKind,
  ) {
    await this.ensureChannel();
    return Notifications.scheduleNotificationAsync({
      identifier: id,
      content: {
        ...reminderNotificationCopy(kind),
        data: data as unknown as Record<string, unknown>,
        sound: false,
      },
      trigger: at
        ? {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(at),
            channelId: channel,
          }
        : { channelId: channel },
    });
  }
  async cancel(id: string) {
    await Notifications.cancelScheduledNotificationAsync(id);
  }
}
