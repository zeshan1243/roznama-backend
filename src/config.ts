import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') {
    // Non-fatal at import time: live-data routes work without Supabase; only
    // user-data + auth routes need it. We surface a clear error at first use.
    console.warn(`[config] ${name} is not set`);
    return '';
  }
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:4200')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  supabase: {
    url: required('SUPABASE_URL'),
    anonKey: required('SUPABASE_ANON_KEY'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  },
  alphaVantageKey: process.env.ALPHA_VANTAGE_KEY ?? '',
};

export const supabaseConfigured = Boolean(
  config.supabase.url && config.supabase.serviceRoleKey && config.supabase.anonKey,
);
