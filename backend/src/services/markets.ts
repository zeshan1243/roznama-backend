import { http, USER_AGENT } from '../lib/http.js';

export interface PsxIndexSnapshot {
  symbol: string;
  value: number;
  previousClose: number;
  fetchedAt: string;
  history: Array<{ time: string; value: number }>;
}

const INDICES = ['KSE100', 'KSE30', 'KMI30'];
// A handful of large-cap scrips for the "top movers" section.
const POPULAR = ['OGDC', 'PPL', 'LUCK', 'ENGRO', 'HBL', 'MCB', 'PSO', 'FFC', 'MARI', 'UBL'];

async function fetchTimeseries(symbol: string): Promise<PsxIndexSnapshot | null> {
  const resp = await http.get(`https://dps.psx.com.pk/timeseries/int/${symbol}`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (resp.status !== 200 || resp.data?.status !== 1) return null;
  const data = resp.data.data as Array<[number, number, number]>;
  if (!data?.length) return null;
  const sorted = [...data].sort((a, b) => a[0] - b[0]);
  const value = sorted[sorted.length - 1][1];
  const previousClose = sorted[0][1];
  const history = sorted.slice(-80).map(([t, v]) => ({
    time: new Date(t * 1000).toISOString(),
    value: v,
  }));
  return { symbol, value, previousClose, fetchedAt: new Date().toISOString(), history };
}

export interface MarketsSnapshot {
  indices: PsxIndexSnapshot[];
  movers: Array<{ symbol: string; value: number; changePercent: number }>;
  fetchedAt: string;
}

export async function fetchMarkets(): Promise<MarketsSnapshot> {
  const indices = (await Promise.all(INDICES.map(fetchTimeseries))).filter(
    (x): x is PsxIndexSnapshot => x !== null,
  );
  const moverSnaps = (await Promise.all(POPULAR.map(fetchTimeseries))).filter(
    (x): x is PsxIndexSnapshot => x !== null,
  );
  const movers = moverSnaps.map((s) => ({
    symbol: s.symbol,
    value: s.value,
    changePercent: s.previousClose === 0 ? 0 : ((s.value - s.previousClose) / s.previousClose) * 100,
  }));
  return { indices, movers, fetchedAt: new Date().toISOString() };
}
