/**
 * Hadith collections proxy (Approach A — see docs/HADITH.md). The app calls our
 * API only; we fetch from Fawaz Ahmed's Hadith API server-side and cache it in
 * memory. Nothing is stored in the DB (keeps the free Supabase tier small).
 * Structure: Book → Edition (language) → Sections (chapters) → Hadiths.
 */
import axios from 'axios';
import NodeCache from 'node-cache';

const CDN = 'https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1';
const ALLOWED_LANGS = new Set(['Arabic', 'English', 'Urdu']);

// Editions are immutable → cache generously. useClones:false avoids copying the
// large full-book objects on every read.
const cache = new NodeCache({ stdTTL: 6 * 3600, checkperiod: 900, useClones: false });

export interface CollectionDto {
  key: string;
  name: string;
  editions: { name: string; language: string }[];
}

export async function getCollections(): Promise<CollectionDto[]> {
  const hit = cache.get<CollectionDto[]>('collections');
  if (hit) return hit;
  const { data } = await axios.get(`${CDN}/editions.json`, { timeout: 20_000 });
  const order = [
    'bukhari', 'muslim', 'abudawud', 'tirmidhi', 'nasai', 'ibnmajah',
    'malik', 'nawawi', 'qudsi', 'dehlawi',
  ];
  const list: CollectionDto[] = Object.entries<any>(data).map(([key, v]) => ({
    key,
    name: v.name,
    editions: (v.collection ?? [])
      .filter((e: any) => ALLOWED_LANGS.has(e.language))
      .map((e: any) => ({ name: e.name, language: e.language })),
  }));
  list.sort((a, b) => {
    const ia = order.indexOf(a.key), ib = order.indexOf(b.key);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  cache.set('collections', list);
  return list;
}

async function getFull(edition: string): Promise<any> {
  const key = `full:${edition}`;
  const hit = cache.get<any>(key);
  if (hit) return hit;
  const { data } = await axios.get(`${CDN}/editions/${edition}.min.json`, {
    timeout: 60_000,
  });
  cache.set(key, data);
  return data;
}

export interface SectionDto {
  num: number;
  name: string;
  first: number | null;
  last: number | null;
}

export async function getSections(edition: string): Promise<SectionDto[]> {
  const full = await getFull(edition);
  const names: Record<string, string> = full.metadata?.sections ?? {};
  // Group hadiths by reference.book (= section number) for name + range.
  const groups = new Map<number, { first: number; last: number }>();
  for (const h of full.hadiths ?? []) {
    const b = h.reference?.book;
    if (b == null) continue;
    const g = groups.get(b);
    if (!g) groups.set(b, { first: h.hadithnumber, last: h.hadithnumber });
    else {
      g.first = Math.min(g.first, h.hadithnumber);
      g.last = Math.max(g.last, h.hadithnumber);
    }
  }
  const out: SectionDto[] = [];
  for (const [b, g] of groups) {
    const name = names[String(b)] ?? '';
    if (!name) continue; // skip the unnamed catch-all (book 0)
    out.push({ num: b, name, first: g.first, last: g.last });
  }
  out.sort((a, b) => a.num - b.num);
  return out;
}

export interface SectionHadiths {
  name: string;
  hadiths: {
    hadithnumber: number;
    arabicnumber: number;
    text: string;
    reference: { book: number; hadith: number };
    grades: { name: string; grade: string }[];
  }[];
}

export async function getSection(edition: string, num: number): Promise<SectionHadiths> {
  const full = await getFull(edition);
  const name = full.metadata?.sections?.[String(num)] ?? '';
  const hadiths = (full.hadiths ?? [])
    .filter((h: any) => h.reference?.book === num)
    .map((h: any) => ({
      hadithnumber: h.hadithnumber,
      arabicnumber: h.arabicnumber,
      text: h.text,
      reference: h.reference,
      grades: h.grades ?? [],
    }));
  return { name, hadiths };
}
