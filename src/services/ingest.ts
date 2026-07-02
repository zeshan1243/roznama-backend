/**
 * Ingestion scheduler: runs each scraper/fetcher on its own cadence and writes
 * the latest snapshot to the DB (feed_snapshots). The API reads from the DB, so
 * user requests never trigger a live scrape — they read the last stored value.
 */
import { saveSnapshot } from '../lib/store.js';
import { supabaseConfigured } from '../config.js';
import { CITIES } from '../data/cities.js';
import { fetchCurrency, CurrencySnapshot } from './currency.js';
import { fetchCrypto } from './crypto.js';
import { fetchStocks } from './stocks.js';
import { fetchMarkets } from './markets.js';
import { fetchWeather } from './weather.js';
import { fetchPetrol } from './petrol.js';
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
}

const MIN = 60_000;

const FEEDS: Feed[] = [
  {
    key: 'currency',
    intervalMs: 5 * MIN,
    producer: fetchCurrency,
    // Accumulate the USD/PKR daily series from each scrape.
    after: async (data) => {
      const usd = (data as CurrencySnapshot).rates.find((r) => r.code === 'USD');
      if (usd) await recordUsdPkr((usd.interbankBuy + usd.interbankSell) / 2);
    },
  },
  { key: 'crypto', intervalMs: 2 * MIN, producer: fetchCrypto },
  { key: 'stocks', intervalMs: 6 * 60 * MIN, producer: fetchStocks },
  { key: 'markets', intervalMs: 5 * MIN, producer: fetchMarkets },
  { key: 'petrol', intervalMs: 60 * MIN, producer: fetchPetrol },
  { key: 'nss', intervalMs: 6 * 60 * MIN, producer: fetchNss },
  { key: 'news', intervalMs: 5 * MIN, producer: fetchNewsAll },
  { key: 'cricket', intervalMs: 5 * MIN, producer: fetchCricketAll },
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
    await saveSnapshot(feed.key, data);
    if (feed.after) await feed.after(data);
    console.log(`[ingest] ${feed.key} ✓`);
  } catch (err) {
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
