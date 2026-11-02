import { describe, expect, test } from 'vitest';
import {
  APP_IDENTITY,
  AUTH_AND_ONBOARDING_COPY,
  EPRO_FORMS_COPY,
  HOME_AND_MEDICATIONS_COPY,
  MULTIMEDIA_AND_EDUCATION_COPY,
  PROHIBITED_TECHNICAL_TERMS,
  REPORTS_AND_VIEWERS_COPY,
  SYNC_AND_STORAGE_COPY,
  VITALS_AND_MEASUREMENTS_COPY,
  containsProhibitedTerm,
  getPatientSyncStatusText,
  getReportPeriodText,
} from '../content/patient-copy';

describe('patient-copy: Diccionario de Lenguaje Claro para Pacientes', () => {
  const allDictionaries = [
    { name: 'APP_IDENTITY', dict: APP_IDENTITY },
    { name: 'SYNC_AND_STORAGE_COPY', dict: SYNC_AND_STORAGE_COPY },
    { name: 'AUTH_AND_ONBOARDING_COPY', dict: AUTH_AND_ONBOARDING_COPY },
    { name: 'HOME_AND_MEDICATIONS_COPY', dict: HOME_AND_MEDICATIONS_COPY },
    { name: 'VITALS_AND_MEASUREMENTS_COPY', dict: VITALS_AND_MEASUREMENTS_COPY },
    { name: 'EPRO_FORMS_COPY', dict: EPRO_FORMS_COPY },
    { name: 'REPORTS_AND_VIEWERS_COPY', dict: REPORTS_AND_VIEWERS_COPY },
    { name: 'MULTIMEDIA_AND_EDUCATION_COPY', dict: MULTIMEDIA_AND_EDUCATION_COPY },
  ];

  function inspectObjectForProhibitedTerms(obj: Record<string, unknown>, path = ''): string[] {
    const violations: string[] = [];
    for (const [key, val] of Object.entries(obj)) {
      const currentPath = path ? `${path}.${key}` : key;
      if (typeof val === 'string') {
        const found = containsProhibitedTerm(val);
        if (found) {
          violations.push(`En '${currentPath}': contiene término prohibido '${found}' en "${val}"`);
        }
      } else if (typeof val === 'function') {
        const result = (val as (...args: unknown[]) => string)(1, 2);
        if (typeof result === 'string') {
          const found = containsProhibitedTerm(result);
          if (found) {
            violations.push(
              `En '${currentPath}()': contiene término prohibido '${found}' en "${result}"`,
            );
          }
        }
      } else if (val && typeof val === 'object') {
        violations.push(
          ...inspectObjectForProhibitedTerms(val as Record<string, unknown>, currentPath),
        );
      }
    }
    return violations;
  }

  test('ningún diccionario de cara al paciente contiene jerga técnica prohibida', () => {
    for (const { dict } of allDictionaries) {
      const violations = inspectObjectForProhibitedTerms(
        dict as unknown as Record<string, unknown>,
      );
      expect(violations).toEqual([]);
    }
  });

  test('containsProhibitedTerm detecta términos técnicos prohibidos sin importar mayúsculas/minúsculas', () => {
    for (const term of PROHIBITED_TECHNICAL_TERMS) {
      expect(containsProhibitedTerm(`Error en la capa de ${term}`)).toBe(term);
      expect(containsProhibitedTerm(`Aviso sobre ${term.toLowerCase()}`)).toBe(term);
      expect(containsProhibitedTerm(`Atención: ${term.toUpperCase()}`)).toBe(term);
    }

    expect(containsProhibitedTerm('Guardado seguro en este teléfono')).toBeNull();
    expect(containsProhibitedTerm('Pendiente de envío a tu equipo médico')).toBeNull();
    expect(containsProhibitedTerm('Recibido por tu equipo de salud')).toBeNull();
  });

  test('getPatientSyncStatusText mapea estados técnicos a frases claras para el paciente', () => {
    expect(getPatientSyncStatusText('saved_locally')).toBe('Guardado en este teléfono');
    expect(getPatientSyncStatusText('pending_upload')).toBe(
      'Pendiente de envío a tu equipo médico',
    );
    expect(getPatientSyncStatusText('synced_server')).toBe('Recibido por tu equipo de salud');
  });

  test('getReportPeriodText resuelve textos amigables para períodos de reporte', () => {
    expect(getReportPeriodText(7)).toBe('Últimos 7 días');
    expect(getReportPeriodText(30)).toBe('Últimos 30 días');
    expect(getReportPeriodText(90)).toBe('Últimos 90 días');
  });

  test('pageIndicator formatea correctamente las páginas sin jerga', () => {
    expect(REPORTS_AND_VIEWERS_COPY.pageIndicator(1, 3)).toBe('Página 1 de 3');
    expect(REPORTS_AND_VIEWERS_COPY.pageIndicator(2, 2)).toBe('Página 2 de 2');
  });
});
