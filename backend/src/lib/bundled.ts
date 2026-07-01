import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// src/lib -> ../../data (works for both tsx dev and compiled dist since data/
// is copied alongside; see package layout in README).
const DATA_DIR = join(here, '..', '..', 'data');

const cache = new Map<string, unknown>();

/** Reads and parses a bundled JSON file from web/backend/data/. */
export function bundled<T>(file: string): T {
  if (cache.has(file)) return cache.get(file) as T;
  const raw = readFileSync(join(DATA_DIR, file), 'utf-8');
  const parsed = JSON.parse(raw) as T;
  cache.set(file, parsed);
  return parsed;
}
