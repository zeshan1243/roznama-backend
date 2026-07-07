import { Router } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { served } from '../lib/store.js';
import { CITIES, cityById } from '../data/cities.js';
import { fetchCurrency } from '../services/currency.js';
import { fetchCrypto } from '../services/crypto.js';
import { fetchStocks } from '../services/stocks.js';
import { fetchMarkets } from '../services/markets.js';
import { fetchWeather, WeatherSnapshot } from '../services/weather.js';
import { fetchPetrol } from '../services/petrol.js';
import { getFxHistory, FxHistoryRange } from '../services/fxHistory.js';
import { fetchNss } from '../services/nss.js';
import { fetchNewsAll, fetchCricketAll, filterNews, NewsArticle, NewsCategory } from '../services/news.js';
import { upcomingHolidays } from '../services/holidays.js';
import {
  getTrains,
  getDuas,
  getHadiths,
  hadithOfDay,
  getAyahs,
  ayahOfDay,
  getEmergency,
  getPackages,
  getLoadshedding,
  getTariffs,
  getTaxSlabs,
} from '../services/reference.js';
import { getCollections, getSections, getSection } from '../services/hadithBooks.js';
import { getArticleContent } from '../services/newsArticle.js';
import { getTafsirEditions, getTafsirAyah } from '../services/tafsir.js';
import { getTrainsLive, getTrainRoute, getTrainRuns } from '../services/trains.js';

export const publicRouter = Router();

// ---- Reference / config ----
publicRouter.get('/cities', (_req, res) => res.json(CITIES));

// ---- Money data (served from DB snapshots; live fallback on cold start) ----
publicRouter.get('/currency', asyncHandler(async (_req, res) => res.json(await served('currency', fetchCurrency))));
publicRouter.get('/crypto', asyncHandler(async (_req, res) => res.json(await served('crypto', fetchCrypto))));
publicRouter.get('/stocks', asyncHandler(async (_req, res) => res.json(await served('stocks', fetchStocks))));
publicRouter.get('/markets', asyncHandler(async (_req, res) => res.json(await served('markets', fetchMarkets))));
publicRouter.get('/petrol', asyncHandler(async (_req, res) => res.json(await served('petrol', fetchPetrol))));
publicRouter.get('/nss', asyncHandler(async (_req, res) => res.json(await served('nss', fetchNss))));
publicRouter.get(
  '/fx-history',
  asyncHandler(async (req, res) => {
    const range = (req.query.range as FxHistoryRange) || 'd30';
    res.json(await getFxHistory(range));
  }),
);

// ---- Weather ----
publicRouter.get(
  '/weather',
  asyncHandler(async (req, res) => {
    const id = cityById(req.query.city as string).id;
    res.json(await served<WeatherSnapshot>(`weather:${id}`, () => fetchWeather(id)));
  }),
);

// ---- News / cricket ----
publicRouter.get(
  '/news',
  asyncHandler(async (req, res) => {
    const category = (req.query.category as NewsCategory) || 'all';
    const articles = await served<NewsArticle[]>('news', fetchNewsAll);
    res.json(filterNews(articles, category));
  }),
);
// Full-article extraction (reader view) — fetched + parsed server-side.
publicRouter.get(
  '/news/article',
  asyncHandler(async (req, res) => {
    const url = String(req.query.url ?? '');
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ contentHtml: null });
    res.json(await getArticleContent(url));
  }),
);
publicRouter.get(
  '/cricket',
  asyncHandler(async (_req, res) => res.json(await served<NewsArticle[]>('cricket', fetchCricketAll))),
);

// ---- Holidays ----
// Prayer times, qibla bearing, and Hijri date conversion are pure deterministic
// algorithms (adhan_dart / great-circle math / hijri calendar) computed on the
// device, so there is no server endpoint for them — the backend would only add
// a network dependency for identical numbers. Holidays live here because the
// public-holiday list is government-announced data that can change without an
// app release.
publicRouter.get('/holidays', (req, res) => {
  const offset = Number(req.query.offset ?? 0) || 0;
  res.json(upcomingHolidays(new Date(), 400, offset));
});

// ---- Islam reference ----
publicRouter.get('/duas', (_req, res) => res.json(getDuas()));
publicRouter.get('/hadith', (_req, res) => res.json(getHadiths()));
publicRouter.get('/hadith/today', (_req, res) => res.json(hadithOfDay()));

// Hadith collections browser — proxied + cached from Fawaz Ahmed's Hadith API
// (Approach A; keeps the DB small). See docs/HADITH.md.
publicRouter.get(
  '/hadith/collections',
  asyncHandler(async (_req, res) => res.json(await getCollections())),
);
publicRouter.get(
  '/hadith/sections',
  asyncHandler(async (req, res) =>
      res.json(await getSections(String(req.query.edition ?? '')))),
);
publicRouter.get(
  '/hadith/section',
  asyncHandler(async (req, res) => res.json(
      await getSection(String(req.query.edition ?? ''), Number(req.query.num ?? 1)))),
);
publicRouter.get('/quran', (_req, res) => res.json(getAyahs()));
publicRouter.get('/quran/today', (_req, res) => res.json(ayahOfDay()));

// Tafsir (Quran commentary) — proxied + cached from spa5k's tafsir_api.
publicRouter.get(
  '/tafsir/editions',
  asyncHandler(async (_req, res) => res.json(await getTafsirEditions())),
);
publicRouter.get(
  '/tafsir/ayah',
  asyncHandler(async (req, res) => res.json(await getTafsirAyah(
      String(req.query.edition ?? ''),
      Number(req.query.surah ?? 1),
      Number(req.query.ayah ?? 1)))),
);

// ---- Live train tracking (roster + GPS, proxied from traintracking.pk) ----
// The app never hits traintracking.pk directly — we do the token dance,
// station-name resolution, and route parsing server-side.
publicRouter.get('/trains/live', asyncHandler(async (_req, res) => res.json(await getTrainsLive())));
publicRouter.get(
  '/trains/route',
  asyncHandler(async (req, res) => {
    const trainId = Number(req.query.trainId ?? 0);
    if (!Number.isFinite(trainId) || trainId <= 0) return res.status(400).json([]);
    res.json(await getTrainRoute(trainId));
  }),
);
publicRouter.get(
  '/trains/runs',
  asyncHandler(async (req, res) => {
    const trainNumber = Number(req.query.trainNumber ?? 0);
    if (!Number.isFinite(trainNumber) || trainNumber <= 0) return res.status(400).json([]);
    res.json(await getTrainRuns(trainNumber));
  }),
);

// ---- Daily-life reference ----
// Legacy bundled schedule (kept for the seed script / older clients).
publicRouter.get('/trains', (_req, res) => res.json(getTrains()));
publicRouter.get('/emergency', (_req, res) => res.json(getEmergency()));
publicRouter.get('/packages', (_req, res) => res.json(getPackages()));
publicRouter.get('/loadshedding', (_req, res) => res.json(getLoadshedding()));

// ---- Calculator reference tables (annually-revised rates) ----
publicRouter.get('/tariffs', (_req, res) => res.json(getTariffs()));
publicRouter.get('/tax/slabs', (_req, res) => res.json(getTaxSlabs()));
