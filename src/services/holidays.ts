import { toHijri } from './hijri.js';

export interface Holiday {
  nameEn: string;
  nameUr: string;
  date: string; // ISO date (YYYY-MM-DD)
  type: 'gregorian' | 'hijri';
}

/** Fixed-date Gregorian public holidays in Pakistan. */
const FIXED: Array<{ nameEn: string; nameUr: string; month: number; day: number }> = [
  { nameEn: 'Kashmir Day', nameUr: 'یوم یکجہتی کشمیر', month: 2, day: 5 },
  { nameEn: 'Pakistan Day', nameUr: 'یوم پاکستان', month: 3, day: 23 },
  { nameEn: 'Labour Day', nameUr: 'یوم مزدور', month: 5, day: 1 },
  { nameEn: 'Independence Day', nameUr: 'یوم آزادی', month: 8, day: 14 },
  { nameEn: 'Iqbal Day', nameUr: 'یوم اقبال', month: 11, day: 9 },
  { nameEn: 'Quaid-e-Azam Day', nameUr: 'یوم قائد اعظم', month: 12, day: 25 },
];

/** Hijri-derived holidays (month/day in the Islamic calendar). */
const HIJRI: Array<{ nameEn: string; nameUr: string; month: number; day: number }> = [
  { nameEn: 'Ashura', nameUr: 'عاشورہ', month: 1, day: 10 },
  { nameEn: 'Eid Milad-un-Nabi', nameUr: 'عید میلاد النبی', month: 3, day: 12 },
  { nameEn: 'Eid al-Fitr', nameUr: 'عید الفطر', month: 10, day: 1 },
  { nameEn: 'Eid al-Adha', nameUr: 'عید الاضحیٰ', month: 12, day: 10 },
];

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Returns upcoming holidays within the next `days` window (default 400). */
export function upcomingHolidays(from = new Date(), days = 400, offsetDays = 0): Holiday[] {
  const out: Holiday[] = [];
  const end = new Date(from.getTime() + days * 86400_000);

  for (let y = from.getFullYear(); y <= end.getFullYear(); y++) {
    for (const h of FIXED) {
      out.push({ nameEn: h.nameEn, nameUr: h.nameUr, date: iso(y, h.month, h.day), type: 'gregorian' });
    }
  }

  // Scan each day in the window for Hijri holiday matches.
  for (let t = from.getTime(); t <= end.getTime(); t += 86400_000) {
    const d = new Date(t);
    const hj = toHijri(d, offsetDays);
    for (const h of HIJRI) {
      if (hj.month === h.month && hj.day === h.day) {
        out.push({
          nameEn: h.nameEn,
          nameUr: h.nameUr,
          date: iso(d.getFullYear(), d.getMonth() + 1, d.getDate()),
          type: 'hijri',
        });
      }
    }
  }

  const fromDay = iso(from.getFullYear(), from.getMonth() + 1, from.getDate());
  return out
    .filter((h) => h.date >= fromDay && h.date <= iso(end.getFullYear(), end.getMonth() + 1, end.getDate()))
    .sort((a, b) => a.date.localeCompare(b.date));
}
