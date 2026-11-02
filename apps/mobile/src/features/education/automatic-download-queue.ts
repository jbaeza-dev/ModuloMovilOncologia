/** Serial, cancelable downloads over complete catalog checkpoints. Never duplicates a batch. */
export function createAutomaticDownloadQueue(options: {
  fingerprint: () => Promise<string | null>;
  run: (signal: AbortSignal) => Promise<{ failed: number; cancelled: boolean }>;
  onState: (state: 'working' | 'ready' | 'pending') => void;
  retryMs?: number;
}) {
  const controller = new AbortController();
  let running = false,
    queued = false,
    forced = false,
    last: string | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let delay = options.retryMs ?? 30_000;
  function retryLater() {
    if (retry) clearTimeout(retry);
    retry = setTimeout(() => request(true), delay);
    delay = Math.min(delay * 2, 300_000);
  }
  function request(force = false) {
    if (controller.signal.aborted) return;
    queued = true;
    forced ||= force;
    if (!running) void drain();
  }
  async function drain() {
    running = true;
    try {
      while (queued && !controller.signal.aborted) {
        queued = false;
        const force = forced;
        forced = false;
        try {
          const fingerprint = await options.fingerprint();
          if (controller.signal.aborted || fingerprint === null || (!force && last === fingerprint))
            continue;
          last = fingerprint;
          if (retry) clearTimeout(retry);
          options.onState('working');
          const result = await options.run(controller.signal);
          if (controller.signal.aborted) return;
          if (result.failed || result.cancelled) {
            options.onState('pending');
            retryLater();
          } else {
            delay = options.retryMs ?? 30_000;
            options.onState('ready');
          }
        } catch {
          if (!controller.signal.aborted) {
            options.onState('pending');
            retryLater();
          }
        }
      }
    } finally {
      running = false;
    }
  }
  return {
    request,
    stop() {
      controller.abort();
      if (retry) clearTimeout(retry);
    },
  };
}
