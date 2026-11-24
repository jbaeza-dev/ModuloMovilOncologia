import { describe, expect, it } from 'vitest';
import { migrations, type Migration } from '../../data/local/migrations';
import { MIN_AGENDA_SCHEMA, isSupportedAgendaSchema } from './agenda-schema';

describe('versión de la base aceptada por los avisos en segundo plano', () => {
  const latest = migrations.at(-1)!.version;

  it('acepta todas las versiones desde la agenda compartida hasta la última migración', () => {
    for (let version = MIN_AGENDA_SCHEMA; version <= latest; version++)
      expect(isSupportedAgendaSchema(version)).toBe(true);
  });

  it('una migración nueva no deja de lado los avisos con la app cerrada', () => {
    const next: readonly Migration[] = [...migrations, { version: latest + 1, sql: 'SELECT 1' }];
    expect(isSupportedAgendaSchema(latest + 1, next)).toBe(true);
  });

  it('rechaza una base anterior a la agenda compartida', () => {
    expect(isSupportedAgendaSchema(MIN_AGENDA_SCHEMA - 1)).toBe(false);
    expect(isSupportedAgendaSchema(0)).toBe(false);
  });

  it('rechaza una base más nueva que la app, por ejemplo tras volver a un APK anterior', () => {
    expect(isSupportedAgendaSchema(latest + 1)).toBe(false);
  });

  it('rechaza valores que no son una versión válida', () => {
    for (const value of [Number.NaN, 13.5, -1, undefined])
      expect(isSupportedAgendaSchema(value as number)).toBe(false);
  });
});
