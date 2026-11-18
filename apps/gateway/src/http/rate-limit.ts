/**
 * Límite de solicitudes por cuenta con un «balde de fichas» (token bucket).
 *
 * Cada cuenta parte con `perMinute` fichas, gasta una por solicitud y recupera fichas de forma
 * continua hasta completar `perMinute` cada 60 s. Así se toleran ráfagas cortas (por ejemplo, la
 * sincronización al abrir la app) y se frena un uso abusivo sostenido.
 *
 * El estado vive en la memoria de cada instancia: con varias instancias detrás de un balanceador
 * el límite efectivo se multiplica por la cantidad de instancias. Para un límite global habría que
 * guardar los baldes en un almacén compartido (por ejemplo, Redis).
 */
export interface RateLimitResult {
  allowed: boolean;
  /** Segundos enteros sugeridos para reintentar cuando no se permite (cabecera Retry-After). */
  retryAfterSeconds: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const WINDOW_MS = 60_000;
/** Por sobre esta cantidad de cuentas en memoria se descartan los baldes ya llenos. */
const MAX_BUCKETS = 10_000;

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private readonly refillPerMs: number;

  constructor(
    private readonly perMinute: number,
    private readonly now: () => number = () => Date.now(),
  ) {
    if (!Number.isSafeInteger(perMinute) || perMinute < 1)
      throw new Error('El límite por minuto debe ser un entero positivo.');
    this.refillPerMs = perMinute / WINDOW_MS;
  }

  take(key: string): RateLimitResult {
    const at = this.now();
    const bucket = this.refill(this.buckets.get(key), at);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      this.buckets.set(key, bucket);
      this.prune(at);
      return { allowed: true, retryAfterSeconds: 0 };
    }
    this.buckets.set(key, bucket);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((1 - bucket.tokens) / this.refillPerMs / 1000)),
    };
  }

  /** Cantidad de cuentas con estado en memoria (para pruebas y diagnóstico). */
  get size(): number {
    return this.buckets.size;
  }

  private refill(bucket: Bucket | undefined, at: number): Bucket {
    if (!bucket) return { tokens: this.perMinute, updatedAt: at };
    const elapsed = Math.max(0, at - bucket.updatedAt);
    return {
      tokens: Math.min(this.perMinute, bucket.tokens + elapsed * this.refillPerMs),
      updatedAt: at,
    };
  }

  private prune(at: number) {
    if (this.buckets.size <= MAX_BUCKETS) return;
    for (const [key, bucket] of this.buckets)
      if (this.refill(bucket, at).tokens >= this.perMinute) this.buckets.delete(key);
  }
}
