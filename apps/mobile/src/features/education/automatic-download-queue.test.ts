import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAutomaticDownloadQueue } from './automatic-download-queue';

afterEach(() => vi.useRealTimers());
const ready = { failed: 0, cancelled: false };
const flush = async () => {
  for (let n = 0; n < 12; n++) await Promise.resolve();
};

describe('automatic educational files', () => {
  it('waits for a complete checkpoint, coalesces duplicate events and downloads the next revision', async () => {
    let fingerprint: string | null = null;
    const run = vi.fn().mockResolvedValue(ready);
    const queue = createAutomaticDownloadQueue({
      fingerprint: async () => fingerprint,
      run,
      onState: vi.fn(),
    });
    queue.request();
    await flush();
    expect(run).not.toHaveBeenCalled();
    fingerprint = 'revision-1';
    queue.request();
    queue.request();
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    queue.request();
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    fingerprint = 'revision-2';
    queue.request();
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
    queue.stop();
  });

  it('retries incomplete downloads automatically with a delay', async () => {
    vi.useFakeTimers();
    const run = vi
      .fn()
      .mockResolvedValueOnce({ failed: 1, cancelled: false })
      .mockResolvedValue(ready);
    const onState = vi.fn();
    const queue = createAutomaticDownloadQueue({
      fingerprint: async () => 'revision',
      run,
      onState,
      retryMs: 1000,
    });
    queue.request();
    await flush();
    expect(onState).toHaveBeenLastCalledWith('pending');
    await vi.advanceTimersByTimeAsync(999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    expect(onState).toHaveBeenLastCalledWith('ready');
    queue.stop();
  });

  it('aborts on account teardown and cannot start another batch', async () => {
    let signal: AbortSignal | undefined;
    let finish!: (value: typeof ready) => void;
    const run = vi.fn((value: AbortSignal) => {
      signal = value;
      return new Promise<typeof ready>((resolve) => {
        finish = resolve;
      });
    });
    const onState = vi.fn();
    const queue = createAutomaticDownloadQueue({
      fingerprint: async () => 'revision',
      run,
      onState,
    });
    queue.request();
    await flush();
    queue.stop();
    expect(signal?.aborted).toBe(true);
    finish(ready);
    await flush();
    queue.request(true);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    expect(onState).not.toHaveBeenCalledWith('ready');
  });

  it('processes a checkpoint arriving during a download after the current one finishes', async () => {
    let fingerprint = 'one';
    let finish!: (value: typeof ready) => void;
    const run = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<typeof ready>((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(ready);
    const queue = createAutomaticDownloadQueue({
      fingerprint: async () => fingerprint,
      run,
      onState: vi.fn(),
    });
    queue.request();
    await flush();
    fingerprint = 'two';
    queue.request();
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    finish(ready);
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
    queue.stop();
  });
});
