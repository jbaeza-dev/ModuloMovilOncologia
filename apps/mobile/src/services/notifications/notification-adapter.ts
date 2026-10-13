import type { NotificationJobPayload } from '../../data/local/reminders/reminder-types';

export interface NotificationPermissionState {
  status: 'granted' | 'denied' | 'undetermined';
  canAskAgain: boolean;
  channelStatus: 'ok' | 'blocked' | 'missing';
}

export interface ScheduledNotificationItem {
  nativeId: string;
  triggerDateUtc: string;
  payload: NotificationJobPayload | null;
}

export interface NotificationScheduleJob {
  triggerDateUtc: string;
  title: string;
  body: string;
  payload: NotificationJobPayload;
}

export interface LocalNotificationAdapter {
  getPermissionState(): Promise<NotificationPermissionState>;
  requestPermission(): Promise<NotificationPermissionState>;
  listScheduled(): Promise<readonly ScheduledNotificationItem[]>;
  schedule(job: NotificationScheduleJob): Promise<{ nativeId: string }>;
  cancel(nativeId: string): Promise<void>;
}

/**
 * Adaptador falso para pruebas unitarias de coordinación y reconciliación en memoria.
 */
export class FakeNotificationAdapter implements LocalNotificationAdapter {
  public permission: NotificationPermissionState = {
    status: 'granted',
    canAskAgain: true,
    channelStatus: 'ok',
  };

  public scheduled = new Map<string, ScheduledNotificationItem>();
  public shouldFailSchedule = false;
  public shouldFailCancel = false;
  private nextId = 1;

  async getPermissionState(): Promise<NotificationPermissionState> {
    return { ...this.permission };
  }

  async requestPermission(): Promise<NotificationPermissionState> {
    return { ...this.permission };
  }

  async listScheduled(): Promise<readonly ScheduledNotificationItem[]> {
    return Array.from(this.scheduled.values());
  }

  async schedule(job: NotificationScheduleJob): Promise<{ nativeId: string }> {
    if (this.shouldFailSchedule) {
      throw new Error('Error simulado al programar notificación en el sistema operativo');
    }
    const nativeId = `fake-native-${this.nextId++}`;
    const item: ScheduledNotificationItem = {
      nativeId,
      triggerDateUtc: job.triggerDateUtc,
      payload: { ...job.payload },
    };
    this.scheduled.set(nativeId, item);
    return { nativeId };
  }

  async cancel(nativeId: string): Promise<void> {
    if (this.shouldFailCancel) {
      throw new Error(`Error simulado al cancelar notificación ${nativeId}`);
    }
    this.scheduled.delete(nativeId);
  }
}
