import { http } from '../lib/http.js';
import { config } from '../config.js';

export interface StockQuote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
}

export interface StockSnapshot {
  quotes: StockQuote[];
  fetchedAt: string;
  limitReached: boolean;
}

const WATCHLIST: Array<{ symbol: string; name: string }> = [
  { symbol: 'AAPL', name: 'Apple' },
  { symbol: 'MSFT', name: 'Microsoft' },
  { symbol: 'GOOGL', name: 'Alphabet' },
  { symbol: 'AMZN', name: 'Amazon' },
  { symbol: 'TSLA', name: 'Tesla' },
];

export async function fetchStocks(): Promise<StockSnapshot> {
  const quotes: StockQuote[] = [];
  let limitReached = false;
  for (const { symbol, name } of WATCHLIST) {
    const resp = await http.get('https://www.alphavantage.co/query', {
      params: { function: 'GLOBAL_QUOTE', symbol, apikey: config.alphaVantageKey },
    });
    const body = resp.data ?? {};
    if (body.Note || body.Information) {
      limitReached = true;
      break;
    }
    const q = body['Global Quote'];
    const price = Number(q?.['05. price']);
    if (!Number.isFinite(price)) continue;
    quotes.push({
      symbol,
      name,
      price,
      change: Number(q['09. change']) || 0,
      changePercent: Number(String(q['10. change percent'] ?? '').replace('%', '')) || 0,
    });
  }
  return { quotes, fetchedAt: new Date().toISOString(), limitReached };
}
