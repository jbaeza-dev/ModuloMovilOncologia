import type { OperationId } from '@quimiocare/contracts';
import type { ErrorCode } from './errors.js';
export const VERSION = '0.1.0';
export interface LogEntry {
  event: 'request' | 'startup' | 'shutdown' | 'dependency';
  requestId?: string;
  operation?: OperationId | 'readiness' | 'unmatched';
  durationMs?: number;
  status?: number;
  errorCode?: ErrorCode;
  dependency?: 'database' | 'clinical' | 'ai';
  state?: 'ready' | 'unavailable';
}
export type Logger = (entry: LogEntry) => void;
// Allowlist projection: callers cannot accidentally serialize request/error/config objects.
export function createLogger(
  write: (line: string) => void = (line) => process.stdout.write(line),
): Logger {
  return (entry) => {
    const value = {
      timestamp: new Date().toISOString(),
      service: 'quimiocare-gateway',
      version: VERSION,
      event: entry.event,
      requestId: entry.requestId,
      operation: entry.operation,
      durationMs: entry.durationMs,
      status: entry.status,
      errorCode: entry.errorCode,
      dependency: entry.dependency,
      state: entry.state,
    };
    write(JSON.stringify(value) + '\n');
  };
}
