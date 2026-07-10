import * as cheerio from 'cheerio';
import { http, USER_AGENT } from '../lib/http.js';

/**
 * PakWheels sits behind Cloudflare, which intermittently 403s datacenter IPs
 * (Railway) — a bare User-Agent makes the bot score worse. Send a realistic
 * browser navigation profile and retry with backoff; blocks are usually
 * per-request, so a second attempt often passes.
 */
const SCRAPE_HEADERS: Record<string, string> = {
  'User-Agent': USER_AGENT,
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,ur;q=0.8',
  Referer: 'https://www.google.com/',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'cross-site',
  'Sec-Fetch-User': '?1',
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type PetrolSource = 'live';

export interface FuelPrice {
  key: string;
  labelEn: string;
  labelUr: string;
  price: number;
  previous: number;
}

export interface PetrolSnapshot {
  effectiveFrom: string;
  fuels: FuelPrice[];
  source: PetrolSource;
  fetchedAt: string;
}

/**
 * Fuel presentation metadata (keys + bilingual labels). This is display config,
 * not price data — prices and the effective date are all scraped live. `match`
 * tests the fuel-name cell from the source table.
 */
const FUELS: Array<{
  key: string;
  labelEn: string;
  labelUr: string;
  match: (name: string) => boolean;
}> = [
  {
    key: 'premium',
    labelEn: 'Premium Petrol',
    labelUr: 'پریمیئم پیٹرول',
    match: (n) => n.startsWith('petrol'),
  },
  {
    key: 'diesel',
    labelEn: 'High-Speed Diesel',
    labelUr: 'ہائی اسپیڈ ڈیزل',
    match: (n) => n.includes('high speed diesel'),
  },
  {
    key: 'light_diesel',
    labelEn: 'Light Diesel',
    labelUr: 'لائٹ ڈیزل',
    match: (n) => n.includes('light speed diesel') || n.includes('light diesel'),
  },
  {
    key: 'kerosene',
    labelEn: 'Kerosene',
    labelUr: 'مٹی کا تیل',
    match: (n) => n.includes('kerosene'),
  },
];

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/** "PKR 299.5" / "Rs. 297.53/Ltr" -> 297.53 (null if no sensible number). */
function parsePrice(text: string): number | null {
  const m = /([\d]+(?:\.\d+)?)/.exec(text.replace(/,/g, ''));
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** "w.e.f 04-July-2026" -> "2026-07-04" (null if not found / unparseable). */
function parseEffectiveFrom(bodyText: string): string | null {
  const m = /w\.e\.f\.?\s*(\d{1,2})[-\s]([A-Za-z]+)[-\s](\d{4})/i.exec(bodyText);
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS.indexOf(m[2].toLowerCase());
  const year = Number(m[3]);
  if (month < 0 || !Number.isFinite(day) || !Number.isFinite(year)) return null;
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

const SOURCE_URL = 'https://www.pakwheels.com/petroleum-prices-in-pakistan';

/** Direct scrape of the PakWheels HTML page. */
async function fetchDirect(): Promise<PetrolSnapshot> {
  const url = SOURCE_URL;
  let resp = await http.get(url, { headers: SCRAPE_HEADERS, timeout: 10000 });
  // Retry blocked/erroring responses with backoff (2s, 5s) before giving up —
  // the keep-last-good guard upstream means a hard failure only delays the
  // update until the next tick, but most CF blocks clear on retry.
  for (const delayMs of [2000, 5000]) {
    if (resp.status === 200) break;
    await sleep(delayMs);
    resp = await http.get(url, { headers: SCRAPE_HEADERS, timeout: 10000 });
  }
  if (resp.status !== 200) throw new Error(`petrol: source returned HTTP ${resp.status}`);

  const $ = cheerio.load(resp.data);

  // Prices: the "Fuel Type | Old Price | New Price | Difference" table. The
  // desktop and mobile layouts wrap it differently (.pricing-table-cont table
  // vs table.pricing-table) but share the same td order, so match any table
  // row — the fuel-name lookup below ignores rows from unrelated tables, and
  // header rows use <th> (zero <td>) so they're skipped.
  const fuels: FuelPrice[] = [];
  $('table tr').each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length < 3) return;
    const name = $(cells[0]).text().trim().toLowerCase();
    const previous = parsePrice($(cells[1]).text());
    const price = parsePrice($(cells[2]).text());
    if (previous == null || price == null) return;
    const meta = FUELS.find((f) => f.match(name));
    // Skip fuels we don't surface (LPG, CNG, …) and rows with no live price.
    if (!meta || price <= 0) return;
    if (fuels.some((f) => f.key === meta.key)) return; // first row wins
    fuels.push({ key: meta.key, labelEn: meta.labelEn, labelUr: meta.labelUr, price, previous });
  });

  const premium = fuels.find((f) => f.key === 'premium');
  const diesel = fuels.find((f) => f.key === 'diesel');
  if (!premium || !diesel || premium.price < 100 || diesel.price < 100) {
    throw new Error('petrol: could not parse a valid price table');
  }

  const effectiveFrom = parseEffectiveFrom($('body').text().replace(/\s+/g, ' '));
  if (!effectiveFrom) throw new Error('petrol: could not parse effective date');

  // No nextRevision: the source doesn't publish one, and the revision cadence
  // is set arbitrarily by the government (varies between ~5, 7, 15 days and
  // off-cycle), so any computed date would be a guess. We only surface the
  // real, scraped effective date.
  return {
    effectiveFrom,
    fuels,
    source: 'live',
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Second view of the same page through the r.jina.ai reader proxy with its
 * cache bypassed. Two failure modes of the direct scrape this covers:
 * Cloudflare 403s against datacenter IPs, and PakWheels' CDN serving
 * international visitors a stale page for hours after a revision (the
 * reader's origin fetch sees the fresh table). Returns markdown; rows look
 * like `| Petrol (Super) | PKR 299.5 | PKR 297.53 | 1.97 |`.
 */
async function fetchViaReader(): Promise<PetrolSnapshot> {
  const resp = await http.get<string>(`https://r.jina.ai/${SOURCE_URL}`, {
    // curl-ish UA + no-cache so the reader does a fresh origin fetch and
    // responds with plain markdown rather than its HTML wrapper.
    headers: { 'User-Agent': 'curl/8.4', Accept: 'text/plain', 'x-no-cache': 'true' },
    timeout: 30_000,
    responseType: 'text',
  });
  if (resp.status !== 200) throw new Error(`petrol reader: HTTP ${resp.status}`);
  const text = String(resp.data);

  const fuels: FuelPrice[] = [];
  for (const line of text.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue;
    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (cells.length < 3) continue;
    const name = cells[0].toLowerCase();
    const meta = FUELS.find((f) => f.match(name));
    if (!meta || fuels.some((f) => f.key === meta.key)) continue;
    const previous = parsePrice(cells[1]);
    const price = parsePrice(cells[2]);
    if (previous == null || price == null || price <= 0) continue;
    fuels.push({ key: meta.key, labelEn: meta.labelEn, labelUr: meta.labelUr, price, previous });
  }

  const premium = fuels.find((f) => f.key === 'premium');
  const diesel = fuels.find((f) => f.key === 'diesel');
  if (!premium || !diesel || premium.price < 100 || diesel.price < 100) {
    throw new Error('petrol reader: could not parse a valid price table');
  }
  const effectiveFrom = parseEffectiveFrom(text.replace(/\s+/g, ' '));
  if (!effectiveFrom) throw new Error('petrol reader: could not parse effective date');

  return {
    effectiveFrom,
    fuels,
    source: 'live',
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Both views are fetched in parallel and the one with the NEWER effective
 * date wins — so a revision reaches the feed as soon as either path sees
 * it, and one path failing (403, reader outage) never blocks the update.
 * Throws only when both fail (keep-last-good upstream preserves the
 * stored snapshot).
 */
export async function fetchPetrol(): Promise<PetrolSnapshot> {
  const [direct, reader] = await Promise.allSettled([fetchDirect(), fetchViaReader()]);
  const results = [direct, reader]
    .filter((s): s is PromiseFulfilledResult<PetrolSnapshot> => s.status === 'fulfilled')
    .map((s) => s.value);
  if (results.length === 0) {
    const why = [direct, reader]
      .map((s) => (s.status === 'rejected' ? String((s.reason as Error)?.message ?? s.reason) : ''))
      .filter(Boolean)
      .join(' / ');
    throw new Error(`petrol: both sources failed — ${why}`);
  }
  results.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return results[0];
}
