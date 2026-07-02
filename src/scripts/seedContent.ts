/**
 * Seeds the public `app_content` table with the reference-content blobs the
 * mobile app also bundles (hadith, duas, 99 names, Quran ayahs). The app reads
 * these backend-first and falls back to its bundled copy when offline.
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env and migration
 * 0013_app_content applied.
 *
 *   npm run seed:content
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { supabaseAdmin } from '../lib/supabase.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../data/content');

// key → bundled JSON file (the app expects these exact shapes).
// Note: 'quran' is intentionally not seeded here — ayah of the day comes from
// AlQuran.cloud (app_content.ayah_today), so app_content('quran') is unused.
const items: Array<[string, string]> = [
  ['hadith', 'hadith.json'],
  ['duas', 'duas.json'],
  ['asma', 'asma_ul_husna.json'],
];

async function main(): Promise<void> {
  const sb = supabaseAdmin();
  console.log('Seeding app_content…');
  for (const [key, file] of items) {
    const data = JSON.parse(readFileSync(join(root, file), 'utf8'));
    const { error } = await sb.from('app_content').upsert({ key, data });
    if (error) throw new Error(`${key}: ${error.message}`);
    console.log(`  seeded ${key}`);
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
