# Money & Rates data

The app is a **thin client** for every money/rates feature: it only calls our
API (`/api/*`) via `BackendApi`. It does **not** scrape or hit any third-party
source directly. All scraping/fetching happens server-side.

## How it works

The **ingest scheduler** (`src/services/ingest.ts`) runs each producer on its
own cadence and writes the result to the `feed_snapshots` table. The public API
(`src/routes/public.ts`) reads from that table via `served(key, producer)`, so a
user request never triggers a live scrape — it returns the last stored snapshot.
On a cold start (no snapshot yet) `served` fetches once, persists, and returns.

```
scheduler → producer (scrape/API) → feed_snapshots (DB) → /api/<feed> → app
```

Force an immediate refresh of all feeds with the admin refresh route (used after
a deploy that changes a snapshot's shape).

## Which feature needs what, and how it's handled

| Feed | Route | Upstream | Type | Cadence |
| --- | --- | --- | --- | --- |
| Currency + gold/silver | `/currency` | er-api (FX) + forex.pk / hamariweb (**scrape**) + goldprice (spot) | scrape + API | 5 min |
| Crypto | `/crypto` | CoinGecko `coins/markets` (rich), Binance fallback | API | 2 min |
| Stocks | `/stocks` | Yahoo Finance chart | API | 6 h |
| Markets (PSX) | `/markets` | dps.psx.com.pk timeseries (**scrape**) | scrape | 5 min |
| Petrol | `/petrol` | PakWheels (**scrape**), bundled fallback | scrape | 60 min |
| NSS | `/nss` | savings.gov.pk (**scrape**), bundled fallback | scrape | 6 h |
| FX history | `/fx-history?range=` | Yahoo Finance chart (USD→PKR), DB series fallback | API | on request (cached) |

**Genuinely scraped (HTML parsing, fragile):** currency bullion, PSX, petrol,
NSS. These use `cheerio` server-side and each has a fallback (spot price or a
bundled JSON) so a layout change on the source never blanks the screen. Because
scraping is centralised, a broken selector is fixed once on the backend — no app
release, and third-party sites see one server IP instead of every device.

**API-based (stable JSON):** crypto, stocks, FX history. No scraping; keyless
public endpoints, so no API key to manage.

## App side

`lib/core/network/backend_api.dart` (`BackendApi.getJson`) is the single entry
point; every money repository under `lib/data/repositories/` calls it and maps
the JSON with the model's `fromJson`. All traffic flows through the logging
http client, so it appears in the debug API log. There is no client-side
scraping fallback — the backend is the sole source.
