export interface City {
  id: string;
  nameEn: string;
  nameUr: string;
  latitude: number;
  longitude: number;
}

/** Mirrors lib/data/models/city.dart. Lahore is the default. */
export const CITIES: City[] = [
  { id: 'lhr', nameEn: 'Lahore', nameUr: 'لاہور', latitude: 31.5497, longitude: 74.3436 },
  { id: 'khi', nameEn: 'Karachi', nameUr: 'کراچی', latitude: 24.8607, longitude: 67.0011 },
  { id: 'isb', nameEn: 'Islamabad', nameUr: 'اسلام آباد', latitude: 33.6844, longitude: 73.0479 },
  { id: 'rwp', nameEn: 'Rawalpindi', nameUr: 'راولپنڈی', latitude: 33.5651, longitude: 73.0169 },
  { id: 'fsd', nameEn: 'Faisalabad', nameUr: 'فیصل آباد', latitude: 31.4504, longitude: 73.135 },
  { id: 'mux', nameEn: 'Multan', nameUr: 'ملتان', latitude: 30.1575, longitude: 71.5249 },
  { id: 'pew', nameEn: 'Peshawar', nameUr: 'پشاور', latitude: 34.0151, longitude: 71.5249 },
  { id: 'uet', nameEn: 'Quetta', nameUr: 'کوئٹہ', latitude: 30.1798, longitude: 66.975 },
  { id: 'hdd', nameEn: 'Hyderabad', nameUr: 'حیدرآباد', latitude: 25.396, longitude: 68.3578 },
  { id: 'skt', nameEn: 'Sialkot', nameUr: 'سیالکوٹ', latitude: 32.4945, longitude: 74.5229 },
  { id: 'gjr', nameEn: 'Gujranwala', nameUr: 'گوجرانوالہ', latitude: 32.1877, longitude: 74.1945 },
  { id: 'bwp', nameEn: 'Bahawalpur', nameUr: 'بہاولپور', latitude: 29.3956, longitude: 71.6836 },
];

export const DEFAULT_CITY = CITIES[0];

export function cityById(id: string | undefined): City {
  return CITIES.find((c) => c.id === id) ?? DEFAULT_CITY;
}
