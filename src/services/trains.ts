/**
 * Live train tracking, served entirely by our backend so the app never hits
 * traintracking.pk directly. traintracking.pk exposes public JSON routes that
 * proxy the Pakistan Railways GPS backend; we do the token dance, GPS fetch,
 * station-name resolution, and route parsing here, then hand the app clean JSON.
 *
 * Upstream calls:
 *   1. GET /api/live-trains          → roster (names EN/UR, route, number, flags)
 *   2. GET /api/lt                   → short-lived `x-lt` token
 *   3. GET /api/live-gps?all=1&t=…   → live GPS keyed by train number
 *   4. GET /api/live-gps?train=n&runs=1 → every active run of one train
 *   5. GET /data/StationsData.json   → station id → name/coords table
 *   6. GET /data/TrainStations.json  → per-train ordered route (stops + times)
 */
import { http } from '../lib/http.js';
import { cached } from '../lib/cache.js';

const BASE = 'https://traintracking.pk';

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
  Referer: `${BASE}/train`,
  Accept: 'application/json',
};

const DAY = 24 * 3600 * 1000;

// ---- Types (mirror the app's models) --------------------------------------

export interface Train {
  name: string;
  nameUr: string | null;
  routeText: string | null;
  trainNumber: number | null;
  trainId: number | null;
  isUp: boolean | null;
  isLive: boolean | null;
}

export interface TrainLive {
  trainNumber: number;
  lat: number | null;
  lon: number | null;
  speedKmh: number;
  lateByMin: number | null;
  nextStationEta: string | null;
  nextStationId: number | null;
  nextStation: string | null;
  nextStationUr: string | null;
  nextStationLat: number | null;
  nextStationLon: number | null;
  lastUpdated: string | null; // ISO 8601
  ageSec: number;
  isUp: boolean | null;
  rideCode: string | null;
}

export interface RouteStop {
  stationId: number;
  name: string;
  nameUr: string | null;
  lat: number | null;
  lon: number | null;
  order: number;
  schedArr: string | null;
  schedDep: string | null;
}

export interface StationName {
  name: string;
  nameUr: string | null;
  lat: number | null;
  lon: number | null;
}

export interface TrainsLiveSnapshot {
  fetchedAt: string;
  trains: Train[];
  live: Record<string, TrainLive>;
}

// ---- Coercion helpers ------------------------------------------------------

