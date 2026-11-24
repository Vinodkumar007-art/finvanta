import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { marketCache, providerFailures } from "@/db/schema";
import { rateLimit } from "@/lib/ratelimit";
import { demoCandles, type Candle } from "@/engines/technical";

export type Quote = {
  symbol: string; name?: string; price: number; change?: number; changePct?: number; currency?: string; asOf: string; provider: string;
  volume?: number | null; marketCap?: number | null; peRatio?: number | null; dividendYield?: number | null; sector?: string | null; industry?: string | null;
};
export type DataStatus = "live" | "demo" | "unavailable";
export type MacroIndicator = { label: string; value: string; period: string };
type FredObservation = { date: string; value: string };
export type ProviderRequestOptions = { timeoutMs?: number; attempts?: number; allowNotFound?: boolean };

export const providers = () => {
  const cloudflareModel = process.env.CLOUDFLARE_MODEL?.trim();
  return {
    fmp: !!process.env.FMP_API_KEY,
    twelve: !!process.env.TWELVE_DATA_API_KEY,
    indianMarket: !!process.env.INDIAN_MARKET_API_BASE_URL?.trim(),
    yahooFinanceFallback: true,
    cloudflare: !!process.env.CLOUDFLARE_API_TOKEN?.trim()
      && !!process.env.CLOUDFLARE_ACCOUNT_ID?.trim()
      && !!cloudflareModel
      && (!cloudflareModel.startsWith("@cf/") || !!process.env.CLOUDFLARE_AI_GATEWAY_ID?.trim()),
    openai: !!process.env.OPENAI_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
    fred: !!process.env.FRED_API_KEY,
  };
};
export const anyMarketProvider = () => providers().fmp || providers().twelve;

async function cached<T>(key: string, ttlSec: number, fetcher: () => Promise<{ data: T; provider: string }>): Promise<{ data: T; provider: string; fetchedAt: Date; cached: boolean } | null> {
  const [row] = await db.select().from(marketCache).where(eq(marketCache.key, key)).limit(1);
  if (row && Date.now() - row.fetchedAt.getTime() < ttlSec * 1000) return { data: row.payload as T, provider: row.provider, fetchedAt: row.fetchedAt, cached: true };
  try {
    const r = await fetcher();
    const now = new Date();
    await db.insert(marketCache).values({ key, payload: r.data as never, provider: r.provider, fetchedAt: now })
      .onConflictDoUpdate({ target: marketCache.key, set: { payload: r.data as never, provider: r.provider, fetchedAt: now } });
    return { ...r, fetchedAt: now, cached: false };
  } catch {
    return row ? { data: row.payload as T, provider: row.provider + " (stale)", fetchedAt: row.fetchedAt, cached: true } : null;
  }
}

async function http(provider: string, url: string, endpoint: string, options: ProviderRequestOptions = {}) {
  const lim = rateLimit(`provider:${provider}`, Number(process.env.PROVIDER_DAILY_LIMIT ?? 200), 86400_000);
  if (!lim.ok) throw new Error(`${provider} daily request budget exhausted`);
  let last = "";
  const attempts = options.attempts ?? 3;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(options.timeoutMs ?? 8000), cache: "no-store" });
      if (res.ok || (options.allowNotFound && res.status === 404)) return await res.json();
      last = `HTTP ${res.status}`;
      if (res.status < 500 && res.status !== 429) break;
    } catch (e) { last = (e as Error).message; }
    await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
  }
  await db.insert(providerFailures).values({ provider, endpoint, error: last.slice(0, 300) });
  throw new Error(last);
}

export { cached as cacheMarketData, http as fetchProviderJson };

export async function recordMarketProviderFailure(provider: string, endpoint: string, error: unknown) {
  await db.insert(providerFailures).values({ provider, endpoint, error: (error instanceof Error ? error.message : String(error)).slice(0, 300) });
}

