/**
 * Electricity bill lookup, served by our backend so the app renders the bill in
 * its own native UI instead of embedding the PITC web page. The app never hits
 * bill.pitc.com.pk directly — we do the ASP.NET postback dance here, then parse
 * the resulting bill HTML into clean JSON.
 *
 * Flow (all within one cookie jar):
 *   1. GET  /{disco}                       → anti-forgery cookies + form tokens
 *   2. POST /{disco}  (ref + tokens)       → 302 to /{disco}/general?refno=…
 *   3. GET  /{disco}/general?refno=…       → the rendered bill page (HTML/CSS)
 *   4. cheerio-parse the A4 bill layout into structured fields.
 *
 * The portal reports a bad ref/DISCO inline in `<div id="ua">…</div>` (e.g.
 * "The given input does not belongs to IESCO"); we surface that as {found:false}.
 */
import * as cheerio from 'cheerio';
import type { CheerioAPI, Cheerio } from 'cheerio';
import type { AnyNode } from 'domhandler';
import { USER_AGENT } from '../lib/http.js';
import { cached } from '../lib/cache.js';

const BASE = 'https://bill.pitc.com.pk';

/** Which identifier the portal searches by: reference number or customer ID. */
export type SearchBy = 'refno' | 'appno';

// ---- Types (mirror the app's Bill model) ----------------------------------

export interface LabelValue {
  label: string;
  value: string;
}

export interface ChargeLine {
  label: string;
  value: string;
  pct: string | null;
}

export interface HistoryEntry {
  month: string;
  units: number | null;
  bill: number | null;
  payment: number | null;
}

export interface PayableAfter {
  period: string; // e.g. "Till 10-JUL-26"
  amount: number | null;
}

export interface Bill {
  found: boolean;
  error: string | null;
  fetchedAt: string;
  disco: string; // portal segment we queried, e.g. "iescobill"
  company: string | null; // "ISLAMABAD ELECTRIC SUPPLY COMPANY"
  referenceNo: string | null;
  consumerId: string | null;
  name: string | null;
  address: string | null;
  billMonth: string | null;
  readingDate: string | null;
  issueDate: string | null;
  dueDate: string | null;
  units: number | null;
  currentBill: number | null;
  arrears: number | null;
  payableWithinDueDate: number | null;
  payableAfterDueDate: PayableAfter[];
  detail: LabelValue[]; // full consumer-detail rows, in portal order
  meter: LabelValue[]; // meter-info rows
  charges: ChargeLine[]; // bill charges breakdown
  history: HistoryEntry[]; // month-wise history
}

// ---- Helpers ---------------------------------------------------------------

const FORM_HEADERS: Record<string, string> = {
  'User-Agent': USER_AGENT,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,ur;q=0.8',
  'Content-Type': 'application/x-www-form-urlencoded',
};

