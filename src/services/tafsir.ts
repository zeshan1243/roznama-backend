/**
 * Quran tafsir proxy. The app calls our API only; we fetch from spa5k's
 * tafsir_api (jsDelivr CDN) server-side and cache it. Filtered to Arabic /
 * English / Urdu editions (the app's languages).
 */
import axios from 'axios';
import NodeCache from 'node-cache';

const CDN = 'https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/tafsir';
const ALLOWED_LANGS = new Set(['arabic', 'english', 'urdu']);
const cache = new NodeCache({ stdTTL: 6 * 3600, checkperiod: 900, useClones: false });

export interface TafsirEdition {
  slug: string;
  name: string;
  author: string;
  language: string;
}

export async function getTafsirEditions(): Promise<TafsirEdition[]> {
  const hit = cache.get<TafsirEdition[]>('tafsir:editions');
  if (hit) return hit;
  const { data } = await axios.get(`${CDN}/editions.json`, { timeout: 20_000 });
  const list: TafsirEdition[] = (data as any[])
    .filter((e) => ALLOWED_LANGS.has(String(e.language_name).toLowerCase()))
    .map((e) => ({
      slug: e.slug,
      name: e.name,
      author: e.author_name ?? '',
      language: e.language_name,
    }));
  cache.set('tafsir:editions', list);
  return list;
}

export async function getTafsirAyah(
  edition: string,
  surah: number,
  ayah: number,
): Promise<{ text: string }> {
  const key = `tafsir:${edition}:${surah}:${ayah}`;
  const hit = cache.get<{ text: string }>(key);
  if (hit) return hit;
  const { data } = await axios.get(`${CDN}/${edition}/${surah}/${ayah}.json`, {
    timeout: 20_000,
  });
  const out = { text: (data?.text as string) ?? '' };
  cache.set(key, out);
  return out;
}
