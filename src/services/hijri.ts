/**
 * Tabular Islamic (Umm al-Qura style, Kuwaiti algorithm) Gregorian↔Hijri
 * conversion — mirrors the `hijri` Dart package closely enough for display,
 * with a user-configurable ±day offset for moon-sighting variance.
 */

export interface HijriDate {
  year: number;
  month: number; // 1-12
  day: number;
  monthNameEn: string;
  monthNameUr: string;
}

const MONTHS_EN = [
  'Muharram', 'Safar', "Rabi' al-Awwal", "Rabi' al-Thani", 'Jumada al-Awwal',
  'Jumada al-Thani', 'Rajab', "Sha'ban", 'Ramadan', 'Shawwal',
  "Dhu al-Qi'dah", 'Dhu al-Hijjah',
];
const MONTHS_UR = [
  'محرم', 'صفر', 'ربیع الاول', 'ربیع الثانی', 'جمادی الاول', 'جمادی الثانی',
  'رجب', 'شعبان', 'رمضان', 'شوال', 'ذوالقعدہ', 'ذوالحجہ',
];

function gregorianToJdn(y: number, m: number, d: number): number {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return (
    d +
    Math.floor((153 * mm + 2) / 5) +
    365 * yy +
    Math.floor(yy / 4) -
    Math.floor(yy / 100) +
    Math.floor(yy / 400) -
    32045
  );
}

function jdnToHijri(jdn: number): { year: number; month: number; day: number } {
  const l0 = jdn - 1948440 + 10632;
  const n = Math.floor((l0 - 1) / 10631);
  let l = l0 - 10631 * n + 354;
  const j =
    Math.floor((10985 - l) / 5316) * Math.floor((50 * l) / 17719) +
    Math.floor(l / 5670) * Math.floor((43 * l) / 15238);
  l =
    l -
    Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) -
    Math.floor(j / 16) * Math.floor((15238 * j) / 43) +
    29;
  const month = Math.floor((24 * l) / 709);
  const day = l - Math.floor((709 * month) / 24);
  const year = 30 * n + j - 30;
  return { year, month, day };
}

export function toHijri(date = new Date(), offsetDays = 0): HijriDate {
  const shifted = new Date(date.getTime() + offsetDays * 86400_000);
  const jdn = gregorianToJdn(
    shifted.getFullYear(),
    shifted.getMonth() + 1,
    shifted.getDate(),
  );
  const { year, month, day } = jdnToHijri(jdn);
  return {
    year,
    month,
    day,
    monthNameEn: MONTHS_EN[month - 1] ?? '',
    monthNameUr: MONTHS_UR[month - 1] ?? '',
  };
}