function toInt(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Math.trunc(v);
  const n = parseInt(String(v), 10);
  return Number.isNaN(n) ? null : n;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Trim a raw time to "HH:mm" (drops seconds), or null. */
function hhmm(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : s;
}

// ---- Station table (id → name/coords), memoized per process ---------------

let stationsCache: { at: number; map: Map<number, StationName> } | null = null;

async function loadStations(): Promise<Map<number, StationName>> {
  if (stationsCache && Date.now() - stationsCache.at < DAY) return stationsCache.map;
  const map = new Map<number, StationName>();
  try {
    const resp = await http.get(`${BASE}/data/StationsData.json`, { headers: HEADERS, timeout: 15_000 });
    const rows: unknown[] = resp.data?.Response ?? [];
    for (const r of rows) {
      if (typeof r !== 'object' || r === null) continue;
      const row = r as Record<string, unknown>;
      const id = toInt(row.StationDetailsId);
      const name = typeof row.StationName === 'string' ? row.StationName.trim() : '';
      if (id === null || !name) continue;
      map.set(id, {
        name,
        nameUr: typeof row.StationNameUR === 'string' ? row.StationNameUR.trim() : null,
        lat: toNum(row.Latitude),
        lon: toNum(row.Longitude),
      });
    }
  } catch (err) {
    console.warn('[trains] stations fetch failed:', err instanceof Error ? err.message : err);
    // Return whatever we last had rather than nothing.
    if (stationsCache) return stationsCache.map;
    return map;
  }
  if (map.size > 0) stationsCache = { at: Date.now(), map };
  return stationsCache?.map ?? map;
}

// ---- Roster ----------------------------------------------------------------

async function fetchRoster(): Promise<Train[]> {
  const resp = await http.get(`${BASE}/api/live-trains`, { headers: HEADERS });
  if (resp.status !== 200 || resp.data?.IsSuccess !== true) {
    throw new Error(`live-trains ${resp.status}`);
  }
  const rows: unknown[] = resp.data?.Response ?? [];
  const out: Train[] = [];
  for (const r of rows) {
    if (typeof r !== 'object' || r === null) continue;
    const row = r as Record<string, unknown>;
    const name = typeof row.TrainName === 'string' ? row.TrainName.trim() : '';
    if (!name) continue;
    out.push({
      name,
      nameUr: typeof row.TrainNameUR === 'string' ? row.TrainNameUR.trim() : null,
      routeText: typeof row.TrainDescription === 'string' ? row.TrainDescription.trim() : null,
      trainNumber: toInt(row.TrainNumber),
      trainId: toInt(row.TrainId),
      isUp: typeof row.IsUp === 'boolean' ? row.IsUp : null,
      isLive: typeof row.IsLive === 'boolean' ? row.IsLive : null,
    });
  }
  return out;
}

// ---- Token + GPS -----------------------------------------------------------

async function fetchToken(): Promise<string | null> {
  const resp = await http.get(`${BASE}/api/lt`, { headers: HEADERS, timeout: 10_000 });
  if (resp.status !== 200) return null;
  return typeof resp.data?.k === 'string' ? resp.data.k : null;
}

/** Parse one GPS row into a TrainLive, resolving the next station's names. */
function liveFromRow(
  row: Record<string, unknown>,
  stations: Map<number, StationName>,
  trainNumber?: number,
): TrainLive {
  const g = (typeof row.gps === 'object' && row.gps !== null ? row.gps : {}) as Record<string, unknown>;
  const lu = toInt(g.last_updated);
  const nextId = toInt(g.next_st);
  const st = nextId === null ? undefined : stations.get(nextId);
  return {
    trainNumber: trainNumber ?? toInt(row.trainNumber) ?? 0,
    lat: toNum(g.lat),
    lon: toNum(g.lon),
    speedKmh: toInt(g.sp) ?? 0,
    lateByMin: toInt(g.late_by),
    nextStationEta: typeof g.NextStationETA === 'string' ? g.NextStationETA.trim() : null,
    nextStationId: nextId,
    nextStation: st?.name ?? null,
    nextStationUr: st?.nameUr ?? null,
    nextStationLat: st?.lat ?? null,
    nextStationLon: st?.lon ?? null,
    lastUpdated: lu === null ? null : new Date(lu * 1000).toISOString(),
    ageSec: toInt(row.ageSec) ?? 0,
    isUp: typeof row.isUp === 'boolean' ? row.isUp : null,
    rideCode: row.rideCode === undefined || row.rideCode === null ? null : String(row.rideCode),
  };
}

async function fetchGps(stations: Map<number, StationName>): Promise<Record<string, TrainLive>> {
  const token = await fetchToken();
  const t = Date.now();
  const resp = await http.get(`${BASE}/api/live-gps?all=1&t=${t}`, {
    headers: token ? { ...HEADERS, 'x-lt': token } : HEADERS,
  });
  if (resp.status !== 200) throw new Error(`live-gps ${resp.status}`);
  const rows: unknown[] = resp.data?.trains ?? [];
  const out: Record<string, TrainLive> = {};
  for (const r of rows) {
    if (typeof r !== 'object' || r === null) continue;
    const live = liveFromRow(r as Record<string, unknown>, stations);
    if (live.trainNumber !== 0) out[String(live.trainNumber)] = live;
  }
  return out;
}

// ---- Public: live snapshot (roster + GPS overlay) --------------------------

async function produceLiveSnapshot(): Promise<TrainsLiveSnapshot> {
  const stationsP = loadStations();
  let trains: Train[] = [];
  try {
    trains = await fetchRoster();
  } catch (err) {
    console.warn('[trains] roster fetch failed:', err instanceof Error ? err.message : err);
  }
  const stations = await stationsP;
  let live: Record<string, TrainLive> = {};
  try {
    live = await fetchGps(stations);
  } catch (err) {
    console.warn('[trains] gps fetch failed:', err instanceof Error ? err.message : err);
  }
  return { fetchedAt: new Date().toISOString(), trains, live };
}

/** Roster + live GPS overlay. Cached briefly so bursts of clients share one
 *  upstream round-trip; GPS is inherently live so the TTL is short. */
export function getTrainsLive(): Promise<TrainsLiveSnapshot> {
  return cached('trains:live', 20, produceLiveSnapshot);
}

// ---- Public: active runs for one train -------------------------------------

async function produceRuns(trainNumber: number): Promise<TrainLive[]> {
  const stations = await loadStations();
  const token = await fetchToken();
  const t = Date.now();
  const resp = await http.get(`${BASE}/api/live-gps?train=${trainNumber}&runs=1&t=${t}`, {
    headers: token ? { ...HEADERS, 'x-lt': token } : HEADERS,
  });
  if (resp.status !== 200) throw new Error(`runs ${resp.status}`);
  const runs: unknown[] = resp.data?.runs ?? [];
  const out: TrainLive[] = [];
  for (const r of runs) {
    if (typeof r !== 'object' || r === null) continue;
    out.push(liveFromRow(r as Record<string, unknown>, stations, trainNumber));
  }
  out.sort((a, b) => (a.rideCode ?? '').localeCompare(b.rideCode ?? ''));
  return out;
}

export function getTrainRuns(trainNumber: number): Promise<TrainLive[]> {
  return cached(`trains:runs:${trainNumber}`, 15, () => produceRuns(trainNumber));
}

// ---- Per-train route (ordered stops), memoized per process -----------------

let routesCache: { at: number; map: Map<number, RouteStop[]> } | null = null;

async function loadAllRoutes(): Promise<Map<number, RouteStop[]>> {
  if (routesCache && Date.now() - routesCache.at < DAY) return routesCache.map;
  const resp = await http.get(`${BASE}/data/TrainStations.json`, { headers: HEADERS, timeout: 25_000 });
  if (resp.status !== 200) throw new Error(`routes ${resp.status}`);
  // TrainStations.json is a bare array (unlike the {Response:[…]} feeds).
  const decoded = resp.data;
  const rows: unknown[] = Array.isArray(decoded) ? decoded : (decoded?.Response ?? []);
  const map = new Map<number, RouteStop[]>();
  for (const r of rows) {
    if (typeof r !== 'object' || r === null) continue;
    const row = r as Record<string, unknown>;
    const id = toInt(row.TrainId);
    if (id === null) continue;
    const sts: unknown[] = (row.stations as unknown[]) ?? [];
    const stops: RouteStop[] = [];
    for (const s of sts) {
      if (typeof s !== 'object' || s === null) continue;
      const st = s as Record<string, unknown>;
      const sid = toInt(st.StationId);
      const name = typeof st.StationName === 'string' ? st.StationName.trim() : '';
      if (sid === null || !name) continue;
      stops.push({
        stationId: sid,
        name,
        nameUr: typeof st.StationNameUR === 'string' ? st.StationNameUR.trim() : null,
        lat: toNum(st.Latitude),
        lon: toNum(st.Longitude),
        order: toInt(st.OrderNumber) ?? 0,
        schedArr: hhmm(st.ArrivalTime),
        schedDep: hhmm(st.DepartureTime),
      });
    }
    stops.sort((a, b) => a.order - b.order);
    map.set(id, stops);
  }
  if (map.size > 0) routesCache = { at: Date.now(), map };
  return routesCache?.map ?? map;
}

/** Ordered route (stops with coords + scheduled times) for one TrainId, with
 *  Urdu station names resolved from the stations table. Empty on failure. */
export async function getTrainRoute(trainId: number): Promise<RouteStop[]> {
  let route: RouteStop[];
  try {
    route = (await loadAllRoutes()).get(trainId) ?? [];
  } catch (err) {
    console.warn('[trains] routes fetch failed:', err instanceof Error ? err.message : err);
    return [];
  }
  if (route.length === 0) return route;
  // TrainStations.json carries no Urdu names — resolve from the stations table.
  const stations = await loadStations();
  return route.map((s) =>
    s.nameUr === null && stations.get(s.stationId)?.nameUr
      ? { ...s, nameUr: stations.get(s.stationId)!.nameUr }
      : s,
  );
}
