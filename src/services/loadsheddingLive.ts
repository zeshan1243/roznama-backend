/**
 * Live per-feeder loadshedding, proxied from PITC's CCMS portal so the app
 * never hits ccms.pitc.com.pk directly. Covers the WAPDA DISCOs (LESCO, IESCO,
 * MEPCO, GEPCO, FESCO, PESCO, HESCO, QESCO, …) — NOT K-Electric, which runs a
 * separate system.
 *
 * Upstream (reverse-engineered; same calls the wapda-monitor HA integration uses):
 *   GET /FeederDetails            → session cookies (best-effort)
 *   GET /get-loadinfo/{reference} → feeder identity, live status, per-hour outage
 *                                   minutes for the last few days (history_data)
 *                                   and planned maintenance windows (maintenance_data).
 * `reference` is the 14-digit consumer reference number printed on the bill.
 */
import { http } from '../lib/http.js';
import { cached, keepStale } from '../lib/cache.js';

const BASE = 'https://ccms.pitc.com.pk';

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'X-Requested-With': 'XMLHttpRequest',
  Referer: `${BASE}/FeederDetails`,
};

export interface FeederDay {
  date: string; // yyyy-mm-dd (Pakistan local calendar date from upstream)
  actual: number[]; // 24 hourly outage minutes (history_data)
  planned: number[]; // 24 hourly planned-maintenance minutes (maintenance_data)
}
export interface FeederEvent {
  time: string; // "yyyy-mm-dd HH:mm:ss"
  event: 'ON' | 'OFF';
}
export interface FeederSchedule {
  reference: string;
  fetchedAt: string; // ISO
  reportedAt: string | null; // upstream cdate
  grid: string | null;
  feeder: string | null;
  feederCode: string | null;
  currentStatus: 'ON' | 'OFF' | 'UNKNOWN';
  currentStatusSince: string | null;
  voltageKv: number | null;
  loadKw: number | null;
  days: FeederDay[];
  recentEvents: FeederEvent[];
  remarks: string | null;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** "dt_20260708" → "2026-07-08"; null if it doesn't match. */
function parseDayKey(k: string): string | null {
  const m = /^dt_(\d{4})(\d{2})(\d{2})$/.exec(k);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Coerce an upstream hourly array to exactly 24 non-negative numbers. */
function to24(arr: unknown): number[] {
  const out = new Array<number>(24).fill(0);
  if (Array.isArray(arr)) {
    for (let i = 0; i < 24 && i < arr.length; i++) {
      const n = Number(arr[i]);
      out[i] = Number.isFinite(n) && n > 0 ? n : 0;
    }
  }
  return out;
}

async function fetchFeeder(reference: string): Promise<FeederSchedule> {
  // Best-effort: pick up session cookies from the portal page first.
  let cookie: string | undefined;
  try {
    const home = await http.get(`${BASE}/FeederDetails`, { headers: HEADERS });
    const sc = home.headers['set-cookie'];
    if (Array.isArray(sc) && sc.length > 0) {
      cookie = sc.map((c) => c.split(';')[0]).join('; ');
    }
  } catch {
    /* proceed without cookies — the endpoint often works anyway */
  }

  const resp = await http.get(`${BASE}/get-loadinfo/${encodeURIComponent(reference)}`, {
    headers: cookie ? { ...HEADERS, Cookie: cookie } : HEADERS,
  });
  if (resp.status !== 200) throw new Error(`get-loadinfo ${resp.status}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rec: any = resp.data?.load?.[0]?.response?.data?.[0];
  if (!rec) throw new Error('get-loadinfo returned no feeder record');

  // Merge the per-day actual (history) and planned (maintenance) hourly maps.
  const dayMap = new Map<string, FeederDay>();
  const ensure = (d: string): FeederDay => {
    let day = dayMap.get(d);
    if (!day) {
      day = { date: d, actual: new Array<number>(24).fill(0), planned: new Array<number>(24).fill(0) };
      dayMap.set(d, day);
    }
    return day;
  };
  for (const [k, v] of Object.entries(rec.history_data ?? {})) {
    const d = parseDayKey(k);
    if (d) ensure(d).actual = to24(v);
  }
  for (const [k, v] of Object.entries(rec.maintenance_data ?? {})) {
    const d = parseDayKey(k);
    if (d) ensure(d).planned = to24(v);
  }
  const days = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  const recentEvents: FeederEvent[] = Array.isArray(rec.event_logs)
    ? rec.event_logs
        .map((e: { event_time?: unknown; event?: unknown }) => ({
          time: String(e.event_time ?? ''),
          event: e.event === 'OFF' ? ('OFF' as const) : ('ON' as const),
        }))
        .filter((e: FeederEvent) => e.time !== '')
    : [];

  const status =
    rec.current_status === 'OFF' ? 'OFF' : rec.current_status === 'ON' ? 'ON' : 'UNKNOWN';

  const remarks =
    typeof rec.remarks === 'string' && rec.remarks.trim() ? rec.remarks.trim() : null;

  const out: FeederSchedule = {
    reference,
    fetchedAt: new Date().toISOString(),
    reportedAt: typeof rec.cdate === 'string' ? rec.cdate : null,
    grid: typeof rec.grid === 'string' ? rec.grid : null,
    feeder: typeof rec.feeder === 'string' ? rec.feeder : null,
    feederCode: rec.feeder_code != null ? String(rec.feeder_code) : null,
    currentStatus: status,
    currentStatusSince: typeof rec.current_status_time === 'string' ? rec.current_status_time : null,
    voltageKv: toNum(rec.voltage),
    loadKw: toNum(rec.active_power_kW),
    days,
    recentEvents,
    remarks,
  };
  keepStale(`ls:feeder:${reference}`, out);
  return out;
}

/** Feeder schedule for a consumer reference, cached ~10 min per reference so
 *  bursts of clients share one upstream round-trip. */
export function getFeederSchedule(reference: string): Promise<FeederSchedule> {
  return cached(`ls:feeder:${reference}`, 600, () => fetchFeeder(reference));
}
