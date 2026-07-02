/**
 * One-time import of the full hadith corpus (all editions/languages) from Fawaz
 * Ahmed's Hadith API into our DB, so the app reads it from Supabase directly.
 * Idempotent (upserts by primary key). Requires migration 0015 applied.
 *
 *   npm run seed:hadith
 */
import axios from 'axios';
import { supabaseAdmin } from '../lib/supabase.js';

const CDN = 'https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1';
const ORDER = [
  'bukhari', 'muslim', 'abudawud', 'tirmidhi', 'nasai', 'ibnmajah',
  'malik', 'nawawi', 'qudsi', 'dehlawi',
];
// Only these languages are imported/kept.
const ALLOWED_LANGS = new Set(['Arabic', 'English', 'Urdu']);

function bestGrade(grades: any): string | null {
  if (!Array.isArray(grades) || grades.length === 0) return null;
  const g = grades.find((x) => (x.name as string)?.includes('Albani')) ?? grades[0];
  return (g.grade as string)?.trim() ?? null;
}

async function chunkUpsert(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  size = 1000,
): Promise<void> {
  const sb = supabaseAdmin();
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + size), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function main(): Promise<void> {
  const sb = supabaseAdmin();
  console.log('Importing hadith corpus…');
  const eds = (await axios.get(`${CDN}/editions.json`, { timeout: 30_000 })).data;

  const books = ORDER.filter((k) => eds[k]).map((k, i) => ({
    key: k, name: eds[k].name, sort_order: i,
  }));
  await chunkUpsert('hadith_books', books, 'key');

  // Drop any previously-imported editions in languages we no longer keep.
  const { data: existing } = await sb.from('hadith_editions').select('edition,language');
  for (const e of (existing ?? []) as any[]) {
    if (ALLOWED_LANGS.has(e.language)) continue;
    await sb.from('hadiths').delete().eq('edition', e.edition);
    await sb.from('hadith_sections').delete().eq('edition', e.edition);
    await sb.from('hadith_editions').delete().eq('edition', e.edition);
    console.log(`  removed ${e.edition} (${e.language})`);
  }

  for (const k of ORDER) {
    if (!eds[k]) continue;
    for (const ed of eds[k].collection as any[]) {
      if (!ALLOWED_LANGS.has(ed.language)) continue;
      const edition: string = ed.name;
      const full = (await axios.get(`${CDN}/editions/${edition}.min.json`, {
        timeout: 120_000,
      })).data;
      const names: Record<string, string> = full.metadata?.sections ?? {};
      const hadiths: any[] = full.hadiths ?? [];

      // Sections via reference.book grouping (robust across editions).
      const groups = new Map<number, { first: number; last: number }>();
      for (const h of hadiths) {
        const b = h.reference?.book;
        if (b == null) continue;
        const g = groups.get(b);
        if (!g) groups.set(b, { first: h.hadithnumber, last: h.hadithnumber });
        else {
          g.first = Math.min(g.first, h.hadithnumber);
          g.last = Math.max(g.last, h.hadithnumber);
        }
      }
      const sections = [...groups.entries()]
        .filter(([b]) => names[String(b)])
        .map(([b, g]) => ({ edition, num: b, name: names[String(b)], first: g.first, last: g.last }));

      await sb.from('hadith_editions').upsert(
        { edition, collection: k, language: ed.language }, { onConflict: 'edition' });
      await chunkUpsert('hadith_sections', sections, 'edition,num');
      await chunkUpsert(
        'hadiths',
        hadiths.map((h) => ({
          edition,
          hadith_number: h.hadithnumber,
          arabic_number: h.arabicnumber,
          section: h.reference?.book,
          text: h.text,
          book: h.reference?.book,
          hadith: h.reference?.hadith,
          grade: bestGrade(h.grades),
        })),
        'edition,hadith_number',
      );
      console.log(`  ${edition}: ${hadiths.length} hadiths, ${sections.length} sections`);
    }
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
