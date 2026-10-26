import { cp } from 'node:fs/promises';
await cp(
  new URL('../src/persistence/migrations/', import.meta.url),
  new URL('../dist/persistence/migrations/', import.meta.url),
  { recursive: true },
);
