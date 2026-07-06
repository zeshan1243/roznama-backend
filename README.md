# Roznama Backend

Node/Express API for the **Roznama** app — a Pakistan-focused daily-life companion (news, prayer times, currency & gold, weather, Islamic reference content, and personal productivity tools). The backend aggregates live public data on a schedule, serves curated reference data, and stores per-user data in Supabase.

Written in TypeScript, runs on Node ≥ 20, backed by Supabase (Postgres + Auth).

---

## Table of Contents

- [What this backend does](#what-this-backend-does)
- [Architecture at a glance](#architecture-at-a-glance)
- [npm scripts — what each command does](#npm-scripts--what-each-command-does)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Project structure](#project-structure)
- [How data flows](#how-data-flows)
- [API reference](#api-reference)
- [Database & migrations](#database--migrations)
- [Deployment](#deployment)
- [Further docs](#further-docs)

---

## What this backend does

The Roznama app needs three kinds of data. This backend provides all three:

1. **Live data** that changes throughout the day — currency & bullion rates, crypto, stocks, market indices, petrol prices, national savings (NSS) rates, weather per city, news, and cricket. These are scraped/fetched from public sources on a schedule and cached in the database, so the app reads a fast, stable snapshot instead of hammering upstream sources.
2. **Reference data** that rarely changes — prayer-time calculation, Qibla bearing, Hijri dates, holidays, train schedules, emergency numbers, mobile packages, loadshedding schedules, and Islamic content (duas, hadith, Quran ayahs, tafsir).
3. **User data** behind authentication — profile/settings, bills, zakat records, tasbih counter, bookmarks, news preferences, loadshedding presets, FX alerts, and productivity resources (tasks, notes, events, planner blocks).

---

## Architecture at a glance

```
                 ┌───────────────────────────────────────────────┐
                 │                Roznama app (Angular)           │
                 └───────────────────────────────────────────────┘
                        │  GET /api/*            │  Bearer JWT
                        │  (public data)         │  /api/me/* (user data)
                        ▼                        ▼
┌───────────────────────────────────────────────────────────────────────┐
│                      Express API  (src/index.ts)                        │
│   helmet · compression · cors · morgan · JSON body parsing              │
│                                                                         │
│   /api/*        publicRouter      → served() reads DB snapshots         │
│   /api/me/*     userRouter        → requireAuth → Supabase (per user)   │
│   /api/me/*     productivityRouter → requireAuth → Supabase (per user)  │
│   /api/admin/refresh              → manual re-scrape (ADMIN_KEY)        │
└───────────────────────────────────────────────────────────────────────┘
        ▲                               │                    │
        │ read snapshots                │ write snapshots    │ user rows
        │                               ▼                    ▼
        │                    ┌────────────────────────────────────────┐
        │                    │            Supabase (Postgres)          │
        │                    │  feed_snapshots · ref_* · app_content   │
        │                    │  profiles · bills · tasks · … (RLS)     │
        │                    └────────────────────────────────────────┘
        │
┌───────┴───────────────────────────────────────────────────────────────┐
│              Ingestion scheduler  (src/services/ingest.ts)             │
│   Each feed runs on its own interval, scrapes/fetches from upstream,   │
│   and writes the latest snapshot to feed_snapshots.                    │
│   Upstream: forex.pk, hamariweb, goldprice, open.er-api, RSS feeds,    │
│   AlQuran.cloud, Fawaz Ahmed Hadith API, spa5k tafsir_api, …           │
└───────────────────────────────────────────────────────────────────────┘
```

The key design idea: **user requests never trigger a live scrape.** The scheduler refreshes feeds in the background and stores each result. API reads come straight from the DB snapshot. If a scrape fails or returns junk, the previous good snapshot is kept, so the app keeps showing the last successfully-scraped data.

---

## npm scripts — what each command does

These are the commands defined in [package.json](package.json). Here is exactly what each one does and when you'd run it.

### `npm install`
Not a project script — it's the standard npm command. It reads `package.json`, downloads every dependency (Express, Supabase client, cheerio, axios, zod, etc.) and devDependency (TypeScript, tsx, type packages) into `node_modules/`. **Run this first**, once, after cloning the repo (and again whenever dependencies change).

### `npm run dev`
```
tsx watch src/index.ts
```
Starts the API server in **development mode** with hot reload. [`tsx`](https://github.com/privatenumber/tsx) runs the TypeScript entrypoint directly (no separate build step), and `watch` restarts the process automatically whenever you edit a source file. This is the command you use day-to-day while developing. It:
- boots the Express server on `PORT` (default `8080`),
- starts the ingestion scheduler (`startScheduler()`), which immediately does one `refreshAll()` and then refreshes each feed on its interval — **unless Supabase isn't configured**, in which case the scheduler is disabled and data is fetched live per request.

Visit `http://localhost:8080/api/health` to confirm it's up.

### `npm run build`
```
tsc -p tsconfig.json
```
Compiles all TypeScript in `src/` to plain JavaScript in `dist/`, using the settings in [tsconfig.json](tsconfig.json). Run this before deploying / before `npm start`. Produces the artifacts that `npm start` runs.

### `npm start`
```
node dist/index.js
```
Runs the **compiled production build** with plain Node (no tsx, no watch). Requires `npm run build` to have been run first so that `dist/` exists. This is what you run in production.

### `npm run typecheck`
```
tsc -p tsconfig.json --noEmit
```
Type-checks the whole project **without emitting any files**. Fast way to catch type errors in CI or before committing. Doesn't produce `dist/`.

### `npm run seed`
```
tsx src/scripts/seed.ts
```
Populates the **reference tables** (`ref_trains`, `ref_duas`, `ref_hadith`, `ref_quran`, `ref_emergency`, `ref_packages`, `ref_loadshedding`, `ref_nss`) in Supabase from the bundled JSON in `data/` (and a live NSS fetch). Each table is cleared and re-inserted, so the script is idempotent — safe to re-run. See [src/scripts/seed.ts](src/scripts/seed.ts).

**Prerequisites:** `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in `.env`, and the schema from `supabase/migrations/` already applied. Run this once after setting up the database (and again when the bundled reference data changes).

### `npm run seed:content`
```
tsx src/scripts/seedContent.ts
```
Seeds the public `app_content` table with the reference-content blobs the mobile app also bundles (hadith, duas, 99 names / asma-ul-husna). The app reads these backend-first and falls back to its bundled copy when offline. **Prerequisites:** Supabase env vars + migration `0013_app_content` applied. See [src/scripts/seedContent.ts](src/scripts/seedContent.ts).

### `npm run seed:hadith`
```
tsx src/scripts/seedHadith.ts
```
One-time import of the full hadith corpus (Arabic/English/Urdu editions across the major collections) from [Fawaz Ahmed's Hadith API](https://github.com/fawazahmed0/hadith-api) into the DB, so the app can read hadith from Supabase directly. Idempotent (upserts by primary key). **Prerequisites:** Supabase env vars + migration `0015_hadith` applied. See [src/scripts/seedHadith.ts](src/scripts/seedHadith.ts).

---

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# then edit .env and fill in your Supabase project URL + keys

# 3. Apply database migrations
#    Run every file in supabase/migrations/ in order (0001, 0002, …) against
#    your Supabase project — via the Supabase SQL editor or the Supabase CLI.

# 4. Seed reference + content data (one time)
npm run seed
npm run seed:content
npm run seed:hadith      # optional: full hadith corpus

# 5. Start developing
npm run dev
```

> **You can run the API without Supabase.** Live-data and calculation routes (currency, weather, prayer, hijri, etc.) work without any DB — they fetch live per request. Only the `/api/me/*` user routes and the background scheduler require Supabase to be configured.

---

## Environment variables

Defined and validated in [src/config.ts](src/config.ts); template in [.env.example](.env.example).

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | no | `8080` | Port the HTTP server listens on. |
| `NODE_ENV` | no | `development` | `development` uses concise `morgan` logs; `production` uses combined logs. |
| `CORS_ORIGINS` | no | `http://localhost:4200` | Comma-separated list of allowed browser origins. Empty → allow all. |
| `SUPABASE_URL` | for user routes | — | Your Supabase project URL. |
| `SUPABASE_ANON_KEY` | for user routes | — | Public anon key; used to verify user JWTs (`auth.getUser`). |
| `SUPABASE_SERVICE_ROLE_KEY` | for user routes | — | **Secret**, server-only. Full DB access (bypasses RLS). Used by the scheduler and all authed writes. |
| `ALPHA_VANTAGE_KEY` | no | `''` | Optional key for the global-stocks feature (free tier: 25 req/day). |
| `ADMIN_KEY` | no | `''` | If set, authorizes `POST /api/admin/refresh` via the `x-admin-key` header. If unset, that endpoint is disabled. |

The three Supabase values together drive `supabaseConfigured`. When it's `false`, the scheduler is disabled and user routes return 500 — but public data routes still work.

---

## Project structure

```
roznama-backend/
├── data/                      Bundled reference JSON (trains, duas, hadith, packages, …)
├── docs/                      Feature-specific docs (HADITH.md, TAFSIR.md, MONEY.md)
├── supabase/migrations/       Ordered SQL migrations (schema, RLS, feeds, content, …)
├── src/
│   ├── index.ts               Express app: middleware, routes, boot, scheduler start
│   ├── config.ts              Env loading + validation, supabaseConfigured flag
│   ├── data/cities.ts         The 12 supported cities (lat/long, EN/UR names)
│   ├── lib/
│   │   ├── supabase.ts         Supabase admin (service-role) + anon clients
│   │   ├── store.ts            saveSnapshot / readSnapshot / served() — the DB cache layer
│   │   ├── http.ts             Shared axios instance + browser headers for scraping
│   │   ├── cache.ts            In-memory cache helper
│   │   └── bundled.ts          Loads bundled JSON from data/
│   ├── middleware/
│   │   ├── auth.ts             requireAuth — verifies Supabase bearer JWT
│   │   └── error.ts            asyncHandler + central error handler
│   ├── routes/
│   │   ├── public.ts           /api/* — all public data & reference endpoints
│   │   ├── user.ts             /api/me/* — profile, bills, zakat, tasbih, bookmarks, prefs, alerts
│   │   └── productivity.ts     /api/me/* — tasks, notes, events, planner (generic owner-scoped CRUD)
│   ├── services/               One module per data source (see below)
│   │   ├── ingest.ts           The scheduler: which feed refreshes how often + accept guards
│   │   ├── currency.ts         Currency + gold/silver bullion scraping
│   │   ├── crypto.ts, stocks.ts, markets.ts, petrol.ts, nss.ts, fxHistory.ts
│   │   ├── weather.ts          Per-city weather
│   │   ├── news.ts             RSS aggregation (Dawn, Tribune, Geo, …) + cricket
│   │   ├── prayer.ts, hijri.ts, holidays.ts    Calculations (adhan library, etc.)
│   │   ├── reference.ts        Bundled reference accessors (trains, duas, hadith, …)
│   │   ├── ayah.ts, hadithOfDay.ts             "of the day" content refreshers
│   │   ├── hadithBooks.ts, tafsir.ts           Proxied + cached upstream APIs
│   │   └── ...
│   └── scripts/
│       ├── seed.ts             npm run seed
│       ├── seedContent.ts      npm run seed:content
│       └── seedHadith.ts       npm run seed:hadith
├── .env.example
├── package.json
└── tsconfig.json
```

---

## How data flows

**Live/aggregated feeds (currency, crypto, stocks, markets, petrol, nss, news, cricket, weather):**

1. `startScheduler()` (called on boot) registers each feed from the `FEEDS` list in [src/services/ingest.ts](src/services/ingest.ts) with its own interval (e.g. currency every 5 min, stocks every 6 h, weather every 15 min per city).
2. On each tick, the feed's `producer()` scrapes/fetches upstream. An optional `accept()` guard decides whether the result is good enough to store — an empty scrape or a fallback-to-bundled result is **rejected**, so the last good snapshot is preserved (`nonEmpty`, `liveOnly`).
3. Good results are written to `feed_snapshots` via `saveSnapshot(key, data)`.
4. When the app calls e.g. `GET /api/currency`, the route calls `served('currency', fetchCurrency)`, which reads the stored snapshot from `feed_snapshots`. On a cold start (nothing stored yet), it fetches live once, persists it, and returns it — so the API is never blank.

**Reference & calculation routes (cities, prayer, qibla, hijri, holidays, trains, duas, quran, …):** served directly — either computed on the fly (prayer/hijri/holidays) or read from bundled data / seeded tables.

**Proxied+cached routes (hadith collections, tafsir):** fetched from upstream APIs and cached to keep the DB small. See [docs/HADITH.md](docs/HADITH.md) and [docs/TAFSIR.md](docs/TAFSIR.md).

**User routes (`/api/me/*`):** every request passes through `requireAuth`, which verifies the `Authorization: Bearer <supabase-access-token>` header via `supabaseAnon().auth.getUser(token)` and attaches `userId`. All queries are then scoped by `user_id` using the service-role client.

---

## API reference

Base URL: `http://localhost:8080`

### System
| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | `{ ok, supabase, time }` |
| POST | `/api/admin/refresh` | Triggers `refreshAll()`. Requires `x-admin-key` header matching `ADMIN_KEY`. |

### Public data — `/api/*` (no auth)
| Method | Path | Query | Notes |
|---|---|---|---|
| GET | `/api/cities` | | Supported cities |
| GET | `/api/currency` | | FX rates + gold/silver bullion (DB snapshot) |
| GET | `/api/crypto` | | Crypto prices |
| GET | `/api/stocks` | | Global stocks |
| GET | `/api/markets` | | Market indices |
| GET | `/api/petrol` | | Petrol prices |
| GET | `/api/nss` | | National Savings rates |
| GET | `/api/fx-history` | `range` (`d30`…) | USD/PKR daily series |
| GET | `/api/weather` | `city` | Per-city weather snapshot |
| GET | `/api/news` | `category` | Aggregated RSS news, filtered by category |
| GET | `/api/cricket` | | Cricket news |
| GET | `/api/prayer` | `city`, `date` | Prayer schedule |
| GET | `/api/qibla` | `city` | Qibla bearing |
| GET | `/api/hijri` | `date`, `offset` | Hijri date conversion |
| GET | `/api/holidays` | `offset` | Upcoming holidays |
| GET | `/api/duas` | | Duas |
| GET | `/api/hadith` · `/api/hadith/today` | | Bundled hadith + hadith of the day |
| GET | `/api/hadith/collections` · `/sections` · `/section` | `edition`, `num` | Proxied hadith browser |
| GET | `/api/quran` · `/api/quran/today` | | Ayahs + ayah of the day |
| GET | `/api/tafsir/editions` · `/api/tafsir/ayah` | `edition`, `surah`, `ayah` | Proxied tafsir |
| GET | `/api/trains` · `/emergency` · `/packages` · `/loadshedding` | | Daily-life reference |

### User data — `/api/me/*` (Bearer JWT required)
| Resource | Endpoints |
|---|---|
| Profile | `GET /profile`, `PUT /profile` |
| Bills | `GET/POST /bills`, `PUT/DELETE /bills/:id` |
| Zakat | `GET/POST /zakat`, `DELETE /zakat/:id` |
| Tasbih | `GET /tasbih`, `PUT /tasbih` |
| Bookmarks | `GET/POST /bookmarks`, `DELETE /bookmarks?link=` |
| News prefs | `GET/PUT /news-prefs` |
| Loadshedding presets | `GET/POST /ls-presets`, `DELETE /ls-presets/:id` |
| FX alerts | `GET/POST /fx-alerts`, `DELETE /fx-alerts/:id` |
| Tasks | `GET/POST /tasks`, `PUT/DELETE /tasks/:id` |
| Notes | `GET/POST /notes`, `PUT/DELETE /notes/:id` |
| Events | `GET/POST /events`, `PUT/DELETE /events/:id` |
| Planner | `GET/POST /planner`, `PUT/DELETE /planner/:id` |

All `/api/me/*` rows are owned by the authenticated user; every query is scoped by `user_id`.

---

## Database & migrations

Schema lives in [supabase/migrations/](supabase/migrations/) as ordered SQL files (`0001_init.sql` … `0017_drop_hadith.sql`). Apply them in filename order against your Supabase project (SQL editor or Supabase CLI). Highlights:

- `0001_init` / `0002_rls` — base tables + Row-Level Security.
- `0003_feeds` — `feed_snapshots` (the live-data cache).
- `0004_productivity` — tasks/notes/events/planner.
- `0005`–`0011` — profile trigger, profile fields, avatars, gender, account deletion, user documents, typed tools.
- `0012_prayer_calc`, `0013_app_content`, `0015_hadith`, `0016_hadith_numeric`, `0017_drop_hadith` — feature schema.

Table groups:
- **`feed_snapshots`** — one row per feed key, holding the latest scraped payload + timestamp.
- **`ref_*`** — seeded reference tables (`npm run seed`).
- **`app_content`** — content blobs read backend-first by the app (`npm run seed:content`), plus daily `ayah_today` / `hadith_today`.
- **User tables** — `profiles`, `bills`, `zakat_records`, `tasbih_state`, `bookmarks`, `news_prefs`, `loadshedding_presets`, `fx_alerts`, `tasks`, `notes`, `events`, `planner_blocks` — all RLS-protected and scoped by `user_id`.

---

## Deployment

```bash
npm ci               # clean install from package-lock
npm run build        # compile to dist/
npm start            # node dist/index.js
```

Set all environment variables in your host (do **not** commit `.env`). Ensure `CORS_ORIGINS` includes your production frontend domain, and set `NODE_ENV=production`. The `ADMIN_KEY`, if set, lets you trigger an out-of-band re-scrape via `POST /api/admin/refresh`.

---

## Further docs

- [docs/MONEY.md](docs/MONEY.md) — money/currency/bullion data sources & shapes.
- [docs/HADITH.md](docs/HADITH.md) — hadith proxy/import strategy.
- [docs/TAFSIR.md](docs/TAFSIR.md) — tafsir proxy.
