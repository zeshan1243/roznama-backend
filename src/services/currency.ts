import * as cheerio from 'cheerio';
import { http, BROWSER_HEADERS } from '../lib/http.js';

export type BullionSource = 'localScrape' | 'internationalSpot' | 'fallbackStale';

export interface CurrencyRate {
  code: string;
  name: string;
  openMarketBuy: number;
  openMarketSell: number;
  interbankBuy: number;
  interbankSell: number;
}

export interface BullionPrices {
  gold24PerTola: number;
  gold22PerTola: number;
  silverPerTola: number;
  source: BullionSource;
}

export interface CurrencySnapshot {
  rates: CurrencyRate[];
  bullion: BullionPrices;
  fetchedAt: string;
  openMarketIsEstimated: boolean;
}

const FX_ENDPOINT = 'https://open.er-api.com/v6/latest/USD';
const SPOT_ENDPOINT = 'https://data-asg.goldprice.org/dbXRates/USD';
const FOREX_PK_URL = 'https://forex.pk/bullion-rates.php';
const HAMARIWEB_GOLD = 'https://hamariweb.com/finance/gold_rate/';
const HAMARIWEB_SILVER = 'https://hamariweb.com/finance/silver_rate/';

// 1 troy oz = 31.1034768 g; 1 tola = 11.6638038 g.
const TOLA_PER_OUNCE = 11.6638038 / 31.1034768;

interface PairMeta {
  code: string;
  name: string;
  spreadBuy: number;
  spreadSell: number;
}

const DISPLAY_PAIRS: PairMeta[] = [
  { code: 'USD', name: 'US Dollar', spreadBuy: 1.5, spreadSell: 2.5 },
  { code: 'SAR', name: 'Saudi Riyal', spreadBuy: 0.5, spreadSell: 0.8 },
  { code: 'AED', name: 'UAE Dirham', spreadBuy: 0.5, spreadSell: 0.8 },
  { code: 'GBP', name: 'British Pound', spreadBuy: 1.8, spreadSell: 3.0 },
  { code: 'EUR', name: 'Euro', spreadBuy: 1.6, spreadSell: 2.7 },
];

const STALE_FALLBACK: BullionPrices = {
  gold24PerTola: 493662,
  gold22PerTola: 452524,
  silverPerTola: 8513,
  source: 'fallbackStale',
};

async function fetchFx(): Promise<{ rates: CurrencyRate[]; pkrPerUsd: number }> {
  const resp = await http.get(FX_ENDPOINT, { headers: BROWSER_HEADERS });
  if (resp.status !== 200 || resp.data?.result !== 'success') {
    throw new Error(`FX API returned ${resp.status}`);
  }
  const rates = resp.data.rates as Record<string, number>;
  const pkrPerUsd = Number(rates.PKR);
  const out: CurrencyRate[] = [];
  for (const p of DISPLAY_PAIRS) {
    const perUsd = Number(rates[p.code]);
    if (!perUsd) continue;
    const ibMid = pkrPerUsd / perUsd;
    out.push({
      code: p.code,
      name: p.name,
      interbankBuy: ibMid - 0.2,
      interbankSell: ibMid + 0.2,
      openMarketBuy: ibMid + p.spreadBuy,
      openMarketSell: ibMid + p.spreadSell,
    });
  }
  return { rates: out, pkrPerUsd };
}

function extractNumber(text: string, re: RegExp): number | null {
  const m = re.exec(text);
  if (!m) return null;
  const raw = m[1]?.replace(/,/g, '').trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

function pageText(html: string): string {
  return cheerio.load(html)('body').text().replace(/\s+/g, ' ');
}

async function scrapeForexPk(): Promise<BullionPrices | null> {
  const resp = await http.get(FOREX_PK_URL, { headers: BROWSER_HEADERS, timeout: 8000 });
  if (resp.status !== 200) return null;
  const text = pageText(resp.data);
  const g24 = extractNumber(text, /24\s*K[^0-9]{0,80}([\d,]+(?:\.\d+)?)/i);
  const g22 = extractNumber(text, /22\s*K[^0-9]{0,80}([\d,]+(?:\.\d+)?)/i);
  const s = extractNumber(text, /Silver[^0-9]{0,120}([\d,]+(?:\.\d+)?)/i);
  if (g24 == null || g22 == null || s == null) return null;
  if (g24 < 100000 || g22 < 100000 || s < 1000) return null;
  return { gold24PerTola: g24, gold22PerTola: g22, silverPerTola: s, source: 'localScrape' };
}

async function scrapeHamariweb(): Promise<BullionPrices | null> {
  const [gold, silver] = await Promise.all([
    http.get(HAMARIWEB_GOLD, { headers: BROWSER_HEADERS, timeout: 8000 }),
    http.get(HAMARIWEB_SILVER, { headers: BROWSER_HEADERS, timeout: 8000 }),
  ]);
  if (gold.status !== 200 || silver.status !== 200) return null;
  const goldText = pageText(gold.data);
  const silverText = pageText(silver.data);
  const g24 = extractNumber(goldText, /24\s*K(?:arat)?[^0-9]{0,80}Rs?\.?\s*([\d,]+(?:\.\d+)?)/i);
  const g22 = extractNumber(goldText, /22\s*K(?:arat)?[^0-9]{0,80}Rs?\.?\s*([\d,]+(?:\.\d+)?)/i);
  const s =
    extractNumber(silverText, /(?:Silver|چاندی)[^0-9]{0,200}(?:per\s*tola|tola)[^0-9]{0,80}Rs?\.?\s*([\d,]+(?:\.\d+)?)/i) ??
    extractNumber(silverText, /(?:Silver|چاندی)[^0-9]{0,80}Rs?\.?\s*([\d,]+(?:\.\d+)?)/i);
  if (g24 == null || g22 == null || s == null) return null;
  if (g24 < 100000 || g22 < 100000 || s < 1000) return null;
  return { gold24PerTola: g24, gold22PerTola: g22, silverPerTola: s, source: 'localScrape' };
}

async function spotFallback(pkrPerUsd: number): Promise<BullionPrices> {
  const resp = await http.get(SPOT_ENDPOINT, {
    headers: { ...BROWSER_HEADERS, Referer: 'https://goldprice.org/', Origin: 'https://goldprice.org' },
  });
  if (resp.status !== 200) throw new Error(`Spot API returned ${resp.status}`);
  const items = resp.data?.items as Array<{ xauPrice: number; xagPrice: number }>;
  if (!items?.length) throw new Error('Spot API returned no items');
  const { xauPrice, xagPrice } = items[0];
  const gold24 = xauPrice * pkrPerUsd * TOLA_PER_OUNCE;
  return {
    gold24PerTola: gold24,
    gold22PerTola: gold24 * (22 / 24),
    silverPerTola: xagPrice * pkrPerUsd * TOLA_PER_OUNCE,
    source: 'internationalSpot',
  };
}

async function fetchBullion(pkrPerUsd: number): Promise<BullionPrices> {
  for (const attempt of [scrapeForexPk, scrapeHamariweb]) {
    try {
      const r = await attempt();
      if (r) return r;
    } catch {
      /* try next tier */
    }
  }
  try {
    return await spotFallback(pkrPerUsd);
  } catch {
    return STALE_FALLBACK;
  }
}

export async function fetchCurrency(): Promise<CurrencySnapshot> {
  const fx = await fetchFx();
  const bullion = await fetchBullion(fx.pkrPerUsd);
  return {
    rates: fx.rates,
    bullion,
    fetchedAt: new Date().toISOString(),
    openMarketIsEstimated: true,
  };
}
