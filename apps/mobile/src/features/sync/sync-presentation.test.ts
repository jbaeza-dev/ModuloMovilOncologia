import { describe, expect, it } from 'vitest';
import type { SessionSnapshot } from '../../services/session/http-session-types';
import { syncPresentation, type SyncSummary } from './sync-presentation';

const usuario = { id: 'u1', email: 'paciente@ejemplo.cl' } as unknown as SessionSnapshot['user'];

function estado(over: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    state: 'ready',
    user: usuario,
    identity: null,
    stale: false,
    consent: null,
    terms: null,
    uploadAllowed: true,
    message: null,
    revision: 1,
    ...over,
  } as SessionSnapshot;
}

function resumen(over: Partial<SyncSummary> = {}): SyncSummary {
  return { pending: 0, paused: 0, rejected: 0, runtimePaused: false, pauseCode: null, ...over };
}

describe('syncPresentation', () => {
  it('no muestra aviso sin usuario', () => {
    expect(syncPresentation(estado({ user: null }), resumen())).toBeNull();
  });

  it.each([
    ['expired', 'login', 'Volver a ingresar'],
    ['terms_pending', 'consent', 'Revisar consentimiento'],
    ['profile_incomplete', 'profile', 'Completar mis datos'],
    ['access_denied', 'details', 'Ver detalles'],
    ['clinical_incomplete', 'link', 'Revisar vinculación'],
  ] as const)('el estado de sesión %s lleva a la acción %s', (state, action, label) => {
    const r = syncPresentation(estado({ state: state as SessionSnapshot['state'] }), resumen());
    expect(r?.action).toBe(action);
    expect(r?.label).toBe(label);
  });

  it('con datos vencidos no muestra la vinculación pendiente sino el reintento', () => {
    const r = syncPresentation(
      estado({ state: 'clinical_incomplete' as SessionSnapshot['state'], stale: true }),
      resumen(),
    );
    expect(r?.action).toBe('retry');
  });

  it('una pausa no recuperable en ejecución pide revisar el registro', () => {
    const r = syncPresentation(
      estado(),
      resumen({ runtimePaused: true, pauseCode: 'RECHAZO_PERMANENTE' }),
    );
    expect(r?.title).toBe('Un registro necesita revisión');
  });

  it('un registro apartado avisa que los demás siguen enviándose y lleva a revisarlo', () => {
    const r = syncPresentation(estado(), resumen({ setAside: 1, pending: 2 }));
    expect(r?.title).toBe('Un registro no se pudo enviar');
    expect(r?.message).toContain('Los demás registros siguen enviándose');
    expect(r).toMatchObject({ action: 'details', label: 'Revisar registros' });
  });

  it('varios registros apartados usan el plural', () => {
    const r = syncPresentation(estado(), resumen({ setAside: 3 }));
    expect(r?.title).toBe('3 registros no se pudieron enviar');
  });

  it('un registro conservado en el teléfono no se presenta como rechazado', () => {
    const r = syncPresentation(estado(), resumen({ kept: 1 }));
    expect(r?.message).not.toContain('no fue aceptado');
  });

  it('una pausa técnica del SDK sin comando conocido pide revisar el registro', () => {
    const r = syncPresentation(
      estado(),
      resumen({ runtimePaused: true, pauseCode: 'COMANDO_SDK_NO_PERMITIDO' }),
    );
    expect(r?.label).toBe('Ver registro y detalles');
  });

  it('una pausa recuperable de sesión se presenta como reintento automático', () => {
    const r = syncPresentation(
      estado(),
      resumen({ runtimePaused: true, pauseCode: 'SESION_EXPIRED' }),
    );
    expect(r?.action).toBe('retry');
  });

  it('el servicio no disponible ofrece reintentar', () => {
    const r = syncPresentation(
      estado({ state: 'service_unavailable' as SessionSnapshot['state'] }),
      null,
    );
    expect(r?.label).toBe('Intentar ahora');
  });

  it('sin resumen y sin incidencias no muestra aviso', () => {
    expect(syncPresentation(estado(), null)).toBeNull();
  });

  it('informa un registro rechazado en singular, sin pendientes', () => {
    const r = syncPresentation(estado(), resumen({ rejected: 1 }));
    expect(r?.message).toContain('1 registro no fue aceptado');
    expect(r?.message).not.toContain('por enviar');
  });

  it('informa varios rechazados y los pendientes por enviar', () => {
    const r = syncPresentation(
      estado(),
      resumen({ rejected: 2, pending: 1, paused: 1, pauseCode: 'SESION_DENIED' }),
    );
    expect(r?.message).toContain('2 registros no fueron aceptados');
    expect(r?.message).toContain('Hay 2 por enviar.');
  });

  it('informa uno o varios registros pendientes en singular y plural', () => {
    expect(syncPresentation(estado(), resumen({ pending: 1 }))?.message).toContain(
      '1 registro guardado',
    );
    expect(syncPresentation(estado(), resumen({ pending: 3 }))?.message).toContain(
      '3 registros guardados',
    );
  });

  it('sin pendientes indica que no hay registros por enviar', () => {
    expect(syncPresentation(estado(), resumen())?.message).toBe(
      'No tienes registros pendientes de envío.',
    );
  });
});