export async function getQuote(symbol: string): Promise<{ status: DataStatus; quote?: Quote; fetchedAt?: Date; note?: string }> {
  const sym = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9.:^=\-&]{1,30}$/.test(sym)) return { status: "unavailable", note: "Invalid symbol." };
  if (/\.(?:NS|BO)$/.test(sym)) {
    const indian = await import("@/services/indian-market");
    const result = await indian.getIndianStock(sym);
    if (result.stock?.lastPrice !== null && result.stock?.lastPrice !== undefined) {
      return {
        status: "live",
        quote: {
          symbol: result.stock.ticker,
          name: result.stock.companyName ?? undefined,
          price: result.stock.lastPrice,
          change: result.stock.change ?? undefined,
          changePct: result.stock.percentChange === null ? undefined : result.stock.percentChange / 100,
          currency: result.stock.currency ?? undefined,
          asOf: result.stock.lastUpdate ?? result.stock.fetchedAt,
          provider: result.provider,
          volume: result.stock.volume,
          marketCap: result.stock.marketCap,
          peRatio: result.stock.peRatio,
          dividendYield: result.stock.dividendYield,
          sector: result.stock.sector,
          industry: result.stock.industry,
        },
        fetchedAt: new Date(result.stock.fetchedAt),
        note: result.note ?? (result.stale ? "Showing cached market data; the latest refresh failed." : "Latest available Indian quote; provider data may be delayed."),
      };
    }
    if (!anyMarketProvider()) return { status: "unavailable", note: result.note ?? "Indian market quote is unavailable." };
  }
  if (!anyMarketProvider()) return { status: "unavailable", note: "No market data provider configured (set FMP_API_KEY or TWELVE_DATA_API_KEY)." };
  const r = await cached<Quote>(`quote:${sym}`, 300, async () => {
    if (process.env.FMP_API_KEY) {
      const j = await http("fmp", `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(sym)}&apikey=${process.env.FMP_API_KEY}`, "quote");
      const q = Array.isArray(j) ? j[0] : null; if (!q?.price) throw new Error("empty");
      return { provider: "Financial Modeling Prep", data: { symbol: sym, name: q.name, price: Number(q.price), change: Number(q.change), changePct: Number(q.changePercentage ?? q.changesPercentage) / 100, asOf: q.timestamp ? new Date(q.timestamp * 1000).toISOString() : new Date().toISOString(), provider: "Financial Modeling Prep" } };
    }
    const j = await http("twelve", `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(sym)}&apikey=${process.env.TWELVE_DATA_API_KEY}`, "quote");
    if (!j?.close) throw new Error("empty");
    return { provider: "Twelve Data", data: { symbol: sym, name: j.name, price: Number(j.close), change: Number(j.change), changePct: Number(j.percent_change) / 100, currency: j.currency, asOf: j.datetime ? new Date(j.datetime).toISOString() : new Date().toISOString(), provider: "Twelve Data" } };
  });
  if (!r) return { status: "unavailable", note: "Provider request failed; failure recorded." };
  return { status: "live", quote: { ...r.data, provider: r.provider }, fetchedAt: r.fetchedAt, note: "Provider data may be delayed; check your plan's licence terms." };
}

