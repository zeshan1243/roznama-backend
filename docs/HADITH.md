# Hadith collections — implementation reference

The app's **Hadith Collections** browser (Book → Language → Sections → Hadiths)
is powered by **Fawaz Ahmed's Hadith API** (`fawazahmed0/hadith-api`, served over
the jsDelivr CDN). This doc records both integration approaches so either can be
re-applied quickly.

> Separate from **Hadith of the day** (`app_content.hadith_today`, chosen daily
> by `services/hadithOfDay.ts`) — that's a single shared verse, unrelated to the
> full browser.

## Upstream API (jsDelivr, free, keyless)

Base: `https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1`

- `editions.json` — all collections. Shape: `{ <book>: { name, collection: [{ name, language, ... }] } }`.
  10 books: `bukhari, muslim, abudawud, tirmidhi, nasai, ibnmajah, malik, nawawi, qudsi, dehlawi`.
  Edition ids are `{lang}-{book}`, e.g. `eng-bukhari`, `urd-bukhari`, `ara-bukhari`
  (big books also have a 2nd Arabic edition `ara-{book}1`).
- `editions/{edition}.min.json` — the whole book: `{ metadata: { name, sections: {num: title}, section_details }, hadiths: [{ hadithnumber, arabicnumber, text, grades: [{name, grade}], reference: {book, hadith} }] }`.
- `editions/{edition}/sections/{n}.json` — one section's hadiths (no chapter title).

### Data-model notes (important)
- **Sections/chapters:** the per-section file has no title, and the min file's
  range key is `section_details` (plural). The robust way to get chapters +
  ranges is to **group hadiths by `reference.book`** (that value IS the section
  number); `metadata.sections[num]` gives the title. Range = min/max
  `hadithnumber` in the group. `book 0` is an unnamed catch-all → skip.
- **`reference.book` = section number; `reference.hadith` = in-book number.**
- **Fractional hadith numbers exist** (sub-narrations, e.g. `402.2`) →
  `hadithnumber` / `arabicnumber` / `reference.hadith` must be treated as
  decimals (`numeric` in SQL, `num` in Dart), NOT integers.
- **Grades:** Bukhari & Muslim are Sahih in full (no per-hadith grade). The
  Sunan carry grades (e.g. Tirmidhi → Al-Albani `Sahih/Hasan/Da'if`). Surface
  the grade where present; prefer the Al-Albani grading.
- **Languages kept:** Arabic, English, Urdu only (the app's languages).
  (Nawawi/Qudsi/Dehlawi have no Urdu upstream.)

---

## Approach A — URL proxy (CURRENT; minimal DB usage)

The backend fetches from the CDN on demand and caches in memory (`node-cache`);
the app calls **our** backend only. **Nothing stored in the DB** → best for the
free Supabase tier.

- Backend: `src/services/hadithBooks.ts` (`getCollections`, `getSections`,
  `getSection`; sections derived from `reference.book`; filtered to Arabic/
  English/Urdu). Routes in `src/routes/public.ts`:
  - `GET /api/hadith/collections`
  - `GET /api/hadith/sections?edition=urd-bukhari`
  - `GET /api/hadith/section?edition=urd-bukhari&num=1`
- App: `lib/features/hadith_books/` — repository calls the backend via
  `lib/core/config/backend_config.dart` (`BACKEND_URL`, default
  `http://10.0.2.2:8080`).
- Trade-off: **requires the Node backend running/deployed and reachable**;
  first fetch of a big edition is slow (then cached in BE memory).

## Approach B — import into our DB (no runtime CDN/BE dependency)

Import the corpus once into Supabase; the app reads it **directly** (public
read). Best when you can afford the storage (Supabase Pro).

- Migrations: `0015_hadith.sql` (tables `hadith_books`, `hadith_editions`,
  `hadith_sections`, `hadiths` + public-read RLS + index) and
  `0016_hadith_numeric.sql` (number columns → `numeric` for fractional
  sub-narrations).
- Import: `npm run seed:hadith` (`src/scripts/seedHadith.ts`) — idempotent;
  `ALLOWED_LANGS` limits to Arabic/English/Urdu and prunes others.
- App: repository queries Supabase directly (`hadith_books` / `hadith_editions`
  / `hadith_sections` / `hadiths`); no `BackendConfig`.
- Size (Arabic+English+Urdu): ~146k rows, ~50 MB. All 9 languages ≈ ~120 MB.
- Trade-off: **DB storage** (heavy on the free tier); no runtime CDN/BE need.

### To reclaim space when switching B → A
`0017_drop_hadith.sql` drops the four hadith tables. (`seedHadith.ts` +
`0015`/`0016` stay in the repo as the reusable Approach-B artifacts.)

## Switching between them
- **A → B:** apply `0015` + `0016`, run `npm run seed:hadith`, repoint the app
  repository to Supabase queries (drop `BackendConfig`).
- **B → A:** restore `hadithBooks.ts` + the `/api/hadith/*` routes and the app's
  `BackendConfig`/HTTP repository, then apply `0017` to drop the tables.
