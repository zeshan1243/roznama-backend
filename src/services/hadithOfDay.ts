/**
 * Hadith of the day — chosen once per day on the server (same for every user),
 * mirroring the ayah-of-day flow. Picks a hadith from the curated set stored in
 * `app_content('hadith')` and writes today's pick to `app_content('hadith_today')`,
 * which the app reads directly. Idempotent per day.
 */
import { supabaseAdmin } from '../lib/supabase.js';

export interface HadithOfDay {
  date: string; // yyyy-mm-dd
  ar: string;
  en: string;
  ur: string;
  ref: string;
}

export async function refreshHadithOfDay(): Promise<HadithOfDay | null> {
  const sb = supabaseAdmin();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const { data: current } = await sb
    .from('app_content')
    .select('data')
    .eq('key', 'hadith_today')
    .maybeSingle();
  if ((current?.data as HadithOfDay | undefined)?.date === today) {
    return current!.data as HadithOfDay;
  }

  const { data: set } = await sb
    .from('app_content')
    .select('data')
    .eq('key', 'hadith')
    .maybeSingle();
  const entries = (set?.data as { entries?: Array<Record<string, string>> } | null)
    ?.entries;
  if (!entries || entries.length === 0) return null;

  // Deterministic daily pick that rotates through the whole set.
  const dayOfYear = Math.floor(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
      Date.UTC(now.getFullYear(), 0, 0)) /
      86_400_000,
  );
  const e = entries[dayOfYear % entries.length];
  const hadith: HadithOfDay = {
    date: today,
    ar: e.ar,
    en: e.en,
    ur: e.ur,
    ref: e.ref,
  };

  const { error } = await sb
    .from('app_content')
    .upsert({ key: 'hadith_today', data: hadith }, { onConflict: 'key' });
  if (error) throw new Error(`hadith_today upsert: ${error.message}`);
  return hadith;
}
