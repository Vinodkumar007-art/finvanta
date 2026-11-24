import "server-only";
import { cacheMarketData, fetchProviderJson, recordMarketProviderFailure } from "@/services/market";

export type IndianExchange = "NSE" | "BSE";
export type IndianStock = {
  symbol: string;
  ticker: string;
  exchange: IndianExchange;
  companyName: string | null;
  lastPrice: number | null;
  change: number | null;
  percentChange: number | null;
  previousClose: number | null;
  open: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  yearHigh: number | null;
  yearLow: number | null;
  volume: number | null;
  marketCap: number | null;
  peRatio: number | null;
  dividendYield: number | null;
  bookValue: number | null;
  earningsPerShare: number | null;
  sector: string | null;
  industry: string | null;
  currency: string | null;
  lastUpdate: string | null;
};
export type IndianSearchResult = { symbol: string; nseTicker: string; bseTicker: string; companyName?: string };
export type IndianSymbol = { searchTerm: string; symbol: string; nseTicker: string; bseTicker: string };
export type IndianStockSummary = Pick<IndianStock,
  "symbol" | "ticker" | "exchange" | "companyName" | "lastPrice" | "change" | "percentChange" | "volume" | "marketCap" | "peRatio"
> & { error: string | null };

type JsonRecord = Record<string, unknown>;
type CachedData<T> = { status: "live"; data: T; provider: string; fetchedAt: string; stale: boolean; note?: string }
  | { status: "unavailable"; data: null; provider: string; note: string };
type SearchData = CachedData<IndianSearchResult[]> | {
  status: "empty"; data: []; provider: string; fetchedAt: string; stale: boolean; note: string;
};
type SearchCache = { kind: "results"; results: IndianSearchResult[] } | { kind: "empty"; note: string };
type StockCache = { kind: "stock"; stock: Omit<IndianStock, "lastUpdate"> & { lastUpdate: string | null } }
  | { kind: "not-found"; note: string };

const SYMBOL_RE = /^[A-Z0-9&._-]{1,30}$/;
const PROVIDER = "Indian Market API";
const YAHOO_PROVIDER = "Yahoo Finance (unofficial; may be delayed)";

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() && value.trim().toUpperCase() !== "N/A" ? value.trim() : null;
}

function number(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeSymbol(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const symbol = value.trim().toUpperCase();
  return SYMBOL_RE.test(symbol) ? symbol : null;
}

function exchangeFor(ticker: string, value?: unknown): IndianExchange {
  if (value === "BSE" || ticker.endsWith(".BO")) return "BSE";
  return "NSE";
}

function normalizeTicker(symbol: string, tickerValue?: unknown): string {
  const ticker = normalizeSymbol(tickerValue);
  if (ticker && /\.(?:NS|BO)$/.test(ticker)) return ticker;
  return `${symbol}.${ticker?.endsWith(".BO") ? "BO" : "NS"}`;
}

function baseUrl(): URL | null {
  const value = process.env.INDIAN_MARKET_API_BASE_URL?.trim();
  if (!value) return null;
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("INDIAN_MARKET_API_BASE_URL must be an HTTP(S) origin or base path without credentials, query, or fragment.");
  }
  return url;
}

