// api/listings.js
// Serverless function for Vercel to aggregate listings from major exchanges.
// Sources used (see docs in comments):
// - Binance announcements (New Cryptocurrency Listings) [unofficial CMS endpoint]
// - Bybit v5 Announcement API (category=Listing) — official
// - KuCoin Get Announcements API — official
// - OKX New Listings page — HTML
// - MEXC New Listings page — HTML
//
// Notes:
// * We DO NOT expose links in the client UI (per product requirement), but we still read them here to confirm context.
// * We filter past listings to last 14 days; keep upcoming too.
// * All fields normalized to: {date, exchange, token, pair, type, note}
//
// Citations:
// Bybit Announcement API docs: https://bybit-exchange.github.io/docs/v5/announcement
// KuCoin Announcements API: https://www.kucoin.com/docs-new/rest/spot-trading/market-data/get-announcements
// Binance Announcement page: https://www.binance.com/en/support/announcement
// OKX New listings: https://www.okx.com/en-eu/help/section/announcements-new-listings
// MEXC New listings: https://www.mexc.com/announcements/new-listings

export const config = {
  runtime: 'edge',
};

const DAY_MS = 86400000;
const CUTOFF_MS = 14 * DAY_MS;

function toISO(d) {
  const t = Number.isFinite(d) ? d : Date.parse(d);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}
function withinWindow(ts) {
  const now = Date.now();
  return (ts >= now - CUTOFF_MS) || (ts >= now - DAY_MS/2); // keep near-future & last 14d
}
function cleanText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}
function pickTokenFromTitle(title) {
  // try formats like "Binance Will List XYZ (XYZ)"
  const t = title || '';
  let m = t.match(/\b([A-Z0-9]{2,12})\b(?=[\s\-\(])/);
  if (m) return m[1];
  return '';
}
function pickPairFromTitle(title) {
  const m = (title||'').match(/\b([A-Z0-9]{2,12})\/(USDT|USD|USDC|BTC|ETH)\b/i);
  return m ? (m[1].toUpperCase() + '/' + m[2].toUpperCase()) : '';
}
function pickTypeFromTitle(title) {
  const t = (title||'').toLowerCase();
  if (t.includes('futures')) return 'Futures';
  if (t.includes('margin')) return 'Margin';
  if (t.includes('spot')) return 'Spot';
  if (t.includes('launchpad') || t.includes('launchpool') || t.includes('jumpstart')) return 'Launch/IEO';
  return '';
}
function clampISO(d) {
  // fallback to now if missing
  return toISO(d) || new Date().toISOString();
}

// ---- fetch helpers ----
async function fetchJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'ListingsBot/1.0' } });
  if (!r.ok) throw new Error(`Fetch failed ${r.status}`);
  return r.json();
}
async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'ListingsBot/1.0' } });
  if (!r.ok) throw new Error(`Fetch failed ${r.status}`);
  return r.text();
}

// ---- Binance (unofficial CMS endpoint) ----
async function getBinance() {
  try {
    const url = 'https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&catalogId=48&pageNo=1&pageSize=50';
    const j = await fetchJson(url);
    // Structure may contain data.articles or data.items; map defensively
    const list = j?.data?.articles || j?.data?.items || j?.data?.catalogs || [];
    const out = [];
    for (const it of list) {
      const title = cleanText(it?.title || it?.headline || '');
      if (!title) continue;
      const ts = it?.releaseDate || it?.publishDate || it?.ctime || it?.updateTime;
      const iso = clampISO(ts);
      const tnum = Date.parse(iso);
      if (!withinWindow(tnum)) continue;
      const token = pickTokenFromTitle(title);
      const pair = pickPairFromTitle(title);
      const type = pickTypeFromTitle(title);
      out.push({
        date: iso,
        exchange: 'Binance',
        token,
        pair,
        type,
        note: title
      });
    }
    return out;
  } catch (e) {
    return [];
  }
}

