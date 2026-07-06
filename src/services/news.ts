import { XMLParser } from 'fast-xml-parser';
import { fetchText, USER_AGENT } from '../lib/http.js';

export type NewsCategory =
  | 'all'
  | 'pakistan'
  | 'world'
  | 'sport'
  | 'business'
  | 'tech'
  | 'entertainment'
  | 'other';

export interface NewsArticle {
  title: string;
  link: string;
  source: string;
  publishedAt: string;
  excerpt: string;
  imageUrl: string | null;
  category: NewsCategory;
  contentHtml: string | null;
  isRtl: boolean;
}

interface Feed {
  source: string;
  url: string;
}

const NEWS_FEEDS: Feed[] = [
  { source: 'Dawn', url: 'https://www.dawn.com/feeds/home' },
  { source: 'Tribune', url: 'https://tribune.com.pk/feed/home' },
  { source: 'The News', url: 'https://www.thenews.com.pk/rss/1/1' },
  { source: 'ARY News', url: 'https://arynews.tv/feed/' },
  { source: 'Pakistan Today', url: 'https://www.pakistantoday.com.pk/feed/' },
  { source: 'Geo', url: 'https://www.geo.tv/rss/1/1' },
];

const CRICKET_FEEDS: Feed[] = [
  { source: 'ESPNcricinfo', url: 'https://www.espncricinfo.com/rss/content/story/feeds/0.xml' },
  { source: 'ESPNcricinfo — Pakistan', url: 'https://www.espncricinfo.com/rss/content/story/feeds/6.xml' },
];

const CATEGORY_RES: Array<[NewsCategory, RegExp]> = [
  ['pakistan', /pakistan|national|politic|lahore|karachi|islamabad|punjab|sindh|balochistan|kpk/i],
  ['world', /world|international|global|\bus\b|\buk\b|india|china|middle.?east|europe|asia/i],
  ['sport', /sport|cricket|football|hockey|tennis|psl|world.?cup/i],
  ['business', /business|economy|market|stock|finance|rupee|trade/i],
  ['tech', /tech|technology|science|\bai\b|software|gadget|mobile/i],
  ['entertainment', /entertain|showbiz|film|music|drama|celebrity|movie/i],
];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
});

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function categorize(cats: string[]): NewsCategory {
  const joined = cats.join(' ');
  for (const [cat, re] of CATEGORY_RES) if (re.test(joined)) return cat;
  return 'other';
}

function isRtl(text: string): boolean {
  const rtl = (text.match(/[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g) ?? []).length;
  return text.length > 0 && rtl / text.length > 0.4;
}

function extractImage(item: any): string | null {
  const thumb = item['media:thumbnail']?.['@_url'] ?? item['media:content']?.['@_url'];
  if (thumb) return thumb;
  const enc = item.enclosure?.['@_url'];
  if (enc && /\.(jpg|jpeg|png|webp)/i.test(enc)) return enc;
  const content = item['content:encoded'] ?? item.description ?? '';
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(String(content));
  return m ? m[1] : null;
}

async function fetchFeed(feed: Feed): Promise<NewsArticle[]> {
  try {
    const { status, text } = await fetchText(feed.url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml,application/xml,text/xml,*/*' },
      timeout: 10000,
    });
    if (status !== 200) return [];
    const doc = parser.parse(text);
    const items = toArray(doc?.rss?.channel?.item ?? doc?.feed?.entry);
    return items.map((item: any): NewsArticle => {
      const rawTitle = String(item.title?.['#text'] ?? item.title ?? '');
      const contentHtml = String(item['content:encoded'] ?? item.description ?? '') || null;
      const excerptSrc = stripHtml(String(item.description ?? item['content:encoded'] ?? ''));
      const link = String(item.link?.['@_href'] ?? item.link ?? item.guid ?? '');
      const cats = toArray<any>(item.category).map((c) => String(c?.['#text'] ?? c));
      const pub = item.pubDate ?? item['dc:date'] ?? item.published ?? item.updated;
      const parsedDate = pub ? new Date(pub) : new Date();
      const title = stripHtml(rawTitle);
      return {
        title,
        link,
        source: feed.source,
        publishedAt: (isNaN(parsedDate.getTime()) ? new Date() : parsedDate).toISOString(),
        excerpt: excerptSrc.slice(0, 200),
        imageUrl: extractImage(item),
        category: categorize(cats),
        contentHtml,
        isRtl: isRtl(title + ' ' + excerptSrc),
      };
    });
  } catch {
    return [];
  }
}

async function aggregate(feeds: Feed[]): Promise<NewsArticle[]> {
  const all = (await Promise.all(feeds.map(fetchFeed))).flat();
  const seen = new Set<string>();
  const deduped = all.filter((a) => {
    if (!a.link || seen.has(a.link)) return false;
    seen.add(a.link);
    return true;
  });
  deduped.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return deduped.slice(0, 200);
}

export function fetchNewsAll(): Promise<NewsArticle[]> {
  return aggregate(NEWS_FEEDS);
}

export function fetchCricketAll(): Promise<NewsArticle[]> {
  return aggregate(CRICKET_FEEDS);
}

/** Filter a stored news snapshot by category (used by the API layer). */
export function filterNews(articles: NewsArticle[], category: NewsCategory = 'all'): NewsArticle[] {
  if (category === 'all') return articles;
  return articles.filter((a) => a.category === category);
}
