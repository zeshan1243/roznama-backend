import * as cheerio from 'cheerio';
import { http, USER_AGENT } from '../lib/http.js';
import { bundled } from '../lib/bundled.js';

export interface NssRate {
  code: string;
  nameEn: string;
  nameUr: string;
  tenor: string;
  profitPct: number;
  payout: string;
  minInvest: number;
  notesEn: string;
}

export interface NssSnapshot {
  updatedAt: string;
  products: NssRate[];
  source: 'live' | 'bundled';
  fetchedAt: string;
}

interface BundledNss {
  updated_at: string;
  products: Array<{
    code: string;
    name_en: string;
    name_ur: string;
    tenor: string;
    profit_pct: number;
    payout: string;
    min_invest: number;
    notes_en: string;
  }>;
}

const ANCHORS: Record<string, string> = {
  DSC: 'Defence Savings',
  SSC: 'Special Savings Certificate',
  RIC: 'Regular Income Certificate',
  STC: 'Short Term Savings Certificate',
  BSC: 'Pensioner Benefit Account',
  SCA: 'Shuhada Family Welfare',
};

function loadBundled(): NssSnapshot {
  const j = bundled<BundledNss>('nss_rates.json');
  return {
    updatedAt: j.updated_at,
    products: j.products.map((p) => ({
      code: p.code,
      nameEn: p.name_en,
      nameUr: p.name_ur,
      tenor: p.tenor,
      profitPct: p.profit_pct,
      payout: p.payout,
      minInvest: p.min_invest,
      notesEn: p.notes_en,
    })),
    source: 'bundled',
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchNss(): Promise<NssSnapshot> {
  const base = loadBundled();
  try {
    const resp = await http.get('https://www.savings.gov.pk/profit-rates/', {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 10000,
    });
    if (resp.status !== 200) return base;
    const text = cheerio.load(resp.data)('body').text().replace(/\s+/g, ' ');
    let matched = 0;
    const products = base.products.map((p) => {
      const anchor = ANCHORS[p.code];
      if (!anchor) return p;
      const idx = text.toLowerCase().indexOf(anchor.toLowerCase());
      if (idx === -1) return p;
      const window = text.slice(idx, idx + 200);
      const m = /(\d{1,2}(?:\.\d{1,2})?)\s*%/.exec(window);
      const rate = m ? Number(m[1]) : NaN;
      if (Number.isFinite(rate) && rate > 0 && rate < 30) {
        matched++;
        return { ...p, profitPct: rate };
      }
      return p;
    });
    if (matched < 3) return base;
    return {
      updatedAt: new Date().toISOString().slice(0, 10),
      products,
      source: 'live',
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return base;
  }
}