export async function getHistory(symbol: string): Promise<{ status: DataStatus; candles: Candle[]; provider: string; asOf: string; note?: string }> {
  const sym = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9.:^=\-&]{1,30}$/.test(sym)) return { status: "unavailable", candles: [], provider: "none", asOf: new Date().toISOString(), note: "Invalid symbol." };
  if (/\.(?:NS|BO)$/.test(sym)) {
    const indian = await import("@/services/indian-market");
    const history = await indian.getIndianHistory(sym);
    if (history.status === "live") {
      return {
        status: "live",
        candles: history.candles,
        provider: history.provider,
        asOf: history.asOf,
        note: history.note,
      };
    }
  }
  if (/\.(?:NS|BO)$/.test(sym) && !process.env.FMP_API_KEY && !process.env.TWELVE_DATA_API_KEY) {
    return {
      status: "unavailable",
      candles: [],
      provider: "none",
      asOf: new Date().toISOString(),
      note: "Historical provider data is not configured for this Indian symbol. No demo history is available.",
    };
  }
  const demo = () => ({ status: "demo" as const, candles: demoCandles(sym, 420), provider: "FINVANTA synthetic generator", asOf: new Date().toISOString(), note: "DEMO DATA — synthetic prices for exploring the tools. Not market data." });
  if (!anyMarketProvider()) return demo();
  const r = await cached<Candle[]>(`hist:${sym}`, 6 * 3600, async () => {
    if (process.env.FMP_API_KEY) {
      const j = await http("fmp", `https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${encodeURIComponent(sym)}&apikey=${process.env.FMP_API_KEY}`, "history");
      if (!Array.isArray(j) || !j.length) throw new Error("empty");
      return { provider: "Financial Modeling Prep", data: j.slice(0, 600).reverse().map((x: Record<string, number | string>) => ({ t: String(x.date), o: Number(x.open), h: Number(x.high), l: Number(x.low), c: Number(x.close), v: Number(x.volume) })) };
    }
    const j = await http("twelve", `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(sym)}&interval=1day&outputsize=500&apikey=${process.env.TWELVE_DATA_API_KEY}`, "history");
    if (!j?.values?.length) throw new Error("empty");
    return { provider: "Twelve Data", data: (j.values as Record<string, string>[]).slice().reverse().map((x) => ({ t: x.datetime.slice(0, 10), o: +x.open, h: +x.high, l: +x.low, c: +x.close, v: +(x.volume ?? 0) })) };
  });
  if (!r) return { status: "unavailable", candles: [], provider: "none", asOf: new Date().toISOString(), note: "Provider request failed; no cached data available." };
  return { status: "live", candles: r.data, provider: r.provider, asOf: r.fetchedAt.toISOString(), note: "End-of-day data; may be delayed." };
}

export async function getNews(): Promise<{ status: DataStatus; items: { title: string; site: string; url: string; date: string; symbol?: string }[]; note?: string; provider?: string }> {
  if (!process.env.FMP_API_KEY) return { status: "unavailable", items: [], note: "Licensed news provider not configured (FMP_API_KEY)." };
  const r = await cached<{ title: string; site: string; url: string; date: string; symbol?: string }[]>("news:general", 900, async () => {
    const j = await http("fmp", `https://financialmodelingprep.com/stable/news/general-latest?page=0&limit=20&apikey=${process.env.FMP_API_KEY}`, "news");
    if (!Array.isArray(j)) throw new Error("bad");
    return { provider: "Financial Modeling Prep", data: j.map((x: Record<string, string>) => ({ title: x.title, site: x.publisher ?? x.site ?? "", url: x.url ?? x.link, date: x.publishedDate ?? x.date, symbol: x.symbol })) };
  });
  if (!r) return { status: "unavailable", items: [], note: "News request failed." };
  return { status: "live", items: r.data, provider: r.provider };
}

export function buildFredMacroIndicators(series: Record<string, FredObservation[]>): MacroIndicator[] {
  const valid = (id: string) => (series[id] ?? [])
    .filter((o) => o.value !== "." && Number.isFinite(Number(o.value)))
    .sort((a, b) => b.date.localeCompare(a.date));
  const latest = (id: string) => valid(id)[0];
  const gdp = latest("A191RL1Q225SBEA");
  const cpi = valid("CPIAUCSL");
  const cpiCurrent = cpi[0];
  const cpiYearAgo = cpiCurrent
    ? cpi.find((o) => o.date.slice(0, 7) === `${Number(cpiCurrent.date.slice(0, 4)) - 1}${cpiCurrent.date.slice(4, 7)}`)
    : undefined;
  const inflation = cpiCurrent && cpiYearAgo && Number(cpiYearAgo.value) !== 0
    ? `${((Number(cpiCurrent.value) / Number(cpiYearAgo.value) - 1) * 100).toFixed(1)}%`
    : "Unavailable";
  const percent = (o?: FredObservation) => o ? `${Number(o.value).toFixed(1)}%` : "Unavailable";

  return [
    { label: "Real GDP growth (annualized)", value: percent(gdp), period: gdp?.date ?? "—" },
    { label: "CPI inflation (year over year)", value: inflation, period: cpiCurrent?.date ?? "—" },
    { label: "Unemployment rate", value: percent(latest("UNRATE")), period: latest("UNRATE")?.date ?? "—" },
    { label: "Federal funds rate", value: percent(latest("FEDFUNDS")), period: latest("FEDFUNDS")?.date ?? "—" },
  ];
}

