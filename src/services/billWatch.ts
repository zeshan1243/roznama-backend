/**
 * Bill-alert watcher. Periodically re-fetches every saved electricity
 * connection from the PITC portal and, when a *new* monthly bill has appeared
 * (the bill month advanced past the one we last notified for), pushes an alert
 * to that user's devices — exactly once per new bill.
 *
 * Hooked into the app scheduler (see index.ts). Bills issue monthly, so a few
 * checks a day is plenty; the per-connection PITC fetch is the same one the
 * /api/bill route uses (and is briefly cached).
 */
import { supabaseAdmin } from '../lib/supabase.js';
import { supabaseConfigured } from '../config.js';
import { fetchBill, type SearchBy } from './bill.js';
import { sendPush, pushConfigured } from './push.js';

interface ConnectionRow {
  id: string;
  user_id: string;
  disco: string;
  reference: string;
  search_by: SearchBy;
  nickname: string | null;
  last_notified_month: string | null;
}

/** Format an integer amount as "Rs 2,959" (falls back to empty string). */
function rs(amount: number | null): string {
  return amount == null ? '' : `Rs ${amount.toLocaleString('en-PK')}`;
}

async function notifyNewBill(
  db: ReturnType<typeof supabaseAdmin>,
  conn: ConnectionRow,
  company: string | null,
  billMonth: string,
  amount: number | null,
  dueDate: string | null,
): Promise<void> {
  const { data: toks } = await db
    .from('push_tokens')
    .select('token')
    .eq('user_id', conn.user_id);
  const tokens = (toks ?? []).map((t) => t.token as string);
  if (tokens.length === 0) return;

  const name = conn.nickname || company || conn.disco.replace(/bill$/, '').toUpperCase();
  const amountStr = rs(amount);
  const body =
    `${billMonth} bill is ready` +
    (amountStr ? ` — ${amountStr}` : '') +
    (dueDate ? `, due ${dueDate}` : '') +
    '.';

  const invalid = await sendPush(tokens, {
    title: `New ${name} bill`,
    body,
    data: {
      type: 'bill',
      disco: conn.disco,
      reference: conn.reference,
      by: conn.search_by,
    },
  });
  if (invalid.length) {
    await db.from('push_tokens').delete().in('token', invalid);
  }
}

async function runOnce(): Promise<void> {
  if (!supabaseConfigured) return;
  const db = supabaseAdmin();
  const { data: conns, error } = await db
    .from('electricity_connections')
    .select('id, user_id, disco, reference, search_by, nickname, last_notified_month')
    .eq('notify', true);
  if (error) {
    console.warn('[billWatch] list failed:', error.message);
    return;
  }
  const rows = (conns ?? []) as ConnectionRow[];
  if (rows.length === 0) return;
  console.log(`[billWatch] checking ${rows.length} connection(s)…`);

  for (const conn of rows) {
    try {
      const bill = await fetchBill(conn.disco, conn.reference, conn.search_by);
      if (!bill.found || !bill.billMonth) continue;

      const patch: Record<string, unknown> = {
        last_bill_month: bill.billMonth,
        last_amount: bill.payableWithinDueDate,
        last_due_date: bill.dueDate,
        updated_at: new Date().toISOString(),
      };

      // New bill this consumer hasn't been alerted about yet.
      if (bill.billMonth !== conn.last_notified_month) {
        if (pushConfigured()) {
          await notifyNewBill(
            db,
            conn,
            bill.company,
            bill.billMonth,
            bill.payableWithinDueDate,
            bill.dueDate,
          );
        }
        patch.last_notified_month = bill.billMonth;
      }

      await db.from('electricity_connections').update(patch).eq('id', conn.id);
    } catch (err) {
      console.warn('[billWatch] connection', conn.id, 'failed:', err instanceof Error ? err.message : err);
    }
    // Small stagger so we don't hammer the PITC portal.
    await new Promise((r) => setTimeout(r, 800));
  }
}

/** Start the periodic watcher (no-op if Supabase isn't configured). */
export function startBillWatch(): void {
  if (!supabaseConfigured) {
    console.warn('[billWatch] Supabase not configured — bill alerts disabled.');
    return;
  }
  const everyMs = 6 * 60 * 60 * 1000; // every 6 hours
  setInterval(() => void runOnce(), everyMs);
  // First run shortly after boot so startup stays fast.
  setTimeout(() => void runOnce(), 60_000);
  console.log(`[billWatch] started (every 6h)${pushConfigured() ? '' : ' — push dormant (no FCM creds)'}`);
}
