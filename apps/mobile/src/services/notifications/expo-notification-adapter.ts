import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { NotificationJobPayload } from '../../data/local/reminders/reminder-types';
import type {
  LocalNotificationAdapter,
  NotificationPermissionState,
  NotificationScheduleJob,
  ScheduledNotificationItem,
} from './notification-adapter';

const CHANNEL_ID = 'recordatorios_salud';

export class ExpoNotificationAdapter implements LocalNotificationAdapter {
  private channelEnsured = false;

  private async ensureChannel(): Promise<'ok' | 'blocked' | 'missing'> {
    if (Platform.OS !== 'android') return 'ok';
    try {
      const existing = await Notifications.getNotificationChannelAsync(CHANNEL_ID);
      if (existing) {
        if (existing.importance === Notifications.AndroidImportance.NONE) {
          return 'blocked';
        }
        return 'ok';
      }

      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'Recordatorios de salud',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#0d9488',
        sound: undefined,
        showBadge: false,
      });
      this.channelEnsured = true;
      return 'ok';
    } catch {
      return 'missing';
    }
  }

  async getPermissionState(): Promise<NotificationPermissionState> {
    try {
      const perms = await Notifications.getPermissionsAsync();
      const channelStatus = await this.ensureChannel();

      let status: 'granted' | 'denied' | 'undetermined' = 'undetermined';
      if (perms.granted) {
        status = 'granted';
      } else if (!perms.canAskAgain) {
        status = 'denied';
      } else if (perms.status === 'denied') {
        status = 'denied';
      }

      return {
        status,
        canAskAgain: perms.canAskAgain,
        channelStatus,
      };
    } catch {
      return {
        status: 'undetermined',
        canAskAgain: true,
        channelStatus: 'missing',
      };
    }
  }

  async requestPermission(): Promise<NotificationPermissionState> {
    try {
      await this.ensureChannel();
      const perms = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: false, allowSound: true },
      });
      const channelStatus = await this.ensureChannel();

      return {
        status: perms.granted ? 'granted' : 'denied',
        canAskAgain: perms.canAskAgain,
        channelStatus,
      };
    } catch {
      return {
        status: 'denied',
        canAskAgain: false,
        channelStatus: 'missing',
      };
    }
  }

  async listScheduled(): Promise<readonly ScheduledNotificationItem[]> {
    try {
      const all = await Notifications.getAllScheduledNotificationsAsync();
      const items: ScheduledNotificationItem[] = [];

      for (const req of all) {
        const payloadData = req.content?.data as NotificationJobPayload | undefined;
        let triggerDateUtc = '';
        const trigger = req.trigger;

        if (trigger && typeof trigger === 'object') {
          if ('date' in trigger && trigger.date) {
            triggerDateUtc = new Date(trigger.date).toISOString();
          } else if ('value' in trigger && typeof trigger.value === 'number') {
            triggerDateUtc = new Date(trigger.value).toISOString();
          }
        }

        items.push({
          nativeId: req.identifier,
          triggerDateUtc,
          payload: payloadData && payloadData.version === 1 ? payloadData : null,
        });
      }

      return items;
    } catch {
      return [];
    }
  }

  async schedule(job: NotificationScheduleJob): Promise<{ nativeId: string }> {
    await this.ensureChannel();

    const trigger: Notifications.DateTriggerInput = {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(job.triggerDateUtc),
      channelId: CHANNEL_ID,
    };

    const nativeId = await Notifications.scheduleNotificationAsync({
      content: {
        title: job.title,
        body: job.body,
        data: job.payload as unknown as Record<string, unknown>,
        color: '#0d9488',
        sound: undefined,
      },
      trigger,
    });

    return { nativeId };
  }

  async cancel(nativeId: string): Promise<void> {
    try {
      await Notifications.cancelScheduledNotificationAsync(nativeId);
    } catch {
      // Ignora fallo si ya no existe en el SO
    }
  }
}
