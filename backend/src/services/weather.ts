import { http } from '../lib/http.js';
import { cityById } from '../data/cities.js';

export type WeatherCondition =
  | 'clear'
  | 'partlyCloudy'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'thunderstorm'
  | 'unknown';

export interface DailyForecast {
  date: string;
  maxC: number;
  minC: number;
  condition: WeatherCondition;
  weatherCode: number;
}

export interface HourlyForecast {
  time: string;
  tempC: number;
  condition: WeatherCondition;
  weatherCode: number;
  precipProbability: number;
}

export interface WeatherSnapshot {
  tempC: number;
  feelsLikeC: number;
  condition: WeatherCondition;
  weatherCode: number;
  windKmh: number;
  humidity: number;
  aqi: number | null;
  pm25: number | null;
  forecast: DailyForecast[];
  hourly: HourlyForecast[];
  fetchedAt: string;
}

const FORECAST_BASE = 'https://api.open-meteo.com/v1/forecast';
const AIR_BASE = 'https://air-quality-api.open-meteo.com/v1/air-quality';

export function weatherFromCode(code: number): WeatherCondition {
  if (code === 0) return 'clear';
  if (code <= 2) return 'partlyCloudy';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunderstorm';
  return 'unknown';
}

export async function fetchWeather(cityId: string | undefined): Promise<WeatherSnapshot> {
  const city = cityById(cityId);
  {
    const { latitude: lat, longitude: lng } = city;
    const fxUrl =
      `${FORECAST_BASE}?latitude=${lat}&longitude=${lng}` +
      `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m` +
      `&hourly=temperature_2m,weather_code,precipitation_probability` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=2&timezone=auto`;
    const dailyUrl =
      `${FORECAST_BASE}?latitude=${lat}&longitude=${lng}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=5&timezone=auto`;
    const airUrl = `${AIR_BASE}?latitude=${lat}&longitude=${lng}&current=us_aqi,pm2_5&timezone=auto`;

    const [fxResp, dailyResp, airResp] = await Promise.all([
      http.get(fxUrl),
      http.get(dailyUrl),
      http.get(airUrl),
    ]);
    if (fxResp.status !== 200) throw new Error(`Weather API ${fxResp.status}`);
    const fx = fxResp.data;
    const cur = fx.current;

    let aqi: number | null = null;
    let pm25: number | null = null;
    if (airResp.status === 200 && airResp.data?.current) {
      aqi = airResp.data.current.us_aqi != null ? Math.round(airResp.data.current.us_aqi) : null;
      pm25 = airResp.data.current.pm2_5 ?? null;
    }

    const dailySrc = dailyResp.status === 200 ? dailyResp.data : fx;
    const forecast = parseDaily(dailySrc);
    const hourly = parseHourly(fx);

    return {
      tempC: cur.temperature_2m,
      feelsLikeC: cur.apparent_temperature,
      condition: weatherFromCode(cur.weather_code),
      weatherCode: cur.weather_code,
      windKmh: cur.wind_speed_10m,
      humidity: Math.round(cur.relative_humidity_2m),
      aqi,
      pm25,
      forecast,
      hourly,
      fetchedAt: new Date().toISOString(),
    };
  }
}

function parseDaily(body: any): DailyForecast[] {
  const daily = body?.daily;
  if (!daily) return [];
  const dates: string[] = daily.time ?? [];
  const codes: number[] = daily.weather_code ?? [];
  const maxes: number[] = daily.temperature_2m_max ?? [];
  const mins: number[] = daily.temperature_2m_min ?? [];
  const out: DailyForecast[] = [];
  for (let i = 0; i < dates.length; i++) {
    if (i >= codes.length || i >= maxes.length || i >= mins.length) break;
    out.push({
      date: dates[i],
      maxC: maxes[i],
      minC: mins[i],
      condition: weatherFromCode(codes[i]),
      weatherCode: codes[i],
    });
  }
  return out;
}

function parseHourly(body: any): HourlyForecast[] {
  const hourly = body?.hourly;
  if (!hourly) return [];
  const times: string[] = hourly.time ?? [];
  const codes: number[] = hourly.weather_code ?? [];
  const temps: number[] = hourly.temperature_2m ?? [];
  const precips: number[] = hourly.precipitation_probability ?? [];
  const now = Date.now();
  const out: HourlyForecast[] = [];
  for (let i = 0; i < times.length; i++) {
    if (i >= codes.length || i >= temps.length) break;
    const t = new Date(times[i]).getTime();
    if (t < now - 30 * 60 * 1000) continue;
    if (out.length >= 24) break;
    out.push({
      time: times[i],
      tempC: temps[i],
      condition: weatherFromCode(codes[i]),
      weatherCode: codes[i],
      precipProbability: i < precips.length ? precips[i] ?? 0 : 0,
    });
  }
  return out;
}