export async function getFredMacroIndicators(): Promise<{
  status: "live" | "unavailable";
  indicators: MacroIndicator[];
  fetchedAt?: Date;
  provider?: string;
  note?: string;
}> {
  const apiKey = process.env.FRED_API_KEY?.trim();
  if (!apiKey) return { status: "unavailable", indicators: [], note: "FRED_API_KEY is not configured." };

  const r = await cached<MacroIndicator[]>("macro:fred:us:v1", 6 * 3600, async () => {
    const seriesIds = ["A191RL1Q225SBEA", "CPIAUCSL", "UNRATE", "FEDFUNDS"];
    const entries = await Promise.all(seriesIds.map(async (seriesId) => {
      const url = new URL("https://api.stlouisfed.org/fred/series/observations");
      url.searchParams.set("series_id", seriesId);
      url.searchParams.set("api_key", apiKey);
      url.searchParams.set("file_type", "json");
      url.searchParams.set("sort_order", "desc");
      url.searchParams.set("limit", seriesId === "CPIAUCSL" ? "13" : "2");
      const response = await http("fred", url.toString(), `observations:${seriesId}`) as { observations?: FredObservation[] };
      if (!Array.isArray(response.observations)) throw new Error(`FRED returned no observations for ${seriesId}.`);
      return [seriesId, response.observations] as const;
    }));
    const indicators = buildFredMacroIndicators(Object.fromEntries(entries));
    if (indicators.every((item) => item.value === "Unavailable")) throw new Error("FRED returned no usable macro observations.");
    return { provider: "FRED", data: indicators };
  });
  if (!r) return { status: "unavailable", indicators: [], note: "FRED request failed; failure recorded." };
  return {
    status: "live",
    indicators: r.data,
    provider: r.provider,
    fetchedAt: r.fetchedAt,
    note: r.provider.includes("(stale)") ? "Showing cached FRED data; the latest refresh failed." : "U.S. macroeconomic indicators; source: FRED.",
  };
}

export async function providerHealth() {
  const fails = await db.select().from(providerFailures).orderBy(desc(providerFailures.at)).limit(8);
  return { configured: providers(), failures: fails };
}

/** Illustrative screener universe: FICTIONAL companies with synthetic fundamentals. Never presented as real. */
export const DEMO_UNIVERSE = (() => {
  const sectors = ["Banking", "IT Services", "Pharma", "Auto", "FMCG", "Energy", "Metals", "Capital Goods", "Consumer Durables", "Telecom"];
  const names = ["Aurelia", "Bharat Meridian", "Cobalt Peak", "Dhruva", "Everline", "Fathom", "Gandiva", "Helix Arc", "Indus Crest", "Jaya Orbit", "Kestrel", "Lumen", "Mandara", "Nimbus", "Orchid Bay", "Pinnacle Hex", "Quanta Rise", "Rudra", "Solace", "Taranis", "Udaya", "Vajra", "Wavecrest", "Xenon Ridge", "Yamuna Tech", "Zenith Arc", "Altair", "Borealis", "Cedar Point", "Delta Forge"];
  let s = 7; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  return names.map((n, i) => {
    const sector = sectors[i % sectors.length];
    return {
      symbol: n.replace(/\s/g, "").slice(0, 4).toUpperCase() + (i % 10), name: `${n} Ltd (demo)`, sector, industry: `${sector} — Segment ${(i % 3) + 1}`,
      mcap: Math.round(2000 + rnd() * 400000), pe: +(8 + rnd() * 50).toFixed(1), pb: +(0.8 + rnd() * 9).toFixed(1), roe: +(4 + rnd() * 28).toFixed(1), roce: +(5 + rnd() * 30).toFixed(1),
      de: +(rnd() * 2.4).toFixed(2), salesGrowth: +(-5 + rnd() * 35).toFixed(1), profitGrowth: +(-15 + rnd() * 60).toFixed(1), divYield: +(rnd() * 3.5).toFixed(2), changePct: +((rnd() - 0.5) * 6).toFixed(2), volume: Math.round(1e5 + rnd() * 5e6),
    };
  });
})();
