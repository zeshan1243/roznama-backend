import * as cheerio from 'cheerio';
import { http, USER_AGENT } from '../lib/http.js';
import { bundled } from '../lib/bundled.js';

export type PetrolSource = 'live' | 'bundled';

export interface FuelPrice {
  key: string;
  labelEn: string;
  labelUr: string;
  price: number;
  previous: number;
}

export interface PetrolHistoryPoint {
  month: string;
  premium: number;
}

export interface PetrolSnapshot {
  effectiveFrom: string;
  nextRevision: string;
  fuels: FuelPrice[];
  history: PetrolHistoryPoint[];
  source: PetrolSource;
  fetchedAt: string;
}

interface BundledPetrol {
  effective_from: string;
  next_revision: string;
  fuels: Array<{ key: string; label_en: string; label_ur: string; price: number; previous: number }>;
  history: Array<{ month: string; premium: number }>;
}

function loadBundled(): PetrolSnapshot {
  const j = bundled<BundledPetrol>('petrol_prices.json');
  return {
    effectiveFrom: j.effective_from,
    nextRevision: j.next_revision,
    fuels: j.fuels.map((f) => ({
      key: f.key,
      labelEn: f.label_en,
      labelUr: f.label_ur,
      price: f.price,
      previous: f.previous,
    })),
    history: j.history,
    source: 'bundled',
    fetchedAt: new Date().toISOString(),
  };
}

function num(text: string, re: RegExp): number | null {
  const m = re.exec(text);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) ? n : null;
}

export async function fetchPetrol(): Promise<PetrolSnapshot> {
  const base = loadBundled();
  try {
    const resp = await http.get('https://www.pakwheels.com/petroleum-prices-in-pakistan', {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 10000,
    });
    if (resp.status !== 200) return base;
    const text = cheerio.load(resp.data)('body').text().replace(/\s+/g, ' ');
    const premium = num(text, /Petrol[^0-9]{0,80}?(\d{2,3}(?:\.\d{1,2})?)/i);
    const diesel = num(text, /High[\s-]*Speed[\s-]*Diesel[^0-9]{0,80}?(\d{2,3}(?:\.\d{1,2})?)/i);
    const kerosene = num(text, /Kerosene[^0-9]{0,80}?(\d{2,3}(?:\.\d{1,2})?)/i);
    if (premium == null || diesel == null || premium < 100 || diesel < 100) return base;
    const priceFor = (key: string, fallback: number): number => {
      if (key === 'premium') return premium;
      if (key === 'diesel') return diesel;
      if (key === 'kerosene' && kerosene != null) return kerosene;
      return fallback;
    };
    return {
      ...base,
      source: 'live',
      fetchedAt: new Date().toISOString(),
      fuels: base.fuels.map((f) => ({ ...f, previous: f.price, price: priceFor(f.key, f.price) })),
    };
  } catch {
    return base;
  }
}
