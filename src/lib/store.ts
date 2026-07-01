import { supabaseAdmin } from './supabase.js';
import { supabaseConfigured } from '../config.js';

export interface Snapshot<T> {
  data: T;
  fetchedAt: string;
}

/** Upsert the latest payload for a feed key. */
export async function saveSnapshot<T>(key: string, data: T): Promise<void> {
  if (!supabaseConfigured) return;
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin()
    .from('feed_snapshots')
    .upsert({ key, data, fetched_at: now, updated_at: now }, { onConflict: 'key' });
  if (error) throw new Error(`saveSnapshot(${key}): ${error.message}`);
}

/** Read the latest stored payload for a feed key, or null if none. */
export async function readSnapshot<T>(key: string): Promise<Snapshot<T> | null> {
  if (!supabaseConfigured) return null;
  const { data, error } = await supabaseAdmin()
    .from('feed_snapshots')
    .select('data, fetched_at')
    .eq('key', key)
    .maybeSingle();
  if (error) throw new Error(`readSnapshot(${key}): ${error.message}`);
  if (!data) return null;
  return { data: data.data as T, fetchedAt: data.fetched_at as string };
}

/**
 * Serve a feed from the DB. If nothing is stored yet (cold start before the
 * scheduler's first run), fetch live once, persist it, and return it — so the
 * API is never blank. Falls back to a live fetch if the DB is unavailable.
 */
export async function served<T>(key: string, producer: () => Promise<T>): Promise<T> {
  try {
    const snap = await readSnapshot<T>(key);
    if (snap) return snap.data;
  } catch {
    /* DB unavailable — fall through to a live fetch */
  }
  const fresh = await producer();
  saveSnapshot(key, fresh).catch(() => {});
  return fresh;
}
