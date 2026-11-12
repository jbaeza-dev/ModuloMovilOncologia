import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Desde Android 12, expo-notifications solo programa alarmas exactas si el sistema
// lo permite; sin estos permisos cae a alarmas inexactas que Doze puede retrasar.
describe('permisos de alarmas exactas', () => {
  const appJson = JSON.parse(readFileSync(resolve(__dirname, '../../../app.json'), 'utf-8')) as {
    expo: { android: { permissions?: string[] } };
  };

  it('declara SCHEDULE_EXACT_ALARM y USE_EXACT_ALARM en la configuración de Android', () => {
    expect(appJson.expo.android.permissions).toEqual(
      expect.arrayContaining([
        'android.permission.SCHEDULE_EXACT_ALARM',
        'android.permission.USE_EXACT_ALARM',
      ]),
    );
  });
});
