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

function charsetFromContentType(ct?: string): string | null {
  if (!ct) return null;
  const m = /charset=["']?([\w-]+)/i.exec(ct);
  return m ? m[1].toLowerCase() : null;
}

/** Charset declared inside the document itself (XML decl or HTML <meta>). */
function charsetFromMarkup(head: string): string | null {
  const xml = /<\?xml[^>]*encoding=["']([\w-]+)["']/i.exec(head);
  if (xml) return xml[1].toLowerCase();
  const metaCharset = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head);
  if (metaCharset) return metaCharset[1].toLowerCase();
  const metaHttp = /<meta[^>]+content=["'][^"']*charset=([\w-]+)/i.exec(head);
  if (metaHttp) return metaHttp[1].toLowerCase();
  return null;
}

function decodeWith(buf: Buffer, charset: string): string {
  try {
    return new TextDecoder(charset, { fatal: false }).decode(buf);
  } catch {
    // Unknown/unsupported label — fall back to UTF-8.
    return new TextDecoder('utf-8').decode(buf);
  }
}

/**
 * Fetch [url] and decode the body to a correct Unicode string, picking the
 * charset robustly so we never get UTF-8-as-Latin1 mojibake (الع → Ø§ÙØ¹):
 *   1. UTF-8 BOM → UTF-8.
 *   2. Bytes that are *valid* UTF-8 → UTF-8. This wins even when the server
 *      mislabels the charset — several PK feeds claim ISO-8859-1 yet send UTF-8.
 *   3. Otherwise decode with the charset the server/markup declares (HTTP header,
 *      then <?xml>/<meta>), defaulting to windows-1252 for legacy Western pages.
 * Fetches raw bytes (arraybuffer) so axios can't impose its own UTF-8 guess.
 */
export async function fetchText(
  url: string,
  opts: { headers?: Record<string, string>; timeout?: number } = {},
): Promise<{ status: number; text: string }> {
  const resp = await http.get<ArrayBuffer>(url, {
    headers: opts.headers ?? BROWSER_HEADERS,
    timeout: opts.timeout ?? 12_000,
    responseType: 'arraybuffer',
    decompress: true,
  });
  const buf = Buffer.from(resp.data);

  // 1) UTF-8 BOM.
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { status: resp.status, text: new TextDecoder('utf-8').decode(buf) };
  }
  // 2) Valid UTF-8 wins (covers mislabeled-but-actually-UTF-8 sources).
  try {
    return {
      status: resp.status,
      text: new TextDecoder('utf-8', { fatal: true }).decode(buf),
    };
  } catch {
    /* not valid UTF-8 → genuinely a legacy encoding, fall through */
  }
  // 3) Trust the declared charset (but never re-try UTF-8, which we know failed).
  const declared =
    charsetFromContentType(resp.headers['content-type'] as string | undefined) ??
    charsetFromMarkup(buf.toString('latin1', 0, 2048));
  const charset = !declared || declared === 'utf-8' ? 'windows-1252' : declared;
  return { status: resp.status, text: decodeWith(buf, charset) };
}
