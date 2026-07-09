/**
 * Ingestion scheduler: runs each scraper/fetcher on its own cadence and writes
 * the latest snapshot to the DB (feed_snapshots). The API reads from the DB, so
 * user requests never trigger a live scrape — they read the last stored value.
 */
import { saveSnapshot, readSnapshot } from '../lib/store.js';
import { supabaseConfigured } from '../config.js';
import { CITIES } from '../data/cities.js';
import { fetchCurrency, CurrencySnapshot } from './currency.js';
import { fetchCrypto } from './crypto.js';
import { fetchStocks } from './stocks.js';
import { fetchMarkets } from './markets.js';
import { fetchWeather } from './weather.js';
import { fetchPetrol, PetrolSnapshot } from './petrol.js';
import { sendTopic, pushConfigured } from './push.js';
import { fetchNss } from './nss.js';
import { recordUsdPkr } from './fxHistory.js';
import { fetchNewsAll, fetchCricketAll } from './news.js';
import { refreshAyahOfDay } from './ayah.js';
import { refreshHadithOfDay } from './hadithOfDay.js';

interface Feed {
  key: string;
  intervalMs: number;
  producer: () => Promise<unknown>;
  after?: (data: unknown) => Promise<void>;
  /**
   * Guard that decides whether a freshly-produced value is good enough to
   * replace the stored snapshot. When it returns false (e.g. a scrape yielded
   * an empty list, or fell back to bundled data), we KEEP the last good
   * snapshot instead of overwriting it — so the app keeps showing the last
   * successfully-scraped data (with its original "last updated" timestamp).
   */
  accept?: (data: unknown) => boolean;
  /**
   * Called after a snapshot is stored, with the previous stored value (or null)
   * and the new one — for change-driven side effects like a topic push.
   */
  onChange?: (prev: unknown | null, next: unknown) => Promise<void>;
}

const MIN = 60_000;

const nonEmpty = (key: string) => (d: unknown): boolean =>
  Array.isArray((d as Record<string, unknown>)?.[key]) &&
  ((d as Record<string, unknown[]>)[key]).length > 0;

// Only persist a live scrape; if the producer fell back to bundled data, keep
// the last live snapshot rather than downgrading the stored copy.
const liveOnly = (d: unknown): boolean =>
  (d as { source?: string })?.source === 'live';

const FEEDS: Feed[] = [
  {
    key: 'currency',
    intervalMs: 5 * MIN,
    producer: fetchCurrency,
    accept: nonEmpty('rates'),
    // Accumulate the USD/PKR daily series from each scrape.
    after: async (data) => {
      const usd = (data as CurrencySnapshot).rates.find((r) => r.code === 'USD');
      if (usd) await recordUsdPkr((usd.interbankBuy + usd.interbankSell) / 2);
    },
  },
  { key: 'crypto', intervalMs: 2 * MIN, producer: fetchCrypto, accept: nonEmpty('coins') },
  { key: 'stocks', intervalMs: 6 * 60 * MIN, producer: fetchStocks, accept: nonEmpty('quotes') },
  { key: 'markets', intervalMs: 5 * MIN, producer: fetchMarkets, accept: nonEmpty('indices') },
  {
    key: 'petrol',
    intervalMs: 60 * MIN,
    producer: fetchPetrol,
    accept: liveOnly,
    // Push a broadcast when the effective (revision) date advances — i.e. a new
    // official price revision, not just a re-scrape.
    onChange: async (prev, next) => {
      if (!pushConfigured()) return;
      const p = prev as PetrolSnapshot | null;
      const n = next as PetrolSnapshot;
      if (!p || p.effectiveFrom === n.effectiveFrom) return;
      const petrol = n.fuels.find((f) => f.key === 'premium');
      const diesel = n.fuels.find((f) => f.key === 'diesel');
      const parts = [
        petrol && `Petrol Rs ${petrol.price}`,
        diesel && `Diesel Rs ${diesel.price}`,
      ].filter(Boolean).join('  ·  ');
      try {
        await sendTopic('petrol', {
          title: 'Petrol prices updated',
          body: `${parts} — effective ${n.effectiveFrom}`,
          data: { type: 'petrol' },
        });
        console.log('[ingest] petrol price change → pushed topic');
      } catch (err) {
        console.warn('[ingest] petrol topic push failed:', err instanceof Error ? err.message : err);
      }
    },
  },
  { key: 'nss', intervalMs: 6 * 60 * MIN, producer: fetchNss, accept: liveOnly },
  { key: 'news', intervalMs: 5 * MIN, producer: fetchNewsAll, accept: (d) => Array.isArray(d) && d.length > 0 },
  { key: 'cricket', intervalMs: 5 * MIN, producer: fetchCricketAll, accept: (d) => Array.isArray(d) && d.length > 0 },
  // Ayah of the day → app_content.ayah_today (idempotent per day; hourly check).
  { key: 'ayah', intervalMs: 60 * MIN, producer: refreshAyahOfDay },
  // Hadith of the day → app_content.hadith_today (idempotent per day).
  { key: 'hadithOfDay', intervalMs: 60 * MIN, producer: refreshHadithOfDay },
  // Per-city weather
  ...CITIES.map((c) => ({
    key: `weather:${c.id}`,
    intervalMs: 15 * MIN,
    producer: () => fetchWeather(c.id),
  })),
];

async function refresh(feed: Feed): Promise<void> {
  try {
    const data = await feed.producer();
    // Don't overwrite a good stored snapshot with an empty / fallback result —
    // keep serving the last successfully-scraped data instead.
    if (feed.accept && !feed.accept(data)) {
      console.warn(`[ingest] ${feed.key} ⏭ produced no usable data — keeping last snapshot`);
      return;
    }
    // Capture the previous stored value before overwriting, for onChange.
    let prev: unknown = null;
    if (feed.onChange) prev = (await readSnapshot(feed.key))?.data ?? null;
    await saveSnapshot(feed.key, data);
    if (feed.after) await feed.after(data);
    if (feed.onChange) await feed.onChange(prev, data);
    console.log(`[ingest] ${feed.key} ✓`);
  } catch (err) {
    // Producer threw (source unreachable) — the last snapshot is untouched, so
    // the API keeps serving it.
    console.warn(`[ingest] ${feed.key} ✗`, err instanceof Error ? err.message : err);
  }
}

/** Refresh every feed once (used on boot and by the manual /admin/refresh route). */
export async function refreshAll(): Promise<void> {
  // Small stagger so we don't fire ~25 outbound requests in the same tick.
  for (let i = 0; i < FEEDS.length; i++) {
    const feed = FEEDS[i];
    setTimeout(() => void refresh(feed), i * 400);
  }
}

/** Start the periodic scheduler (no-op if Supabase isn't configured). */
export function startScheduler(): void {
  if (!supabaseConfigured) {
    console.warn('[ingest] Supabase not configured — scheduler disabled (API will fetch live per-request).');
    return;
  }
  void refreshAll();
  for (const feed of FEEDS) {
    setInterval(() => void refresh(feed), feed.intervalMs);
  }
  console.log(`[ingest] scheduler started for ${FEEDS.length} feeds`);
}
