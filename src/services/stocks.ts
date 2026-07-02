import { http } from '../lib/http.js';

export interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  previousClose?: number | null;
  volume?: number | null;
  latestTradingDay?: string | null;
}

export interface StockSnapshot {
  quotes: StockQuote[];
  fetchedAt: string;
  limitReached: boolean;
}

// Keyless Yahoo Finance chart API — same source the FX-history feed uses. No
// punishing daily cap (unlike Alpha Vantage), so the whole watchlist loads.
const YAHOO_CHART = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YAHOO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
};
const BATCH_SIZE = 8;

// Curated global large-caps (US-listed, incl. major ADRs so everything quotes
// in USD). Order = display order.
const WATCHLIST: Array<{ symbol: string; name: string }> = [
  { symbol: 'AAPL', name: 'Apple' },
  { symbol: 'MSFT', name: 'Microsoft' },
  { symbol: 'NVDA', name: 'Nvidia' },
  { symbol: 'GOOGL', name: 'Alphabet (Google)' },
  { symbol: 'AMZN', name: 'Amazon' },
  { symbol: 'META', name: 'Meta (Facebook)' },
  { symbol: 'TSLA', name: 'Tesla' },
  { symbol: 'BRK-B', name: 'Berkshire Hathaway' },
  { symbol: 'JPM', name: 'JPMorgan Chase' },
  { symbol: 'V', name: 'Visa' },
  { symbol: 'MA', name: 'Mastercard' },
  { symbol: 'WMT', name: 'Walmart' },
  { symbol: 'JNJ', name: 'Johnson & Johnson' },
  { symbol: 'XOM', name: 'ExxonMobil' },
  { symbol: 'PG', name: 'Procter & Gamble' },
  { symbol: 'KO', name: 'Coca-Cola' },
  { symbol: 'PEP', name: 'PepsiCo' },
  { symbol: 'DIS', name: 'Disney' },
  { symbol: 'MCD', name: "McDonald's" },
  { symbol: 'NKE', name: 'Nike' },
  { symbol: 'NFLX', name: 'Netflix' },
  { symbol: 'AMD', name: 'AMD' },
  { symbol: 'INTC', name: 'Intel' },
  { symbol: 'ORCL', name: 'Oracle' },
  { symbol: 'CRM', name: 'Salesforce' },
  { symbol: 'ADBE', name: 'Adobe' },
  { symbol: 'IBM', name: 'IBM' },
  { symbol: 'BA', name: 'Boeing' },
  { symbol: 'UBER', name: 'Uber' },
  { symbol: 'PYPL', name: 'PayPal' },
  { symbol: 'BABA', name: 'Alibaba' },
  { symbol: 'TSM', name: 'TSMC' },
];

function toNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchQuote(meta: { symbol: string; name: string }): Promise<StockQuote | null> {
  try {
    const resp = await http.get(`${YAHOO_CHART}/${meta.symbol}`, {
      params: { interval: '1d', range: '1d' },
      headers: YAHOO_HEADERS,
      timeout: 10000,
    });
    if (resp.status !== 200) return null;
    const result = resp.data?.chart?.result?.[0];
    const m = result?.meta;
    if (!m) return null;
    const price = toNum(m.regularMarketPrice);
    if (price == null) return null;
    const prevClose = toNum(m.chartPreviousClose) ?? toNum(m.previousClose);
    const change = prevClose == null ? 0 : price - prevClose;
    const pct = prevClose == null || prevClose === 0 ? 0 : (change / prevClose) * 100;
    // Day open lives in the intraday quote arrays, not meta.
    const opens = (result?.indicators?.quote?.[0]?.open as unknown[] | undefined)?.filter(
      (v): v is number => typeof v === 'number',
    );
    const tradingTime = toNum(m.regularMarketTime);
    return {
      symbol: meta.symbol,
      name: meta.name,
      price,
      change,
      changePercent: pct,
      open: opens && opens.length ? opens[0] : null,
      high: toNum(m.regularMarketDayHigh),
      low: toNum(m.regularMarketDayLow),
      previousClose: prevClose,
      volume: toNum(m.regularMarketVolume),
      latestTradingDay: tradingTime ? new Date(tradingTime * 1000).toISOString().slice(0, 10) : null,
    };
  } catch {
    return null;
  }
}

export async function fetchStocks(): Promise<StockSnapshot> {
  const quotes: StockQuote[] = [];
  for (let i = 0; i < WATCHLIST.length; i += BATCH_SIZE) {
    const batch = WATCHLIST.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(fetchQuote));
    for (const q of results) if (q) quotes.push(q);
  }
  return { quotes, fetchedAt: new Date().toISOString(), limitReached: false };
}
