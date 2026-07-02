/**
 * Ayah of the day — chosen once per day on the server so every client shows the
 * same verse. On an Islamic occasion a themed verse is used; otherwise a random
 * verse from AlQuran.cloud. The result is stored in the public `app_content`
 * table (key `ayah_today`), which the app reads directly. Idempotent per day:
 * re-running the same day returns the stored verse without hitting the API.
 */
import axios from 'axios';
import { supabaseAdmin } from '../lib/supabase.js';
import { toHijri, HijriDate } from './hijri.js';

const EDITIONS = 'quran-uthmani,en.sahih,ur.jalandhry';
const BASE = 'https://api.alquran.cloud/v1';

const OCCASION_REFS: Record<string, string[]> = {
  ramadan: ['2:183', '2:185', '2:186'],
  laylatalqadr: ['97:1', '97:2', '97:3', '97:4', '97:5'],
  ashura: ['2:153', '2:155', '2:156', '3:200'],
  muharram: ['9:40'],
  hajj: ['2:197', '3:97', '22:27'],
  arafah: ['5:3'],
  eid: ['108:1', '108:2', '14:7'],
  friday: ['62:9', '62:10', '62:11'],
};

function occasionFor(h: HijriDate, greg: Date): string | null {
  switch (h.month) {
    case 9: // Ramadan
      return h.day === 27 ? 'laylatalqadr' : 'ramadan';
    case 1: // Muharram
      if (h.day === 9 || h.day === 10) return 'ashura';
      if (h.day === 1) return 'muharram';
      break;
    case 12: // Dhu al-Hijjah
      if (h.day === 9) return 'arafah';
      if (h.day >= 10 && h.day <= 13) return 'eid';
      if (h.day <= 8) return 'hajj';
      break;
    case 10: // Shawwal
      if (h.day <= 3) return 'eid';
      break;
  }
  if (greg.getDay() === 5) return 'friday'; // Friday
  return null;
}

export interface AyahOfDay {
  date: string; // yyyy-mm-dd
  ar: string;
  en: string;
  ur: string;
  ref: string;
  tags: string[];
}

/** Ensure `app_content.ayah_today` holds today's verse; fetch+store if not. */
export async function refreshAyahOfDay(): Promise<AyahOfDay | null> {
  const sb = supabaseAdmin();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const { data: existing } = await sb
    .from('app_content')
    .select('data')
    .eq('key', 'ayah_today')
    .maybeSingle();
  if ((existing?.data as AyahOfDay | undefined)?.date === today) {
    return existing!.data as AyahOfDay;
  }

  const occasion = occasionFor(toHijri(now), now);
  let url: string;
  if (occasion) {
    const refs = OCCASION_REFS[occasion];
    const dayOfYear = Math.floor(
      (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
        Date.UTC(now.getFullYear(), 0, 0)) /
        86_400_000,
    );
    url = `${BASE}/ayah/${refs[dayOfYear % refs.length]}/editions/${EDITIONS}`;
  } else {
    url = `${BASE}/ayah/random/editions/${EDITIONS}`;
  }

  const resp = await axios.get(url, { timeout: 20_000 });
  const list = resp.data.data as Array<Record<string, any>>;
  const by = Object.fromEntries(list.map((e) => [e.edition.identifier, e]));
  const ar = by['quran-uthmani'];
  const ayah: AyahOfDay = {
    date: today,
    ar: ar.text,
    en: by['en.sahih'].text,
    ur: by['ur.jalandhry'].text,
    ref: `${ar.surah.number}:${ar.numberInSurah}`,
    tags: occasion ? [occasion] : [],
  };

  const { error } = await sb
    .from('app_content')
    .upsert({ key: 'ayah_today', data: ayah }, { onConflict: 'key' });
  if (error) throw new Error(`ayah_today upsert: ${error.message}`);
  return ayah;
}
