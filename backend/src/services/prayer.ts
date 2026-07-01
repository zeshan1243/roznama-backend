import { Coordinates, CalculationMethod, PrayerTimes, Madhab, Qibla } from 'adhan';
import { cityById } from '../data/cities.js';

export interface PrayerSchedule {
  fajr: string;
  sunrise: string;
  dhuhr: string;
  asr: string;
  maghrib: string;
  isha: string;
}

/** Karachi method, Hanafi madhab — matches the Flutter app's adhan_dart setup. */
export function prayerSchedule(cityId: string | undefined, dateIso?: string): PrayerSchedule {
  const city = cityById(cityId);
  const coords = new Coordinates(city.latitude, city.longitude);
  const params = CalculationMethod.Karachi();
  params.madhab = Madhab.Hanafi;
  const d = dateIso ? new Date(dateIso) : new Date();
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const t = new PrayerTimes(coords, date, params);
  return {
    fajr: t.fajr.toISOString(),
    sunrise: t.sunrise.toISOString(),
    dhuhr: t.dhuhr.toISOString(),
    asr: t.asr.toISOString(),
    maghrib: t.maghrib.toISOString(),
    isha: t.isha.toISOString(),
  };
}

/** Bearing in degrees from the given city toward the Kaaba. */
export function qiblaBearing(cityId: string | undefined): { bearing: number; city: string } {
  const city = cityById(cityId);
  const coords = new Coordinates(city.latitude, city.longitude);
  return { bearing: Qibla(coords), city: city.id };
}
