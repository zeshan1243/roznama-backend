import { http } from '../lib/http.js';
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

// Yahoo's chart endpoint exposes the USD→PKR pair (`PKR=X`) keylessly and
// daily — a full back-history, unlike the self-accumulating DB series which
// only grows from first deploy.
const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};

/** Record (upsert) today's USD/PKR rate into the self-populating series. */
export async function recordUsdPkr(rate: number): Promise<void> {
  if (!supabaseConfigured || !Number.isFinite(rate)) return;
  const day = new Date().toISOString().slice(0, 10);
  const { error } = await supabaseAdmin()
    .from('fx_history')
    .upsert({ day, usd_pkr: rate, updated_at: new Date().toISOString() }, { onConflict: 'day' });
  if (error) throw new Error(`recordUsdPkr: ${error.message}`);
}

async function fetchYahoo(range: FxHistoryRange): Promise<FxHistoryPoint[]> {
  const end = Math.floor(Date.now() / 1000);
  const start = end - DAYS[range] * 86400;
  const resp = await http.get(`${YAHOO_CHART}/PKR=X`, {
    params: { period1: start, period2: end, interval: '1d' },
    headers: YAHOO_HEADERS,
    timeout: 12000,
  });
  if (resp.status !== 200) throw new Error(`FX history HTTP ${resp.status}`);
  const result = resp.data?.chart?.result?.[0];
  const timestamps = result?.timestamp as number[] | undefined;
  const closes = result?.indicators?.quote?.[0]?.close as Array<number | null> | undefined;
  if (!timestamps?.length || !closes?.length) throw new Error('FX history returned no rates');
  const points: FxHistoryPoint[] = [];
  for (let i = 0; i < timestamps.length && i < closes.length; i++) {
    const v = closes[i];
    if (v == null || !Number.isFinite(v)) continue; // Yahoo pads weekends with null.
    points.push({ date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10), rate: v });
  }
  if (!points.length) throw new Error('FX history parse produced no points');
  return points;
}

async function fetchFromDb(range: FxHistoryRange): Promise<FxHistoryPoint[]> {
  if (!supabaseConfigured) return [];
  const since = new Date(Date.now() - DAYS[range] * 86400_000).toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin()
    .from('fx_history')
    .select('day, usd_pkr')
    .gte('day', since)
    .order('day', { ascending: true });
  if (error) throw new Error(`getFxHistory: ${error.message}`);
  return (data ?? []).map((row) => ({ date: row.day as string, rate: Number(row.usd_pkr) }));
}

/**
 * USD/PKR series for a range window. Prefers Yahoo (full back-history); falls
 * back to the self-accumulated DB series if Yahoo is unreachable.
 */
export async function getFxHistory(range: FxHistoryRange): Promise<FxHistorySnapshot> {
  let points: FxHistoryPoint[] = [];
  try {
    points = await fetchYahoo(range);
  } catch {
    try {
      points = await fetchFromDb(range);
    } catch {
      points = [];
    }
  }
  return { range, points, fetchedAt: new Date().toISOString() };
}
