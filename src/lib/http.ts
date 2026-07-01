import axios from 'axios';

/** Mobile browser UA — several upstream sources gate on a real-looking UA. */
export const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

export const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': USER_AGENT,
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,ur;q=0.8',
};

/** Shared axios instance with a sane default timeout and UA. */
export const http = axios.create({
  timeout: 12_000,
  headers: { 'User-Agent': USER_AGENT },
  // Upstreams sometimes return non-2xx we still want to inspect.
  validateStatus: (s) => s >= 200 && s < 500,
});