function endpointUrl(path: string, params: Record<string, string> = {}): string {
  const base = baseUrl();
  if (!base) throw new Error("INDIAN_MARKET_API_BASE_URL is not configured.");
  const prefix = base.pathname.replace(/\/+$/, "");
  const url = new URL(`${prefix}/${path.replace(/^\/+/, "")}`, base.origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

async function request(path: string, params: Record<string, string>, endpoint: string) {
  return fetchProviderJson("indian-market", endpointUrl(path, params), endpoint, {
    timeoutMs: 2500,
    attempts: 1,
    allowNotFound: true,
  });
}

async function requestYahooChart(ticker: string, range = "1d", interval = "1m") {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}`);
  url.searchParams.set("range", range);
  url.searchParams.set("interval", interval);
  url.searchParams.set("includePrePost", "false");
  return fetchProviderJson("yahoo", url.toString(), `chart:${ticker}`, { timeoutMs: 5000, attempts: 1 });
}

function parseYahooStock(value: unknown, requestedSymbol: string): IndianStock {
  if (!isRecord(value) || !isRecord(value.chart) || !Array.isArray(value.chart.result) || !isRecord(value.chart.result[0])) {
    malformed("Yahoo Finance chart", "expected a chart result.");
  }
  const result = value.chart.result[0];
  if (!isRecord(result.meta)) malformed("Yahoo Finance chart", "expected quote metadata.");
  const meta = result.meta;
  const quote = isRecord(result.indicators) && Array.isArray(result.indicators.quote) && isRecord(result.indicators.quote[0])
    ? result.indicators.quote[0]
    : null;
  const latest = (key: string) => {
    const values = quote && Array.isArray(quote[key]) ? quote[key] : [];
    for (let index = values.length - 1; index >= 0; index--) {
      const parsed = number(values[index]);
      if (parsed !== null) return parsed;
    }
    return null;
  };
  const symbol = normalizeSymbol(meta.symbol) ?? requestedSymbol;
  const ticker = normalizeTicker(symbol, meta.symbol);
  const lastPrice = number(meta.regularMarketPrice) ?? latest("close");
  if (lastPrice === null) malformed("Yahoo Finance chart", "no current or latest close price was returned.");
  const previousClose = number(meta.chartPreviousClose) ?? number(meta.previousClose);
  const change = previousClose === null ? null : lastPrice - previousClose;
  const timestamp = number(meta.regularMarketTime);
  const lastUpdate = timestamp !== null && timestamp > 0 ? new Date(timestamp * 1000).toISOString() : null;

  return {
    symbol: symbol.replace(/\.(?:NS|BO)$/, ""),
    ticker,
    exchange: exchangeFor(ticker),
    companyName: text(meta.longName) ?? text(meta.shortName),
    lastPrice,
    change,
    percentChange: change === null || previousClose === null || previousClose === 0 ? null : change / previousClose * 100,
    previousClose,
    open: number(meta.regularMarketOpen) ?? latest("open"),
    dayHigh: number(meta.regularMarketDayHigh) ?? latest("high"),
    dayLow: number(meta.regularMarketDayLow) ?? latest("low"),
    yearHigh: number(meta.fiftyTwoWeekHigh),
    yearLow: number(meta.fiftyTwoWeekLow),
    volume: number(meta.regularMarketVolume) ?? latest("volume"),
    marketCap: null,
    peRatio: null,
    dividendYield: null,
    bookValue: null,
    earningsPerShare: null,
    sector: null,
    industry: null,
    currency: text(meta.currency),
    lastUpdate,
  };
}

async function getYahooStock(symbol: string) {
  const result = await cacheMarketData<StockCache>(`indian-market:yahoo-stock:${symbol}:v1`, 30, async () => {
    const raw = await requestYahooChart(symbol);
    const stock = parseYahooStock(raw, symbol);
    const { lastUpdate, ...rest } = stock;
    return { provider: YAHOO_PROVIDER, data: { kind: "stock", stock: { ...rest, lastUpdate } } };
  });
  if (!result || result.data.kind !== "stock") return null;
  return {
    stock: { ...result.data.stock, fetchedAt: result.fetchedAt.toISOString() },
    provider: result.provider,
    stale: result.provider.includes("(stale)"),
  };
}

function exchangeFromSearchEntry(value: JsonRecord): IndianExchange | null {
  const exchange = `${value.exchange ?? ""} ${value.exchangeShortName ?? ""} ${value.mic_code ?? ""}`.toUpperCase();
  if (exchange.includes("NSE") || exchange.includes("NATIONAL STOCK") || exchange.includes("XNSE")) return "NSE";
  if (exchange.includes("BSE") || exchange.includes("BOMBAY") || exchange.includes("XBOM")) return "BSE";
  return null;
}

function searchResults(entries: unknown[]): IndianSearchResult[] {
  const results = new Map<string, IndianSearchResult>();
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const rawSymbol = normalizeSymbol(entry.symbol);
    if (!rawSymbol) continue;
    const exchange = exchangeFromSearchEntry(entry);
    const suffix = rawSymbol.endsWith(".NS") ? "NSE" : rawSymbol.endsWith(".BO") ? "BSE" : exchange;
    if (!suffix) continue;
    const symbol = rawSymbol.replace(/\.(?:NS|BO)$/, "");
    const result = results.get(symbol) ?? { symbol, nseTicker: `${symbol}.NS`, bseTicker: `${symbol}.BO` };
    const companyName = text(entry.companyName) ?? text(entry.instrument_name) ?? text(entry.longname) ?? text(entry.shortname) ?? text(entry.name);
    if (companyName && !result.companyName) result.companyName = companyName;
    results.set(symbol, result);
  }
  return [...results.values()];
}

async function searchFallback(query: string): Promise<{ results: IndianSearchResult[]; provider: string } | null> {
  const twelveKey = process.env.TWELVE_DATA_API_KEY?.trim();
  if (twelveKey) {
    try {
      const url = new URL("https://api.twelvedata.com/symbol_search");
      url.searchParams.set("symbol", query);
      url.searchParams.set("apikey", twelveKey);
      const raw = await fetchProviderJson("twelve", url.toString(), "symbol-search", { timeoutMs: 5000, attempts: 1 });
      if (isRecord(raw) && Array.isArray(raw.data)) {
        const results = searchResults(raw.data);
        if (results.length) return { results, provider: "Twelve Data symbol search" };
      }
    } catch { /* Try the next configured search source. */ }
  }

  const fmpKey = process.env.FMP_API_KEY?.trim();
  if (fmpKey) {
    try {
      const url = new URL("https://financialmodelingprep.com/stable/search-symbol");
      url.searchParams.set("query", query);
      url.searchParams.set("limit", "20");
      url.searchParams.set("apikey", fmpKey);
      const raw = await fetchProviderJson("fmp", url.toString(), "symbol-search", { timeoutMs: 5000, attempts: 1 });
      if (Array.isArray(raw)) {
        const results = searchResults(raw);
        if (results.length) return { results, provider: "Financial Modeling Prep symbol search" };
      }
    } catch { /* Try the public search fallback. */ }
  }

  try {
    const url = new URL("https://query1.finance.yahoo.com/v1/finance/search");
    url.searchParams.set("q", query);
    url.searchParams.set("quotesCount", "20");
    url.searchParams.set("newsCount", "0");
    const raw = await fetchProviderJson("yahoo", url.toString(), "symbol-search", { timeoutMs: 5000, attempts: 1 });
    if (isRecord(raw) && Array.isArray(raw.quotes)) {
      const results = searchResults(raw.quotes);
      if (results.length) return { results, provider: YAHOO_PROVIDER };
    }
  } catch { /* The caller reports the original provider failure. */ }
  return null;
}

function malformed(endpoint: string, detail: string): never {
  throw new Error(`Indian Market API returned a malformed ${endpoint} response: ${detail}`);
}

function parseOverview(value: unknown) {
  if (!isRecord(value) || typeof value.status !== "string" || value.status === "error" || !isRecord(value.exchanges)) malformed("overview", "expected a provider status and exchanges.");
  const exchanges: Record<string, { description: string; suffix: string; example: string; default?: boolean }> = {};
  for (const [key, exchange] of Object.entries(value.exchanges)) {
    if (!isRecord(exchange) || typeof exchange.description !== "string" || typeof exchange.suffix !== "string" || typeof exchange.example !== "string") continue;
    exchanges[key] = { description: exchange.description, suffix: exchange.suffix, example: exchange.example, ...(typeof exchange.default === "boolean" ? { default: exchange.default } : {}) };
  }
  return {
    message: text(value.message),
    version: text(value.version),
    features: Array.isArray(value.features) ? value.features.filter((item): item is string => typeof item === "string") : [],
    exchanges,
  };
}

function parseSearch(value: unknown): { kind: "results"; results: IndianSearchResult[] } | { kind: "empty"; note: string } {
  if (!isRecord(value)) malformed("search", "expected an object.");
  if (value.status === "error" && typeof value.message === "string") return { kind: "empty", note: value.message };
  if (value.status !== "success" || !Array.isArray(value.results)) malformed("search", "expected a success response with results.");
  const seen = new Set<string>();
  const results = value.results.flatMap((entry): IndianSearchResult[] => {
    if (!isRecord(entry)) return [];
    const symbol = normalizeSymbol(entry.symbol);
    if (!symbol) return [];
    const canonical = symbol.replace(/\.(?:NS|BO)$/, "");
    if (seen.has(canonical)) return [];
    seen.add(canonical);
    return [{ symbol: canonical, nseTicker: `${canonical}.NS`, bseTicker: `${canonical}.BO` }];
  });
  return results.length ? { kind: "results", results } : { kind: "empty", note: "No valid symbols were returned for this search." };
}

function parseStockFields(value: JsonRecord, fallbackSymbol: string): IndianStock {
  const symbol = normalizeSymbol(value.symbol) ?? fallbackSymbol.replace(/\.(?:NS|BO)$/, "");
  const ticker = normalizeTicker(symbol, value.ticker ?? fallbackSymbol);
  return {
    symbol,
    ticker,
    exchange: exchangeFor(ticker, value.exchange),
    companyName: text(value.company_name),
    lastPrice: number(value.last_price),
    change: number(value.change),
    percentChange: number(value.percent_change),
    previousClose: number(value.previous_close),
    open: number(value.open),
    dayHigh: number(value.day_high),
    dayLow: number(value.day_low),
    yearHigh: number(value.year_high),
    yearLow: number(value.year_low),
    volume: number(value.volume),
    marketCap: number(value.market_cap),
    peRatio: number(value.pe_ratio),
    dividendYield: number(value.dividend_yield),
    bookValue: number(value.book_value),
    earningsPerShare: number(value.earnings_per_share),
    sector: text(value.sector),
    industry: text(value.industry),
    currency: text(value.currency),
    lastUpdate: text(value.last_update),
  };
}

function parseStock(value: unknown, requestedSymbol: string): StockCache {
  if (!isRecord(value)) malformed("stock", "expected an object.");
  if (value.status === "error" && typeof value.message === "string") return { kind: "not-found", note: value.message };
  if ((value.status !== undefined && value.status !== "success") || !isRecord(value.data) || number(value.data.last_price) === null) malformed("stock", "expected a valid last_price.");
  if (!normalizeSymbol(value.symbol) || !normalizeSymbol(value.ticker) || !["NSE", "BSE"].includes(String(value.exchange))) malformed("stock", "expected a valid symbol, ticker, and exchange.");
  const stock = parseStockFields({ ...value.data, symbol: value.symbol, ticker: value.ticker, exchange: value.exchange }, requestedSymbol);
  const { lastUpdate, ...rest } = stock;
  return { kind: "stock", stock: { ...rest, lastUpdate } };
}

function parseStockList(value: unknown, requestedSymbols: string[]): IndianStockSummary[] {
  if (!isRecord(value) || value.status !== "success" || !Array.isArray(value.stocks)) malformed("stock list", "expected success status and stocks.");
  return value.stocks.flatMap((entry, index): IndianStockSummary[] => {
    if (!isRecord(entry)) return [];
    const fallback = requestedSymbols[index] ?? "";
    const symbol = normalizeSymbol(entry.symbol) ?? fallback.replace(/\.(?:NS|BO)$/, "");
    if (!symbol) return [];
    const ticker = normalizeTicker(symbol, entry.ticker ?? fallback);
    const err = text(entry.error);
    if (!err && !Object.prototype.hasOwnProperty.call(entry, "last_price")) return [];
    return [{
      symbol,
      ticker,
      exchange: exchangeFor(ticker, entry.exchange),
      companyName: text(entry.company_name),
      lastPrice: number(entry.last_price),
      change: number(entry.change),
      percentChange: number(entry.percent_change),
      volume: number(entry.volume),
      marketCap: number(entry.market_cap),
      peRatio: number(entry.pe_ratio),
      error: err,
    }];
  });
}

function parseSymbols(value: unknown): IndianSymbol[] {
  if (!isRecord(value) || value.status !== "success" || !Array.isArray(value.symbols)) malformed("symbols", "expected success status and symbols.");
  return value.symbols.flatMap((entry): IndianSymbol[] => {
    if (!isRecord(entry)) return [];
    const symbol = normalizeSymbol(entry.symbol);
    const searchTerm = text(entry.search_term);
    if (!symbol || !searchTerm) return [];
    const canonical = symbol.replace(/\.(?:NS|BO)$/, "");
    return [{ searchTerm, symbol: canonical, nseTicker: `${canonical}.NS`, bseTicker: `${canonical}.BO` }];
  });
}

async function recordMalformed(endpoint: string, error: unknown) {
  await recordMarketProviderFailure("indian-market", endpoint, error);
}

export async function getIndianMarketOverview(): Promise<CachedData<ReturnType<typeof parseOverview>>> {
  if (!process.env.INDIAN_MARKET_API_BASE_URL?.trim()) return { status: "unavailable", data: null, provider: PROVIDER, note: "INDIAN_MARKET_API_BASE_URL is not configured." };
  const result = await cacheMarketData("indian-market:overview:v1", 3600, async () => {
    const raw = await request("/", {}, "overview");
    try { return { provider: PROVIDER, data: parseOverview(raw) }; }
    catch (error) { await recordMalformed("overview", error); throw error; }
  });
  if (!result) return { status: "unavailable", data: null, provider: PROVIDER, note: "Indian Market API is unavailable. Stock search and quotes will use configured market providers or Yahoo Finance as a delayed fallback." };
  return { status: "live", data: result.data, provider: result.provider, fetchedAt: result.fetchedAt.toISOString(), stale: result.provider.includes("(stale)") };
}

export async function searchIndianStocks(query: string): Promise<SearchData> {
  const normalized = query.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 80 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    return { status: "unavailable", data: null, provider: PROVIDER, note: "Enter a search term between 1 and 80 characters." };
  }
  const searchTerm = normalized.replace(/\.(?:NS|BO)$/i, "");
  let result: Awaited<ReturnType<typeof cacheMarketData<SearchCache>>> = null;
  if (process.env.INDIAN_MARKET_API_BASE_URL?.trim()) {
    result = await cacheMarketData<SearchCache>(`indian-market:search:${searchTerm.toLowerCase()}:v1`, 600, async () => {
      const raw = await request("search", { q: searchTerm }, "search");
      try {
        const parsed = parseSearch(raw);
        return { provider: PROVIDER, data: parsed.kind === "results" ? { kind: "results", results: parsed.results } : { kind: "empty", note: parsed.note } };
      } catch (error) { await recordMalformed("search", error); throw error; }
    });
  }
  if (result && !result.provider.includes("(stale)")) {
    const common = { provider: result.provider, fetchedAt: result.fetchedAt.toISOString(), stale: false };
    return result.data.kind === "results"
      ? { status: "live", data: result.data.results, ...common }
      : { status: "empty", data: [], ...common, note: result.data.note };
  }
  const fallback = await searchFallback(searchTerm);
  if (fallback) {
    const fetchedAt = new Date().toISOString();
    const data = fallback.results.length ? fallback.results : result?.data.kind === "results" ? result.data.results : [];
    return data.length
      ? { status: "live", data, provider: fallback.provider, fetchedAt, stale: false, note: result ? "Using fallback search because the primary Indian market API is unavailable." : undefined }
      : { status: "empty", data: [], provider: fallback.provider, fetchedAt, stale: false, note: "No Indian listings matched this search." };
  }
  if (result) {
    const common = { provider: result.provider, fetchedAt: result.fetchedAt.toISOString(), stale: true, note: "Search providers are unavailable; showing cached results." };
    return result.data.kind === "results"
      ? { status: "live", data: result.data.results, ...common }
      : { status: "empty", data: [], ...common, note: result.data.note };
  }
  return { status: "unavailable", data: null, provider: PROVIDER, note: "Configured market search providers are unavailable." };
}

export async function getIndianStock(symbol: string): Promise<{ status: "live" | "not-found" | "unavailable"; stock?: IndianStock & { fetchedAt: string }; provider: string; stale?: boolean; note?: string }> {
  const normalized = normalizeSymbol(symbol);
  if (!normalized) return { status: "unavailable", provider: PROVIDER, note: "Invalid Indian stock symbol." };
  let result: Awaited<ReturnType<typeof cacheMarketData<StockCache>>> = null;
  if (process.env.INDIAN_MARKET_API_BASE_URL?.trim()) {
    result = await cacheMarketData<StockCache>(`indian-market:stock:${normalized}:v1`, 60, async () => {
      const raw = await request("stock", { symbol: normalized, res: "num" }, "stock");
      try { return { provider: PROVIDER, data: parseStock(raw, normalized) }; }
      catch (error) { await recordMalformed("stock", error); throw error; }
    });
  }
  if (result && result.data.kind === "stock" && !result.provider.includes("(stale)")) {
    return {
      status: "live",
      provider: result.provider,
      stale: false,
      stock: { ...result.data.stock, fetchedAt: result.fetchedAt.toISOString() },
    };
  }
  const fallback = await getYahooStock(normalized);
  if (fallback) {
    return {
      status: "live",
      provider: fallback.provider,
      stale: fallback.stale,
      stock: fallback.stock,
      note: result ? "The primary Indian market API is unavailable; showing Yahoo Finance data, which may be delayed." : "Yahoo Finance data may be delayed and is not an official exchange feed.",
    };
  }
  if (result?.data.kind === "stock") {
    return { status: "live", provider: result.provider, stale: true, stock: { ...result.data.stock, fetchedAt: result.fetchedAt.toISOString() }, note: "Showing stale cached data; current providers are unavailable." };
  }
  if (result?.data.kind === "not-found") {
    return { status: "not-found", provider: result.provider, stale: result.provider.includes("(stale)"), note: result.data.note };
  }
  return { status: "unavailable", provider: PROVIDER, note: "Indian stock data providers are unavailable or returned invalid data." };
}

export async function getIndianStockList(symbols: string[]): Promise<CachedData<IndianStockSummary[]>> {
  const normalized = [...new Set(symbols.map(normalizeSymbol).filter((symbol): symbol is string => symbol !== null))];
  if (symbols.length < 1 || symbols.length > 10 || normalized.length !== symbols.length) {
    return { status: "unavailable", data: null, provider: PROVIDER, note: "Provide 1 to 10 valid symbols." };
  }
  const key = normalized.join(",");
  const result = process.env.INDIAN_MARKET_API_BASE_URL?.trim()
    ? await cacheMarketData(`indian-market:list:${key}:v1`, 60, async () => {
      const raw = await request("stock/list", { symbols: normalized.join(","), res: "num" }, "stock/list");
      try { return { provider: PROVIDER, data: parseStockList(raw, normalized) }; }
      catch (error) { await recordMalformed("stock/list", error); throw error; }
    })
    : null;
  if (result && result.data.some((item) => item.lastPrice !== null) && !result.provider.includes("(stale)")) {
    return { status: "live", data: result.data, provider: result.provider, fetchedAt: result.fetchedAt.toISOString(), stale: false };
  }
  const fallback = await Promise.all(normalized.map((ticker) => getYahooStock(ticker)));
  const data = fallback.flatMap((item): IndianStockSummary[] => item ? [{
    symbol: item.stock.symbol,
    ticker: item.stock.ticker,
    exchange: item.stock.exchange,
    companyName: item.stock.companyName,
    lastPrice: item.stock.lastPrice,
    change: item.stock.change,
    percentChange: item.stock.percentChange,
    volume: item.stock.volume,
    marketCap: item.stock.marketCap,
    peRatio: item.stock.peRatio,
    error: null,
  }] : []);
  if (data.length) return {
    status: "live",
    data,
    provider: YAHOO_PROVIDER,
    fetchedAt: new Date().toISOString(),
    stale: fallback.some((item) => item?.stale),
    note: result ? "The primary Indian market API is unavailable; comparison values may be delayed." : "Yahoo Finance comparison data may be delayed and is not an official exchange feed.",
  };
  if (result) return { status: "live", data: result.data, provider: result.provider, fetchedAt: result.fetchedAt.toISOString(), stale: true, note: "Showing cached comparison data; current providers are unavailable." };
  return { status: "unavailable", data: null, provider: PROVIDER, note: "Indian comparison data providers are unavailable." };
}

export async function getIndianSymbols(): Promise<CachedData<IndianSymbol[]>> {
  if (!process.env.INDIAN_MARKET_API_BASE_URL?.trim()) return { status: "unavailable", data: null, provider: PROVIDER, note: "INDIAN_MARKET_API_BASE_URL is not configured." };
  const result = await cacheMarketData("indian-market:symbols:v1", 86400, async () => {
    const raw = await request("symbols", {}, "symbols");
    try { return { provider: PROVIDER, data: parseSymbols(raw) }; }
    catch (error) { await recordMalformed("symbols", error); throw error; }
  });
  if (!result) return { status: "unavailable", data: null, provider: PROVIDER, note: "Provider unavailable or returned invalid symbol data." };
  return { status: "live", data: result.data, provider: result.provider, fetchedAt: result.fetchedAt.toISOString(), stale: result.provider.includes("(stale)") };
}

export async function getIndianHistory(symbol: string): Promise<{ status: "live" | "unavailable"; candles: { t: string; o: number; h: number; l: number; c: number; v: number }[]; provider: string; asOf: string; note?: string }> {
  const normalized = normalizeSymbol(symbol);
  if (!normalized || !/\.(?:NS|BO)$/.test(normalized)) {
    return { status: "unavailable", candles: [], provider: "none", asOf: new Date().toISOString(), note: "Invalid Indian stock symbol." };
  }
  const result = await cacheMarketData(`indian-market:yahoo-history:${normalized}:v1`, 6 * 3600, async () => {
    const raw = await requestYahooChart(normalized, "1y", "1d");
    if (!isRecord(raw) || !isRecord(raw.chart) || !Array.isArray(raw.chart.result) || !isRecord(raw.chart.result[0])) {
      malformed("Yahoo Finance history", "expected a chart result.");
    }
    const chart = raw.chart.result[0];
    if (!Array.isArray(chart.timestamp) || !isRecord(chart.indicators) || !Array.isArray(chart.indicators.quote) || !isRecord(chart.indicators.quote[0])) {
      malformed("Yahoo Finance history", "expected timestamps and daily prices.");
    }
    const quote = chart.indicators.quote[0];
    const candles = chart.timestamp.flatMap((timestamp, index) => {
      const time = number(timestamp);
      const close = Array.isArray(quote.close) ? number(quote.close[index]) : null;
      if (time === null || close === null) return [];
      const optionalNumber = (key: string) => Array.isArray(quote[key]) ? number(quote[key][index]) : null;
      return [{
        t: new Date(time * 1000).toISOString().slice(0, 10),
        o: optionalNumber("open") ?? close,
        h: optionalNumber("high") ?? close,
        l: optionalNumber("low") ?? close,
        c: close,
        v: optionalNumber("volume") ?? 0,
      }];
    });
    if (!candles.length) malformed("Yahoo Finance history", "no daily prices were returned.");
    return { provider: YAHOO_PROVIDER, data: candles };
  });
  if (!result) return {
    status: "unavailable",
    candles: [],
    provider: "none",
    asOf: new Date().toISOString(),
    note: "Yahoo Finance historical data is unavailable; no synthetic history is shown.",
  };
  return {
    status: "live",
    candles: result.data,
    provider: result.provider,
    asOf: result.fetchedAt.toISOString(),
    note: result.provider.includes("(stale)") ? "Showing cached historical data; the latest refresh failed." : "Yahoo Finance daily history; unofficial and may be delayed.",
  };
}
