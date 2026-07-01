import { supabaseAdmin } from '../lib/supabase.js';
import { supabaseConfigured } from '../config.js';

export type FxHistoryRange = 'd30' | 'd90' | 'd365';

export interface FxHistoryPoint {
  date: string;
  rate: number;
}

export interface FxHistorySnapshot {
  range: FxHistoryRange;
  points: FxHistoryPoint[];
  fetchedAt: string;
}

const DAYS: Record<FxHistoryRange, number> = { d30: 30, d90: 90, d365: 365 };

/** Record (upsert) today's USD/PKR rate into the self-populating series. */
export async function recordUsdPkr(rate: number): Promise<void> {
  if (!supabaseConfigured || !Number.isFinite(rate)) return;
  const day = new Date().toISOString().slice(0, 10);
  const { error } = await supabaseAdmin()
    .from('fx_history')
    .upsert({ day, usd_pkr: rate, updated_at: new Date().toISOString() }, { onConflict: 'day' });
  if (error) throw new Error(`recordUsdPkr: ${error.message}`);
}

/** Read the USD/PKR series for a range window from the DB. */
export async function getFxHistory(range: FxHistoryRange): Promise<FxHistorySnapshot> {
  const points: FxHistoryPoint[] = [];
  if (supabaseConfigured) {
    const since = new Date(Date.now() - DAYS[range] * 86400_000).toISOString().slice(0, 10);
    const { data, error } = await supabaseAdmin()
      .from('fx_history')
      .select('day, usd_pkr')
      .gte('day', since)
      .order('day', { ascending: true });
    if (error) throw new Error(`getFxHistory: ${error.message}`);
    for (const row of data ?? []) points.push({ date: row.day, rate: Number(row.usd_pkr) });
  }
  return { range, points, fetchedAt: new Date().toISOString() };
}
