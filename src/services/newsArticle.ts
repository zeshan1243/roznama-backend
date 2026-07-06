/**
 * Server-side full-article extractor. The RSS feeds only carry an excerpt, so
 * when the reader opens an article we fetch its page and extract the main
 * content here (rather than on the device). Heuristic scoring — not Mozilla
 * Readability, but enough for Pakistani news sites. Cached per URL.
 */
import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import NodeCache from 'node-cache';
import { http, BROWSER_HEADERS } from '../lib/http.js';

const cache = new NodeCache({ stdTTL: 6 * 3600, checkperiod: 900, useClones: false });

const STRIP_TAGS = [
  'script', 'style', 'iframe', 'form', 'button',
  'header', 'footer', 'nav', 'aside', 'noscript',
  'svg', 'video', 'audio',
];

// Classes/IDs that almost always indicate non-article chrome.
const NOISE = new RegExp(
  '(ad|ads|advert|promo|share|social|related|recommend|comment|sidebar|' +
    'newsletter|subscribe|cookie|consent|breadcrumb|tags?|byline-tags|' +
    'meta-tags?|popup|modal|footer|nav|menu)',
  'i',
);

const MIN_BODY_CHARS = 350;

function score($: CheerioAPI, el: Element): number {
  const $el = $(el);
  const text = $el.text().trim();
  if (text.length < 200) return 0;
  const paragraphs = $el.find('p').length;
  if (paragraphs < 2) return 0;
  const links = $el.find('a').length;
  const images = $el.find('img').length;
  if (links / paragraphs > 1.5) return 0;
  const headings = $el.find('h1,h2,h3').length;
  const commaCount = (text.match(/,/g) ?? []).length;
  return text.length + paragraphs * 60 + images * 30 + headings * 10 + commaCount * 2;
}

function extract(html: string): string | null {
  const $ = cheerio.load(html);

  $(STRIP_TAGS.join(',')).remove();
  // Strip elements whose class/id loudly says they are chrome.
  $('[class],[id]').each((_, el) => {
    const $el = $(el);
    if (NOISE.test($el.attr('class') ?? '') || NOISE.test($el.attr('id') ?? '')) {
      $el.remove();
    }
  });

  // Preserve the FE's candidate ordering so ties resolve identically.
  const candidates: Element[] = [
    ...$('article').toArray(),
    ...$('main').toArray(),
    ...$('[itemprop="articleBody"]').toArray(),
    ...$('div').toArray(),
  ];

  let best: Element | null = null;
  let bestScore = 0;
  for (const el of candidates) {
    const s = score($, el);
    if (s > bestScore) {
      bestScore = s;
      best = el;
    }
  }
  if (!best) return null;
  const cleaned = $.html(best);
  if (cleaned.length < MIN_BODY_CHARS) return null;
  return cleaned;
}

/** Fetch [url] and return the extracted article HTML, or null. Never throws. */
export async function getArticleContent(url: string): Promise<{ contentHtml: string | null }> {
  const key = `article:${url}`;
  const hit = cache.get<{ contentHtml: string | null }>(key);
  if (hit) return hit;
  let contentHtml: string | null = null;
  try {
    const resp = await http.get(url, { headers: BROWSER_HEADERS, timeout: 12_000 });
    if (resp.status === 200 && typeof resp.data === 'string') {
      contentHtml = extract(resp.data);
    }
  } catch {
    /* leave null */
  }
  const out = { contentHtml };
  cache.set(key, out);
  return out;
}