// ---- Bybit (official) ----
async function getBybit() {
  try {
    const url = 'https://api.bybit.com/v5/announcement?category=Listing&limit=50';
    const j = await fetchJson(url);
    const list = j?.result?.list || [];
    const out = [];
    for (const it of list) {
      const title = cleanText(it?.title);
      const ts = Number(it?.dateTimestamp) || Date.parse(it?.date);
      const iso = clampISO(ts);
      if (!withinWindow(Date.parse(iso))) continue;
      out.push({
        date: iso,
        exchange: 'Bybit',
        token: pickTokenFromTitle(title),
        pair: pickPairFromTitle(title),
        type: pickTypeFromTitle(title),
        note: title
      });
    }
    return out;
  } catch (e) {
    return [];
  }
}

// ---- KuCoin (official) ----
async function getKuCoin() {
  try {
    const url = 'https://api.kucoin.com/api/v3/announcements?pageSize=50';
    const j = await fetchJson(url);
    const list = j?.data?.items || j?.items || j?.data || [];
    const out = [];
    for (const it of list) {
      const title = cleanText(it?.title || it?.name);
      const ts = it?.publishTime || it?.createdAt || it?.ctime;
      const iso = clampISO(ts);
      if (!withinWindow(Date.parse(iso))) continue;
      if (!/list|listing|trading pair/i.test(title)) continue; // crude filter
      out.push({
        date: iso,
        exchange: 'KuCoin',
        token: pickTokenFromTitle(title),
        pair: pickPairFromTitle(title),
        type: pickTypeFromTitle(title),
        note: title
      });
    }
    return out;
  } catch (e) {
    return [];
  }
}

// ---- OKX (HTML) ----
async function getOKX() {
  try {
    const url = 'https://www.okx.com/en-eu/help/section/announcements-new-listings';
    const html = await fetchText(url);
    const out = [];
    // naive parsing: grab items with date and title
    const itemRe = /<a[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>[^]*?datetime="([^"]+)"/gi;
    let m;
    while ((m = itemRe.exec(html))) {
      const title = cleanText(m[2].replace(/<[^>]+>/g,''));
      const iso = clampISO(m[3]);
      if (!withinWindow(Date.parse(iso))) continue;
      out.push({
        date: iso,
        exchange: 'OKX',
        token: pickTokenFromTitle(title),
        pair: pickPairFromTitle(title),
        type: pickTypeFromTitle(title),
        note: title
      });
    }
    return out;
  } catch (e) {
    return [];
  }
}

// ---- MEXC (HTML) ----
async function getMEXC() {
  try {
    const url = 'https://www.mexc.com/announcements/new-listings';
    const html = await fetchText(url);
    const out = [];
    const itemRe = /<a[^>]*href="[^"]*"[^>]*>(.*?)<\/a>[^]*?(?:<time[^>]*datetime="([^"]+)")?/gi;
    let m;
    while ((m = itemRe.exec(html))) {
      const title = cleanText(m[1].replace(/<[^>]+>/g,''));
      if (!/list|listing|will list|new\s+listing/i.test(title)) continue;
      const iso = clampISO(m[2] || Date.now());
      if (!withinWindow(Date.parse(iso))) continue;
      out.push({
        date: iso,
        exchange: 'MEXC',
        token: pickTokenFromTitle(title),
        pair: pickPairFromTitle(title),
        type: pickTypeFromTitle(title),
        note: title
      });
    }
    return out;
  } catch (e) {
    return [];
  }
}

async function handler() {
  const [binance, bybit, kucoin, okx, mexc] = await Promise.all([
    getBinance(),
    getBybit(),
    getKuCoin(),
    getOKX(),
    getMEXC()
  ]);

  let all = [...binance, ...bybit, ...kucoin, ...okx, ...mexc]
    .filter(x => x && x.date && x.exchange);

  // de-duplicate by (exchange+token+date+pair)
  const seen = new Set();
  all = all.filter(x => {
    const key = [x.exchange, x.token, x.pair, x.date].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort: upcoming first by date asc, then recent by date desc
  const now = Date.now();
  all.sort((a,b)=>{
    const ta = Date.parse(a.date), tb = Date.parse(b.date);
    const fa = ta >= now, fb = tb >= now;
    if (fa !== fb) return fa ? -1 : 1;
    // both upcoming or both past
    return fa ? (ta - tb) : (tb - ta);
  });

  return new Response(JSON.stringify(all, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'access-control-allow-origin': '*'
    }
  });
}

export default handler;
