import { describe, it, expect, vi } from 'vitest';
import { ExpoPushProvider } from '../src/push-provider.js';
import type { GatewayPayloadNotificacion } from '@quimiocare/contracts';
const data: GatewayPayloadNotificacion = {
  tipo: 'recordatorio',
  sesion_id: '11111111-1111-4111-8111-111111111111',
  recordatorio_id: '22222222-2222-4222-8222-222222222222',
  version_recordatorio: 1,
  ocurrencia_id: '22222222-2222-4222-8222-222222222222:1:2026-10-29:0800',
  programado_en: new Date().toISOString(),
  respaldo_en: new Date(Date.now() + 120000).toISOString(),
  vence_en: new Date(Date.now() + 600000).toISOString(),
};
const token = 'ExpoPushToken[synthetic]';
describe('Expo transport', () => {
  it('sends technical data without auto-presentation fields or clinical content', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ data: { status: 'ok', id: 'ticket-1' } })));
    const result = await new ExpoPushProvider(fetcher).send(token, data);
    expect(result).toEqual({ state: 'accepted', ticket: 'ticket-1' });
    expect(fetcher.mock.calls[0]![0]).toBe('https://exp.host/--/api/v2/push/send');
    const body = JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
    expect(Object.keys(body).sort()).toEqual(['data', 'priority', 'to', 'ttl']);
    expect(body.data).toEqual(data);
    expect(body.ttl).toBeGreaterThan(590);
  });
  it.each([429, 500, 503])(
    'keeps HTTP %s retryable without exposing provider body',
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('private-token', { status }));
      expect(await new ExpoPushProvider(fetcher).send(token, data)).toEqual({
        state: 'temporary',
        code: 'ProviderHttpTemporary',
      });
    },
  );
  it('distinguishes invalid token, permanent rejection and uncertain response', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const provider = new ExpoPushProvider(fetcher);
    expect(await provider.send('fcm-token', data)).toEqual({
      state: 'permanent',
      code: 'InvalidExpoToken',
    });
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { status: 'error', details: { error: 'DeviceNotRegistered' }, message: token },
        }),
      ),
    );
    expect(await provider.send(token, data)).toEqual({
      state: 'permanent',
      code: 'DeviceNotRegistered',
    });
    fetcher.mockResolvedValueOnce(new Response('{}'));
    expect(await provider.send(token, data)).toEqual({
      state: 'uncertain',
      code: 'ProviderResponseInvalid',
    });
    fetcher.mockRejectedValueOnce(new Error(token));
    expect(await provider.send(token, data)).toEqual({
      state: 'uncertain',
      code: 'ProviderTransportUncertain',
    });
  });
  it('does not convert missing/failed receipts into client success', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const provider = new ExpoPushProvider(fetcher);
    fetcher.mockResolvedValueOnce(new Response('{"data":{}}'));
    expect(await provider.receipt('ticket')).toEqual({ state: 'unknown' });
    fetcher.mockResolvedValueOnce(new Response('{"data":{"ticket":{"status":"ok"}}}'));
    expect(await provider.receipt('ticket')).toEqual({ state: 'ok' });
    fetcher.mockResolvedValueOnce(
      new Response(
        '{"data":{"ticket":{"status":"error","details":{"error":"DeviceNotRegistered"}}}}',
      ),
    );
    expect(await provider.receipt('ticket')).toEqual({
      state: 'error',
      code: 'DeviceNotRegistered',
    });
  });
});
