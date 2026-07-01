import { bundled } from '../lib/bundled.js';

/* ----------------------------- Trains ----------------------------- */
export interface TrainStop {
  station: string;
  departs?: string;
  arrives?: string;
}
export interface Train {
  name: string;
  number: string;
  travelClass: string;
  days: string;
  stops: TrainStop[];
  route: string;
}

export function getTrains(): { updatedAt: string; source: string; trains: Train[] } {
  const j = bundled<any>('trains.json');
  const trains: Train[] = j.trains.map((t: any) => ({
    name: t.name,
    number: t.number,
    travelClass: t.class ?? '',
    days: t.days ?? '',
    stops: t.stops ?? [],
    route:
      t.stops?.length >= 2
        ? `${t.stops[0].station} → ${t.stops[t.stops.length - 1].station}`
        : '',
  }));
  return { updatedAt: j.updated_at, source: j.source, trains };
}

/* ------------------------------ Duas ------------------------------ */
export interface Dua {
  arabic: string;
  english: string;
  urdu: string;
}
export interface DuaCategory {
  key: string;
  titleEn: string;
  titleUr: string;
  entries: Dua[];
}
export function getDuas(): DuaCategory[] {
  const j = bundled<any>('duas.json');
  return j.categories.map((c: any) => ({
    key: c.key,
    titleEn: c.title_en,
    titleUr: c.title_ur,
    entries: c.entries.map((e: any) => ({ arabic: e.ar, english: e.en, urdu: e.ur })),
  }));
}

/* -------------------------- Hadith / Ayah -------------------------- */
export interface Hadith {
  arabic: string;
  english: string;
  urdu: string;
  reference: string;
}

function dayOfYear(d = new Date()): number {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / 86400_000);
}

export function getHadiths(): Hadith[] {
  const j = bundled<any>('hadith.json');
  return j.entries.map((e: any) => ({ arabic: e.ar, english: e.en, urdu: e.ur, reference: e.ref }));
}
export function hadithOfDay(): Hadith {
  const list = getHadiths();
  return list[dayOfYear() % list.length];
}
export function getAyahs(): Hadith[] {
  const j = bundled<any>('quran_ayahs.json');
  return j.entries.map((e: any) => ({ arabic: e.ar, english: e.en, urdu: e.ur, reference: e.ref }));
}
export function ayahOfDay(): Hadith {
  const list = getAyahs();
  return list[dayOfYear() % list.length];
}

/* --------------------------- Emergency ---------------------------- */
export interface EmergencyNumber {
  nameEn: string;
  nameUr: string;
  number: string;
  icon: string;
}
export interface EmergencyGroup {
  key: string;
  labelEn: string;
  labelUr: string;
  items: EmergencyNumber[];
}
export function getEmergency(): EmergencyGroup[] {
  const j = bundled<any>('emergency_numbers.json');
  return j.groups.map((g: any) => ({
    key: g.key,
    labelEn: g.label_en,
    labelUr: g.label_ur,
    items: g.items.map((i: any) => ({
      nameEn: i.name_en,
      nameUr: i.name_ur,
      number: i.number,
      icon: i.icon ?? 'phone',
    })),
  }));
}

/* ----------------------- Mobile packages -------------------------- */
export interface MobilePackage {
  label: string;
  validity: string;
  callsMinutes: number;
  sms: number;
  dataMb: number;
  price: number;
}
export interface MobileOperator {
  name: string;
  colorHex: string;
  packages: MobilePackage[];
}
export function getPackages(): { updatedAt: string; source: string; operators: MobileOperator[] } {
  const j = bundled<any>('mobile_packages.json');
  return {
    updatedAt: j.updated_at,
    source: j.source,
    operators: j.operators.map((o: any) => ({
      name: o.name,
      colorHex: o.color ?? '#888888',
      packages: o.packages.map((p: any) => ({
        label: p.label,
        validity: p.validity,
        callsMinutes: p.calls_min,
        sms: p.sms,
        dataMb: p.data_mb,
        price: p.price,
      })),
    })),
  };
}

/* -------------------------- Loadshedding -------------------------- */
export interface Disco {
  code: string;
  nameEn: string;
  nameUr: string;
}
export interface AreaSchedule {
  name: string;
  slots: string[];
}
export interface DiscoSchedule {
  disco: string;
  areas: AreaSchedule[];
}
export function getLoadshedding(): {
  generatedAt: string;
  source: string;
  discos: Disco[];
  schedules: DiscoSchedule[];
} {
  const j = bundled<any>('loadshedding.json');
  return {
    generatedAt: j.generated_at,
    source: j.source,
    discos: j.discos.map((d: any) => ({ code: d.code, nameEn: d.name_en, nameUr: d.name_ur })),
    schedules: j.schedules,
  };
}
