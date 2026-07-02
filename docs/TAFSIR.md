# Tafsir (Quran commentary)

The app never hits the tafsir source directly — it calls our API, which proxies
and caches [spa5k's tafsir_api](https://github.com/spa5k/tafsir_api) (served over
the jsDelivr CDN). This keeps the DB untouched (nothing stored) and centralises
caching/filtering server-side.

## Source

- CDN base: `https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/tafsir`
- Editions list: `${CDN}/editions.json`
- Per-ayah text: `${CDN}/{edition-slug}/{surah}/{ayah}.json` → `{ text }` (HTML)

We filter editions to **Arabic / English / Urdu** (`ALLOWED_LANGS` in
`src/services/tafsir.ts`) to match the app's languages. Results are cached in
`node-cache` (6h TTL).

## API

| Route | Query | Returns |
| --- | --- | --- |
| `GET /api/tafsir/editions` | — | `[{ slug, name, author, language }]` |
| `GET /api/tafsir/ayah` | `edition`, `surah`, `ayah` | `{ text }` (HTML) |

Notable slugs: `ur-tafseer-ibn-e-kaseer`, `en-tafisr-ibn-kathir`,
`ur-tafsir-bayan-ul-quran`, `en-al-jalalayn`, `en-tafsir-maarif-ul-quran`,
`ar-tafsir-ibn-kathir`.

## App side

`lib/features/quran_reader/` — `TafsirRepository` (via the logging http client),
`tafsir_providers.dart` (editions / per-ayah / persisted selected edition), and
`tafsir_sheet.dart` (bottom sheet: edition picker + HTML render via
`flutter_html`, RTL-aware). A **Tafsir** button on each verse in the surah reader
opens the sheet. The chosen edition is remembered (`app.tafsir.edition`) and
defaults to Ibn Kathir in the current locale.
