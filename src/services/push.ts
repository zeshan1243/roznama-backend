/**
 * Firebase Cloud Messaging sender. Dormant until an FCM service account is
 * provided via the `FCM_SERVICE_ACCOUNT` env var (the full service-account JSON
 * as a single-line string). When unset, [pushConfigured] is false and callers
 * skip sending — so the rest of the bill-alert pipeline still runs (and records
 * state) without push, and lights up the moment credentials are added.
 */
import { initializeApp, cert, getApps, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

export interface PushMessage {
  title: string;
  body: string;
  /** Small string payload delivered to the app (e.g. deep-link params). */
  data?: Record<string, string>;
}

let app: App | null = null;

/** True when an FCM service account is configured. */
export function pushConfigured(): boolean {
  return Boolean(process.env.FCM_SERVICE_ACCOUNT);
}

function serviceAccount(): Record<string, unknown> | null {
  const raw = process.env.FCM_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    console.error('[push] FCM_SERVICE_ACCOUNT is not valid JSON:', err instanceof Error ? err.message : err);
    return null;
  }
}

function messaging() {
  if (!app) {
    const sa = serviceAccount();
    if (!sa) throw new Error('FCM not configured');
    app = getApps()[0] ?? initializeApp({ credential: cert(sa as never) });
  }
  return getMessaging(app);
}

/**
 * Send [msg] to every token in [tokens]. Returns the tokens FCM reported as
 * permanently invalid (unregistered / malformed) so the caller can prune them.
 * Never throws for per-token failures; only a total misconfiguration throws.
 */
export async function sendPush(tokens: string[], msg: PushMessage): Promise<string[]> {
  if (tokens.length === 0 || !pushConfigured()) return [];
  const resp = await messaging().sendEachForMulticast({
    tokens,
    notification: { title: msg.title, body: msg.body },
    data: msg.data,
    android: { priority: 'high' },
    apns: { payload: { aps: { sound: 'default' } } },
  });
  const invalid: string[] = [];
  resp.responses.forEach((r, i) => {
    if (r.success) return;
    const code = r.error?.code ?? '';
    if (
      code.includes('registration-token-not-registered') ||
      code.includes('invalid-registration-token') ||
      code.includes('invalid-argument')
    ) {
      invalid.push(tokens[i]);
    }
  });
  return invalid;
}
