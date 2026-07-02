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
import { prayerSchedule, qiblaBearing } from '../services/prayer.js';
import { toHijri } from '../services/hijri.js';
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
} from '../services/reference.js';
import { getCollections, getSections, getSection } from '../services/hadithBooks.js';

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
publicRouter.get(
  '/cricket',
  asyncHandler(async (_req, res) => res.json(await served<NewsArticle[]>('cricket', fetchCricketAll))),
);

// ---- Prayer / qibla / hijri / holidays ----
publicRouter.get('/prayer', (req, res) =>
  res.json(prayerSchedule(req.query.city as string, req.query.date as string)),
);
publicRouter.get('/qibla', (req, res) => res.json(qiblaBearing(req.query.city as string)));
publicRouter.get('/hijri', (req, res) => {
  const offset = Number(req.query.offset ?? 0) || 0;
  const date = req.query.date ? new Date(req.query.date as string) : new Date();
  res.json(toHijri(date, offset));
});
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

// ---- Daily-life reference ----
publicRouter.get('/trains', (_req, res) => res.json(getTrains()));
publicRouter.get('/emergency', (_req, res) => res.json(getEmergency()));
publicRouter.get('/packages', (_req, res) => res.json(getPackages()));
publicRouter.get('/loadshedding', (_req, res) => res.json(getLoadshedding()));
