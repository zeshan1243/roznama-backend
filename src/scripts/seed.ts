/**
 * Seeds Supabase reference tables from the bundled JSON in web/backend/data/.
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env, and the schema
 * from supabase/migrations to already be applied.
 *
 *   npm run seed
 */
import { supabaseAdmin } from '../lib/supabase.js';
import {
  getTrains,
  getDuas,
  getHadiths,
  getAyahs,
  getEmergency,
  getPackages,
  getLoadshedding,
} from '../services/reference.js';
import { fetchNss } from '../services/nss.js';

async function reseed(table: string, rows: Record<string, unknown>[]): Promise<void> {
  const sb = supabaseAdmin();
  const { error: delErr } = await sb.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (delErr) throw new Error(`clear ${table}: ${delErr.message}`);
  const { error } = await sb.from(table).insert(rows);
  if (error) throw new Error(`insert ${table}: ${error.message}`);
  console.log(`  seeded ${rows.length} rows into ${table}`);
}

async function main() {
  console.log('Seeding reference tables…');

  const trains = getTrains().trains;
  await reseed(
    'ref_trains',
    trains.map((t) => ({ name: t.name, number: t.number, class: t.travelClass, days: t.days, stops: t.stops })),
  );

  await reseed(
    'ref_duas',
    getDuas().map((c) => ({ category: c.key, title_en: c.titleEn, title_ur: c.titleUr, entries: c.entries })),
  );

  await reseed(
    'ref_hadith',
    getHadiths().map((h, i) => ({ ar: h.arabic, en: h.english, ur: h.urdu, ref: h.reference, ord: i })),
  );

  await reseed(
    'ref_quran',
    getAyahs().map((a, i) => ({ ar: a.arabic, en: a.english, ur: a.urdu, ref: a.reference, ord: i })),
  );

  await reseed(
    'ref_emergency',
    getEmergency().map((g) => ({ group_key: g.key, label_en: g.labelEn, label_ur: g.labelUr, items: g.items })),
  );

  await reseed(
    'ref_packages',
    getPackages().operators.map((o) => ({ operator: o.name, color: o.colorHex, packages: o.packages })),
  );

  const ls = getLoadshedding();
  await reseed(
    'ref_loadshedding',
    ls.discos.map((d) => ({
      disco: d.code,
      name_en: d.nameEn,
      name_ur: d.nameUr,
      areas: ls.schedules.find((s) => s.disco === d.code)?.areas ?? [],
    })),
  );

  const nss = await fetchNss();
  await reseed(
    'ref_nss',
    nss.products.map((p: (typeof nss.products)[number]) => ({
      code: p.code,
      name_en: p.nameEn,
      name_ur: p.nameUr,
      tenor: p.tenor,
      profit_pct: p.profitPct,
      payout: p.payout,
      min_invest: p.minInvest,
      notes_en: p.notesEn,
    })),
  );

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
