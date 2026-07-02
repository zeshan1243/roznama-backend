import { http } from '../lib/http.js';

export type CryptoSource = 'coinGecko' | 'binance';

export interface CryptoCoin {
  id: string;
  symbol: string;
  name: string;
  priceUsd: number;
  pricePkr: number;
  change24hPercent: number;
  // Rich metadata (CoinGecko coins/markets only; null on the Binance fallback).
  imageUrl?: string | null;
  marketCapRank?: number | null;
  marketCapUsd?: number | null;
  volumeUsd?: number | null;
  high24hUsd?: number | null;
  low24hUsd?: number | null;
  change1hPercent?: number | null;
  change7dPercent?: number | null;
  circulatingSupply?: number | null;
  maxSupply?: number | null;
  athUsd?: number | null;
  athChangePercent?: number | null;
  athDate?: string | null;
  atlUsd?: number | null;
  atlChangePercent?: number | null;
  atlDate?: string | null;
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

// coins/markets gives full metadata (market cap, ATH, supply, image). Prices are
// requested in USD; a single FX rate converts to PKR so the USD figures stay
// intact for the detail screen.
const COINGECKO_MARKETS = 'https://api.coingecko.com/api/v3/coins/markets';
const BINANCE_URL = 'https://api.binance.com/api/v3/ticker/24hr';
const FX_ENDPOINT = 'https://open.er-api.com/v6/latest/USD';

async function fetchPkrRate(): Promise<number> {
  const resp = await http.get(FX_ENDPOINT, { headers: { Accept: 'application/json' } });
  if (resp.status !== 200) throw new Error(`FX API returned ${resp.status}`);
  return Number(resp.data.rates.PKR);
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchCoinGecko(): Promise<CryptoCoin[]> {
  const [resp, pkrPerUsd] = await Promise.all([
    http.get(COINGECKO_MARKETS, {
      params: {
        vs_currency: 'usd',
        ids: COINS.map((c) => c.id).join(','),
        order: 'market_cap_desc',
        price_change_percentage: '1h,24h,7d',
        sparkline: 'false',
      },
      headers: { Accept: 'application/json' },
    }),
    fetchPkrRate(),
  ]);
  if (resp.status !== 200) throw new Error(`CoinGecko returned ${resp.status}`);
  const rows = resp.data as Array<Record<string, unknown>>;
  const byId = new Map(rows.map((r) => [String(r.id), r]));

  const out: CryptoCoin[] = [];
  // Preserve our curated order rather than CoinGecko's market-cap order.
  for (const meta of COINS) {
    const row = byId.get(meta.id);
    if (!row) continue;
    const usd = num(row.current_price);
    if (usd == null) continue;
    out.push({
      id: meta.id,
      symbol: meta.symbol,
      name: meta.name,
      priceUsd: usd,
      pricePkr: usd * pkrPerUsd,
      change24hPercent: num(row.price_change_percentage_24h) ?? 0,
      imageUrl: (row.image as string) ?? null,
      marketCapRank: num(row.market_cap_rank),
      marketCapUsd: num(row.market_cap),
      volumeUsd: num(row.total_volume),
      high24hUsd: num(row.high_24h),
      low24hUsd: num(row.low_24h),
      change1hPercent: num(row.price_change_percentage_1h_in_currency),
      change7dPercent: num(row.price_change_percentage_7d_in_currency),
      circulatingSupply: num(row.circulating_supply),
      maxSupply: num(row.max_supply),
      athUsd: num(row.ath),
      athChangePercent: num(row.ath_change_percentage),
      athDate: (row.ath_date as string) ?? null,
      atlUsd: num(row.atl),
      atlChangePercent: num(row.atl_change_percentage),
      atlDate: (row.atl_date as string) ?? null,
    });
  }
  return out;
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
