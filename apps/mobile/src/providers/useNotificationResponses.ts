import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';

import type { SqlConnection } from '../data/local/core/sql';
import { isValidNotificationPayload } from '../data/local/reminders/reminder-types';
import type { createPatientRepository } from '../data/local/repository';
import type { AgendaCoordinator } from '../services/agenda/agenda-coordinator';
import { localAgendaData, notificationPayload } from '../services/agenda/agenda-coordinator';
import { handleAgendaNotification } from '../services/agenda/native-agenda';
import { foregroundNoticesAllowed } from './foreground-notices';
import type { PatientContextManager } from './patient-context-manager';
import { devWarn } from '../services/diagnostics/dev-warn';

type Repository = ReturnType<typeof createPatientRepository>;

function openAgendaDestination(data: unknown) {
  void handleAgendaNotification(data, true)
    .then((destination) => {
      if (typeof destination === 'string' && destination.startsWith('/'))
        router.push(destination as Href);
    })
    .catch(() => undefined);
}

/**
 * Atiende los avisos tocados (también el que abrió la app en frío) y los recibidos con la app
 * abierta. Las intenciones se capturan antes de abrir la base de la cuenta: el administrador de
 * contexto valida al dueño antes de navegar.
 */
export function useNotificationResponses({
  manager,
  repository,
  database,
  agendaCoordinator,
  bumpRemindersRevision,
}: {
  manager: PatientContextManager;
  repository: Repository | null;
  database: SqlConnection | null;
  agendaCoordinator: AgendaCoordinator | null;
  bumpRemindersRevision: () => void;
}) {
  useEffect(() => {
    // Procesar respuesta previa de arranque (cold start)
    try {
      const last = Notifications.getLastNotificationResponse();
      if (last) {
        Notifications.clearLastNotificationResponse();
        const data = last.notification.request.content.data;
        const identifier = last.notification.request.identifier;
        if (localAgendaData(data)) openAgendaDestination(data);
        if (isValidNotificationPayload(data)) {
          const dedupeKey = `${data.notificacionId}:${identifier || 'cold'}`;
          void manager.handleNotificationOpen(data, dedupeKey).catch((err) => {
            devWarn('Error en handleNotificationOpen cold start:', err);
          });
        }
      }
    } catch {
      // Ignorar en plataformas o entornos sin soporte
    }

    let responseSub: { remove: () => void } | null = null;
    let receivedSub: { remove: () => void } | null = null;

    try {
      responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data;
        const identifier = response.notification.request.identifier;
        if (localAgendaData(data)) openAgendaDestination(data);
        if (isValidNotificationPayload(data)) {
          const dedupeKey = `${data.notificacionId}:${identifier || 'listener'}`;
          void manager.handleNotificationOpen(data, dedupeKey).catch((err) => {
            devWarn('Error en handleNotificationOpen listener:', err);
          });
        }
      });

      receivedSub = Notifications.addNotificationReceivedListener((notification) => {
        void (async () => {
          const allowed = await foregroundNoticesAllowed();
          if (!allowed) return;
          const data = notification.request.content.data;
          if (notificationPayload(data) || localAgendaData(data)) {
            void handleAgendaNotification(data).catch(() => undefined);
          }
          if (isValidNotificationPayload(data)) {
            const currentId = manager.getPatientId();
            const currentEpoch = manager.getContextEpoch();
            if (currentId && data.pacienteId === currentId && repository) {
              void repository.reminders
                .recordNotificationObserved(data.notificacionId)
                .then(() => {
                  if (
                    manager.getPatientId() === currentId &&
                    manager.getContextEpoch() === currentEpoch
                  ) {
                    bumpRemindersRevision();
                  }
                })
                .catch(() => undefined);
            }
          }
        })();
      });
    } catch {
      // Ignorar si no está disponible en este entorno
    }

    return () => {
      responseSub?.remove();
      receivedSub?.remove();
    };
    // database y agendaCoordinator vuelven a suscribir los oyentes cuando cambia la cuenta o la agenda.
  }, [database, repository, manager, agendaCoordinator, bumpRemindersRevision]);
}
