import { http } from '../lib/http.js';

export type CryptoSource = 'coinGecko' | 'binance';

export interface CryptoCoin {
  id: string;
  symbol: string;
  name: string;
  priceUsd: number;
  pricePkr: number;
  change24hPercent: number;
}

export interface CryptoSnapshot {
  coins: CryptoCoin[];
  fetchedAt: string;
  source: CryptoSource;
}

interface CoinMeta {
  id: string;
  symbol: string;
  name: string;
  binanceSymbol: string | null;
}

const COINS: CoinMeta[] = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', binanceSymbol: 'BTCUSDT' },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', binanceSymbol: 'ETHUSDT' },
  { id: 'tether', symbol: 'USDT', name: 'Tether', binanceSymbol: null },
  { id: 'binancecoin', symbol: 'BNB', name: 'BNB', binanceSymbol: 'BNBUSDT' },
  { id: 'solana', symbol: 'SOL', name: 'Solana', binanceSymbol: 'SOLUSDT' },
  { id: 'ripple', symbol: 'XRP', name: 'XRP', binanceSymbol: 'XRPUSDT' },
  { id: 'cardano', symbol: 'ADA', name: 'Cardano', binanceSymbol: 'ADAUSDT' },
  { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin', binanceSymbol: 'DOGEUSDT' },
];

const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price';
const BINANCE_URL = 'https://api.binance.com/api/v3/ticker/24hr';
const FX_ENDPOINT = 'https://open.er-api.com/v6/latest/USD';

async function fetchCoinGecko(): Promise<CryptoCoin[]> {
  const resp = await http.get(COINGECKO_URL, {
    params: {
      ids: COINS.map((c) => c.id).join(','),
      vs_currencies: 'usd,pkr',
      include_24hr_change: 'true',
    },
    headers: { Accept: 'application/json' },
  });
  if (resp.status !== 200) throw new Error(`CoinGecko returned ${resp.status}`);
  const body = resp.data as Record<string, Record<string, number>>;
  const out: CryptoCoin[] = [];
  for (const meta of COINS) {
    const e = body[meta.id];
    if (!e) continue;
    const usd = e.usd;
    const pkr = e.pkr;
    if (usd == null || pkr == null) continue;
    out.push({
      id: meta.id,
      symbol: meta.symbol,
      name: meta.name,
      priceUsd: usd,
      pricePkr: pkr,
      change24hPercent: e.usd_24h_change ?? 0,
    });
  }
  return out;
}

async function fetchPkrRate(): Promise<number> {
  const resp = await http.get(FX_ENDPOINT, { headers: { Accept: 'application/json' } });
  if (resp.status !== 200) throw new Error(`FX API returned ${resp.status}`);
  return Number(resp.data.rates.PKR);
}

async function fetchBinance(): Promise<CryptoCoin[]> {
  const pkrPerUsd = await fetchPkrRate();
  const withPairs = COINS.filter((c) => c.binanceSymbol);
  const resp = await http.get(BINANCE_URL, {
    params: { symbols: JSON.stringify(withPairs.map((c) => c.binanceSymbol)) },
    headers: { Accept: 'application/json' },
  });
  if (resp.status !== 200) throw new Error(`Binance returned ${resp.status}`);
  const rows = resp.data as Array<{ symbol: string; lastPrice: string; priceChangePercent: string }>;
  const bySymbol = new Map(rows.map((r) => [r.symbol, r]));
  const out: CryptoCoin[] = [];
  for (const meta of withPairs) {
    const row = bySymbol.get(meta.binanceSymbol!);
    if (!row) continue;
    const usd = Number(row.lastPrice);
    if (!Number.isFinite(usd)) continue;
    out.push({
      id: meta.id,
      symbol: meta.symbol,
      name: meta.name,
      priceUsd: usd,
      pricePkr: usd * pkrPerUsd,
      change24hPercent: Number(row.priceChangePercent) || 0,
    });
  }
  if (!out.length) throw new Error('Binance returned no usable rows');
  return out;
}

export async function fetchCrypto(): Promise<CryptoSnapshot> {
  try {
    const coins = await fetchCoinGecko();
    if (coins.length) {
      return { coins, fetchedAt: new Date().toISOString(), source: 'coinGecko' };
    }
  } catch {
    /* fall through to Binance */
  }
  const coins = await fetchBinance();
  return { coins, fetchedAt: new Date().toISOString(), source: 'binance' };
}