/** Merge the Set-Cookie names/values from a fetch Response into a cookie map. */
function collectCookies(resp: Response, jar: Map<string, string>): void {
  // Node 20+ exposes getSetCookie(); fall back to the folded header otherwise.
  const raw =
    typeof (resp.headers as { getSetCookie?: () => string[] }).getSetCookie === 'function'
      ? (resp.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : (resp.headers.get('set-cookie') ?? '').split(/,(?=[^;]+=)/);
  for (const c of raw) {
    const pair = c.split(';', 1)[0]?.trim();
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

/** Value of a hidden ASP.NET field from the landing form. */
function hidden($: CheerioAPI, id: string): string {
  return $(`#${id}`).attr('value') ?? '';
}

/** "3,077" / " 2505 " → 3077 / 2505; blank/"-" → null. */
function toNum(s: string | undefined | null): number | null {
  if (s == null) return null;
  const t = s.replace(/[,\s]/g, '');
  if (!t || t === '-') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function txt($el: Cheerio<AnyNode>): string {
  return $el.text().replace(/\s+/g, ' ').trim();
}

/** Read a `.val-space` cell, which may hold several `<br>`-separated registers
 *  (multi-register meters repeat the value). Returns the distinct lines joined
 *  by " / " so nothing is hidden but identical repeats collapse. */
function valLines($: CheerioAPI, $el: Cheerio<AnyNode>): string {
  const parts = ($el.html() ?? '')
    .split(/<br\s*\/?>/i)
    .map((p) => txt(cheerio.load(`<x>${p}</x>`)('x')))
    .filter(Boolean);
  // Drop a part that's already contained in another (e.g. a repeated meter no.
  // "3185379" inside "3-P 3185379"); keep genuinely distinct registers.
  const kept = [...new Set(parts)].filter(
    (p, _i, arr) => !arr.some((q) => q !== p && q.includes(p)),
  );
  return kept.join(' / ');
}

// ---- Parsing ---------------------------------------------------------------

function parseBill(html: string, disco: string): Bill {
  const $ = cheerio.load(html);

  const now = new Date().toISOString();
  const err = txt($('#ua')) || null;
  const main = $('#maincontent-1');

  // A found bill always renders #maincontent-1; a bad ref renders the search
  // form again with the error in #ua.
  if (main.length === 0) {
    return blank(disco, now, err ?? 'Bill not found');
  }

  // Consumer-detail and meter cards are `.card-header` + a run of `.label-row`s
  // (each row's value is the following `.val-space`). They appear in document
  // order — detail card, then meter card — so a single ordered walk that tracks
  // the current header cleanly splits them, no fragile DOM-ancestry lookups.
  const detail: LabelValue[] = [];
  const meter: LabelValue[] = [];
  // 'detail' after the CONSUMER DETAIL header, 'meter' after METER INFO, 'other'
  // after any later header (charges, history, footer banners) so trailing
  // `.label-row`s like "Deferred Amount" aren't mistaken for consumer detail.
  let section: 'none' | 'detail' | 'meter' | 'other' = 'none';
  main.find('.card-header, .label-row').each((_, el) => {
    const $el = $(el);
    if ($el.hasClass('card-header')) {
      const h = txt($el);
      section = /METER/i.test(h) ? 'meter' : /CONSUMER DETAIL/i.test(h) ? 'detail' : 'other';
      return;
    }
    if (section !== 'detail' && section !== 'meter') return;
    const label = txt($el.find('.en-lbl'));
    if (!label) return;
    const value = valLines($, $el.nextAll('.val-space').first());
    (section === 'meter' ? meter : detail).push({ label, value });
  });

  // Charges breakdown.
  const charges: ChargeLine[] = [];
  main.find('.charges-bd-row').each((_, el) => {
    const label = txt($(el).find('.charges-bd-en'));
    if (!label) return;
    charges.push({
      label,
      value: txt($(el).find('.charges-bd-val').first()),
      pct: txt($(el).find('.charges-bd-pct').first()) || null,
    });
  });
  const chargeVal = (re: RegExp): number | null => {
    const c = charges.find((x) => re.test(x.label));
    return c ? toNum(c.value) : null;
  };

  // Month-wise history: rows of [month, status, units, bill, payment].
  const history: HistoryEntry[] = [];
  main.find('.history-row').each((_, el) => {
    const cells = $(el).find('.history-cell').toArray().map((c) => txt($(c)));
    if (cells.length < 5 || !cells[0]) return;
    history.push({
      month: cells[0],
      units: toNum(cells[2]),
      bill: toNum(cells[3]),
      payment: toNum(cells[4]),
    });
  });

  // Right panel dates.
  const billMonth = txt(main.find('.right-main-val').not('.right-main-val--due').first()) || null;
  const dueDate = txt(main.find('.right-main-val--due').first()) || null;
  const dateFor = (re: RegExp): string | null => {
    let out: string | null = null;
    main.find('.right-grid-cell').each((_, el) => {
      if (out) return;
      if (re.test(txt($(el).find('.right-panel-en')))) {
        out = txt($(el).find('.right-panel-date-val')) || null;
      }
    });
    return out;
  };

  // Payable amounts.
  const payableWithinDueDate = toNum(txt(main.find('.payable-card-amount').first()));
  const payableAfterDueDate: PayableAfter[] = [];
  const periods = main.find('.lp-surcharge-period').toArray();
  const totals = main.find('.lp-surcharge-bottom-val').toArray();
  for (let i = 0; i < periods.length; i++) {
    const period = txt($(periods[i]));
    if (!period) continue;
    payableAfterDueDate.push({ period, amount: toNum(txt($(totals[i]))) });
  }

  const valueFor = (re: RegExp): string | null =>
    detail.find((r) => re.test(r.label))?.value ?? null;

  return {
    found: true,
    error: null,
    fetchedAt: now,
    disco,
    company: txt(main.find('.brand-green').filter((_, e) => /COMPANY/i.test(txt($(e)))).first()) || null,
    referenceNo: valueFor(/REFERENCE/i),
    consumerId: valueFor(/CONSUMER ID/i),
    name: splitNameAddress(valueFor(/NAME/i)).name,
    address: splitNameAddress(valueFor(/NAME/i)).address,
    billMonth,
    readingDate: dateFor(/READING/i),
    issueDate: dateFor(/ISSUE/i),
    dueDate,
    units: toNum(meter.find((r) => /^UNITS/i.test(r.label))?.value),
    currentBill: chargeVal(/CURRENT BILL/i),
    arrears: chargeVal(/ARREARS/i),
    payableWithinDueDate: payableWithinDueDate ?? chargeVal(/GRAND TOTAL/i),
    payableAfterDueDate,
    detail,
    meter,
    charges,
    history,
  };
}

/** The name+address cell folds both into one string; the name is the first
 *  comma-run before the street part. We keep it simple: nothing reliable
 *  separates them, so treat the whole thing as the address and leave name null
 *  unless there's an obvious "Name, address" split. */
function splitNameAddress(v: string | null): { name: string | null; address: string | null } {
  if (!v) return { name: null, address: null };
  return { name: null, address: v };
}

function blank(disco: string, fetchedAt: string, error: string | null): Bill {
  return {
    found: false,
    error,
    fetchedAt,
    disco,
    company: null,
    referenceNo: null,
    consumerId: null,
    name: null,
    address: null,
    billMonth: null,
    readingDate: null,
    issueDate: null,
    dueDate: null,
    units: null,
    currentBill: null,
    arrears: null,
    payableWithinDueDate: null,
    payableAfterDueDate: [],
    detail: [],
    meter: [],
    charges: [],
    history: [],
  };
}

// ---- Fetch pipeline --------------------------------------------------------

async function produceBill(disco: string, ref: string, by: SearchBy): Promise<Bill> {
  const jar = new Map<string, string>();
  const url = `${BASE}/${disco}`;

  // 1) GET landing → cookies + form tokens.
  const g = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'manual' });
  collectCookies(g, jar);
  const $ = cheerio.load(await g.text());
  const rvt = $('input[name="__RequestVerificationToken"]').attr('value') ?? '';

  const form = new URLSearchParams({
    __EVENTTARGET: '',
    __EVENTARGUMENT: '',
    __LASTFOCUS: '',
    __VIEWSTATE: hidden($, '__VIEWSTATE'),
    __VIEWSTATEGENERATOR: hidden($, '__VIEWSTATEGENERATOR'),
    __EVENTVALIDATION: hidden($, '__EVENTVALIDATION'),
    rbSearchByList: by, // 'refno' (reference no.) or 'appno' (customer ID)
    searchTextBox: ref,
    ruCodeTextBox: '',
    __RequestVerificationToken: rvt,
    btnSearch: 'Search',
  });

  // 2) POST search → 302 (found) or 200 with #ua error (bad ref/DISCO).
  const p = await fetch(url, {
    method: 'POST',
    headers: { ...FORM_HEADERS, Cookie: cookieHeader(jar) },
    body: form.toString(),
    redirect: 'manual',
  });
  collectCookies(p, jar);

  const location = p.headers.get('location');
  if (p.status !== 302 || !location) {
    // No redirect → the search form re-rendered with an inline error.
    return parseBill(await p.text(), disco);
  }

  // 3) Follow the redirect to the rendered bill (needs the session cookie).
  const billUrl = location.startsWith('http') ? location : `${BASE}${location}`;
  const b = await fetch(billUrl, {
    headers: { 'User-Agent': USER_AGENT, Cookie: cookieHeader(jar) },
    redirect: 'manual',
  });
  return parseBill(await b.text(), disco);
}

/**
 * Fetch + parse one electricity bill. [disco] is the PITC portal segment
 * (e.g. "iescobill"); [ref] is the numeric identifier — a 14-digit reference
 * number when [by] is 'refno', or the customer ID when [by] is 'appno' (both
 * are printed on every bill). Cached briefly so a quick re-check or a shared
 * connection doesn't re-run the postback dance.
 */
export function fetchBill(disco: string, ref: string, by: SearchBy = 'refno'): Promise<Bill> {
  return cached(`bill:${disco}:${by}:${ref}`, 300, () => produceBill(disco, ref, by));
}
