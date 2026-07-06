import * as cheerio from 'cheerio';
import { http, USER_AGENT } from '../lib/http.js';

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

export async function fetchPetrol(): Promise<PetrolSnapshot> {
  const resp = await http.get('https://www.pakwheels.com/petroleum-prices-in-pakistan', {
    headers: { 'User-Agent': USER_AGENT },
    timeout: 10000,
  });
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
