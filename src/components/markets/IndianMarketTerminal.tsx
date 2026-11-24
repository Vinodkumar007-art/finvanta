"use client";
import Link from "next/link";
import { useActionState, useState, type FormEvent } from "react";
import { addToWatchlist } from "@/actions/invest";
import type { FormState } from "@/actions/auth";
import { Badge, Card, Notice } from "@/components/ui";
import { LinesChart } from "@/components/Charts";
import type { IndianSearchResult, IndianStock, IndianStockSummary, IndianSymbol } from "@/services/indian-market";

type WatchlistOption = { id: string; name: string };
type Envelope<T> = { status: "live" | "empty" | "unavailable"; data: T | null; provider: string; fetchedAt?: string; stale?: boolean; note?: string };
type Overview = Envelope<{ message: string | null; version: string | null; features: string[]; exchanges: Record<string, { description: string; suffix: string; example: string; default?: boolean }> }>;
type StockResult = { status: "live" | "not-found" | "unavailable"; stock?: IndianStock & { fetchedAt: string }; provider: string; stale?: boolean; note?: string };
type HistoryResult = { status: "live" | "demo" | "unavailable"; candles: { t: string; c: number }[]; provider: string; asOf: string; note?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = isRecord(body) && typeof body.note === "string" ? body.note
      : isRecord(body) && typeof body.error === "string" ? body.error
        : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  return body as T;
}

function formatNumber(value: number | null, currency?: string | null) {
  if (value === null || !Number.isFinite(value)) return "Unavailable";
  const formatted = value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return currency && /^[A-Z]{3}$/.test(currency) ? `${currency} ${formatted}` : formatted;
}

function formatPercent(value: number | null) {
  return value === null || !Number.isFinite(value) ? "Unavailable" : `${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The request failed.";
}

export default function IndianMarketTerminal({ watchlists }: { watchlists: WatchlistOption[] }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IndianSearchResult[]>([]);
  const [searchNote, setSearchNote] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [exchange, setExchange] = useState<"NSE" | "BSE">("NSE");
  const [stock, setStock] = useState<(IndianStock & { fetchedAt: string }) | null>(null);
  const [stockProvider, setStockProvider] = useState("");
  const [stockBusy, setStockBusy] = useState(false);
  const [stockNote, setStockNote] = useState("");
  const [history, setHistory] = useState<HistoryResult | null>(null);
  const [historyNote, setHistoryNote] = useState("");
  const [compareText, setCompareText] = useState("RELIANCE.NS,TCS.NS,INFY.NS");
  const [comparisons, setComparisons] = useState<IndianStockSummary[]>([]);
  const [compareBusy, setCompareBusy] = useState(false);
  const [compareNote, setCompareNote] = useState("");
  const [symbols, setSymbols] = useState<IndianSymbol[]>([]);
  const [symbolsNote, setSymbolsNote] = useState("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewBusy, setOverviewBusy] = useState(false);
  const [overviewNote, setOverviewNote] = useState("");
  const [watchState, watchAction, watchPending] = useActionState(
    async (state: FormState, formData: FormData) => addToWatchlist(state, formData),
    undefined,
  );

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearchBusy(true);
    setSearchNote("");
    try {
      const response = await getJson<Envelope<IndianSearchResult[]>>(`/api/indian-market?action=search&q=${encodeURIComponent(query)}`);
      setResults(response.data ?? []);
      setSearchNote(response.note ?? (response.stale ? "Showing cached search results." : ""));
    } catch (error) {
      setResults([]);
      setSearchNote(errorMessage(error));
    } finally {
      setSearchBusy(false);
    }
  }

  async function loadStock(symbol: string, selectedExchange: "NSE" | "BSE" = exchange) {
    const canonical = symbol.toUpperCase().replace(/\.(?:NS|BO)$/, "");
    const ticker = `${canonical}.${selectedExchange === "NSE" ? "NS" : "BO"}`;
    setSelectedSymbol(ticker);
    setExchange(selectedExchange);
    setStock(null);
    setStockProvider("");
    setStockNote("");
    setStockBusy(true);
    setHistory(null);
    setHistoryNote("");
    const [stockResult, historyResult] = await Promise.allSettled([
      getJson<StockResult>(`/api/indian-market?action=stock&symbol=${encodeURIComponent(ticker)}`),
      getJson<HistoryResult>(`/api/market/history?symbol=${encodeURIComponent(ticker)}`),
    ]);
    if (stockResult.status === "fulfilled" && stockResult.value.stock) {
      setStock(stockResult.value.stock);
      setStockProvider(stockResult.value.provider);
      setStockNote(stockResult.value.note ?? (stockResult.value.stale ? "Showing cached data; latest refresh failed." : ""));
    } else {
      setStockNote(stockResult.status === "rejected" ? errorMessage(stockResult.reason) : stockResult.value.note ?? "Stock data is unavailable.");
    }
    if (historyResult.status === "fulfilled" && historyResult.value.status === "live") {
      setHistory(historyResult.value);
    } else {
      setHistoryNote(historyResult.status === "fulfilled"
        ? historyResult.value.note ?? "No live historical series is available; synthetic demo prices are not shown here."
        : errorMessage(historyResult.reason));
    }
    setStockBusy(false);
  }

  async function compare(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setCompareBusy(true);
    setCompareNote("");
    try {
      const requested = compareText.split(",").map((symbol) => symbol.trim()).filter(Boolean);
      const response = await getJson<Envelope<IndianStockSummary[]>>(`/api/indian-market?action=compare&symbols=${encodeURIComponent(requested.join(","))}`);
      setComparisons(response.data ?? []);
      setCompareNote(response.note ?? (response.stale ? "Showing cached comparison data." : ""));
    } catch (error) {
      setComparisons([]);
      setCompareNote(errorMessage(error));
    } finally {
      setCompareBusy(false);
    }
  }

  async function loadOverview() {
    setOverviewBusy(true);
    setOverviewNote("");
    try {
      const response = await getJson<Overview>("/api/indian-market?action=overview");
      setOverview(response);
      if (response.status === "unavailable") setOverviewNote(response.note ?? "Provider overview unavailable.");
    } catch (error) {
      setOverview(null);
      setOverviewNote(errorMessage(error));
    } finally {
      setOverviewBusy(false);
    }
  }

  async function loadSymbols() {
    setSymbolsNote("");
    try {
      const response = await getJson<Envelope<IndianSymbol[]>>("/api/indian-market?action=symbols");
      setSymbols(response.data ?? []);
      setSymbolsNote(response.note ?? (response.stale ? "Showing cached symbols." : ""));
    } catch (error) {
      setSymbols([]);
      setSymbolsNote(errorMessage(error));
    }
  }

  const selectedTicker = stock?.ticker ?? selectedSymbol;

  return (
    <div className="space-y-4">
      <Notice tone="info" title="Indian equities · retrieved provider data">
        Search and prices use configured market providers, with Yahoo Finance as a fallback when the Indian API is unavailable. Yahoo data may be delayed and is not an official NSE/BSE exchange feed. Missing fundamentals are shown as unavailable; no demo prices are used in this module.
      </Notice>

      <Card title="Indian market overview" subtitle="Provider status and a small, live comparison of example Indian listings">
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-sm" disabled={overviewBusy} onClick={() => void loadOverview()}>{overviewBusy ? "Checking…" : "Check provider"}</button>
          <button type="button" className="btn btn-sm btn-primary" disabled={compareBusy} onClick={() => void compare()}>{compareBusy ? "Loading…" : "Load example stocks"}</button>
        </div>
        {overviewNote && <p role="status" className="mt-2 text-xs text-warn">{overviewNote}</p>}
        {overview?.data && <div className="mt-3 space-y-2 text-xs">
          <div className="flex flex-wrap items-center gap-2"><Badge tone="up">provider operational</Badge><span>API v{overview.data.version ?? "unknown"}</span><span className="text-muted">{overview.fetchedAt ? `Checked ${overview.fetchedAt}` : ""}</span></div>
          <div className="flex flex-wrap gap-2">{Object.entries(overview.data.exchanges).map(([name, info]) => <span key={name} className="rounded border border-line px-2 py-1">{name} · {info.suffix} · {info.description}</span>)}</div>
        </div>}
        {compareNote && <p role="status" className="mt-3 text-xs text-muted">{compareNote}</p>}
        {comparisons.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{comparisons.map((item) => <button key={item.ticker} type="button" className="rounded-xl border border-line bg-panel2 p-3 text-left hover:border-accent/50" onClick={() => void loadStock(item.ticker, item.exchange)}>
          <div className="flex items-start justify-between gap-2"><span className="font-semibold">{item.companyName ?? item.ticker}</span><Badge>{item.exchange}</Badge></div>
          <div className="num mt-2 text-lg font-semibold">{formatNumber(item.lastPrice)}</div>
          <div className={`num text-xs ${(item.change ?? 0) >= 0 ? "text-up" : "text-down"}`}>{item.change === null ? "Unavailable" : `${formatNumber(item.change)} (${formatPercent(item.percentChange)})`}</div>
          <div className="mt-1 text-[11px] text-muted">Market cap {formatNumber(item.marketCap)} · P/E {formatNumber(item.peRatio)}</div>
        </button>)}</div>}
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Search NSE/BSE stocks" subtitle="Search company names or symbols; choose the exchange for live details">
          <form onSubmit={search} className="flex flex-wrap gap-2">
            <input className="inp min-w-[12rem] flex-1" aria-label="Search Indian stocks" placeholder="RELIANCE, Tata Consultancy…" value={query} onChange={(event) => setQuery(event.target.value)} minLength={1} maxLength={80} required />
            <button className="btn btn-primary" disabled={searchBusy}>{searchBusy ? "Searching…" : "Search"}</button>
          </form>
          {searchNote && <p role="status" className="mt-2 text-xs text-muted">{searchNote}</p>}
          {results.length > 0 && <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
            {results.map((result) => <li key={result.symbol} className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm">
              <span><span className="font-medium">{result.companyName ?? result.symbol}</span><span className="ml-2 text-xs text-muted">{result.symbol}</span></span>
              <span className="flex gap-2"><button type="button" className="btn btn-sm" onClick={() => void loadStock(result.symbol, "NSE")}>NSE</button><button type="button" className="btn btn-sm" onClick={() => void loadStock(result.symbol, "BSE")}>BSE</button></span>
            </li>)}
          </ul>}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-sm" onClick={() => void loadSymbols()}>Browse cached symbols</button>
            {symbols.length > 0 && <span className="text-[11px] text-muted">{symbols.length} symbols</span>}
          </div>
          {symbolsNote && <p role="status" className="mt-2 text-xs text-muted">{symbolsNote}</p>}
          {symbols.length > 0 && <div className="mt-2 flex max-h-40 flex-wrap gap-1 overflow-y-auto">{symbols.slice(0, 100).map((item) => <button key={`${item.searchTerm}-${item.symbol}`} type="button" className="btn btn-sm" onClick={() => void loadStock(item.symbol, "NSE")}>{item.searchTerm} · {item.symbol}</button>)}</div>}
        </Card>

        <Card title={stock ? `${stock.companyName ?? stock.symbol} · ${stock.exchange}` : "Stock details"} subtitle={stock ? `${stock.ticker} · ${stock.lastUpdate ?? `Retrieved ${stock.fetchedAt}`}` : "Select a search result or comparison card"}>
          {stockBusy && <p className="text-sm text-muted">Retrieving current stock details…</p>}
          {stockNote && <p role="status" className="mb-2 text-xs text-warn">{stockNote}</p>}
          {stock && <div className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><div className="text-xs text-muted">Latest available price</div><div className="num text-3xl font-bold">{formatNumber(stock.lastPrice, stock.currency)}</div></div>
              <div className={`num text-sm ${(stock.change ?? 0) >= 0 ? "text-up" : "text-down"}`}>{stock.change === null ? "Unavailable" : `${formatNumber(stock.change, stock.currency)} · ${formatPercent(stock.percentChange)}`}</div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[
                ["Previous close", formatNumber(stock.previousClose, stock.currency)],
                ["Open", formatNumber(stock.open, stock.currency)],
                ["Day high / low", `${formatNumber(stock.dayHigh, stock.currency)} / ${formatNumber(stock.dayLow, stock.currency)}`],
                ["52-week high / low", `${formatNumber(stock.yearHigh, stock.currency)} / ${formatNumber(stock.yearLow, stock.currency)}`],
                ["Volume", formatNumber(stock.volume)],
                ["Market cap", formatNumber(stock.marketCap, stock.currency)],
                ["P/E ratio", formatNumber(stock.peRatio)],
                ["Dividend yield", formatPercent(stock.dividendYield)],
                ["Book value", formatNumber(stock.bookValue, stock.currency)],
                ["Earnings per share", formatNumber(stock.earningsPerShare, stock.currency)],
                ["Sector", stock.sector ?? "Unavailable"],
                ["Industry", stock.industry ?? "Unavailable"],
              ].map(([label, value]) => <div key={label} className="rounded-lg border border-line p-2"><div className="text-[10px] text-muted">{label}</div><div className="mt-1 break-words text-sm font-medium">{value}</div></div>)}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted"><span>Source: {stockProvider}</span><span>Currency: {stock.currency ?? "not reported"}</span><span>Provider timestamp: {stock.lastUpdate ?? "not reported"}</span></div>
            {watchlists.length > 0 ? <form action={watchAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="symbol" value={selectedTicker} />
              <label className="text-xs text-muted">Add to watchlist<select className="inp mt-1 min-w-40" name="id">{watchlists.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <button className="btn btn-sm btn-primary" disabled={watchPending}>{watchPending ? "Adding…" : "Add stock"}</button>
            </form> : <p className="text-xs text-muted">Create a watchlist in <Link className="text-accent underline" href="/markets?tab=watch">Watchlists</Link> to save this stock.</p>}
            {watchState?.error && <p role="alert" className="text-xs text-down">{watchState.error}</p>}
            {watchState?.ok && <p role="status" className="text-xs text-up">{watchState.ok}</p>}
            <Link className="btn btn-sm" href="/ai?agent=indian-equity">Ask the Indian Stock Analyst</Link>
          </div>}
        </Card>
      </div>

      <Card title="Compare Indian stocks" subtitle="Provider returns comparison quotes and basic valuation metrics for up to 10 symbols">
        <form onSubmit={compare} className="flex flex-wrap gap-2">
          <input className="inp min-w-[14rem] flex-1" aria-label="Symbols to compare" value={compareText} onChange={(event) => setCompareText(event.target.value)} placeholder="RELIANCE.NS,TCS.BO,INFY.NS" maxLength={300} required />
          <button className="btn btn-primary" disabled={compareBusy}>{compareBusy ? "Comparing…" : "Compare"}</button>
        </form>
        {compareNote && <p role="status" className="mt-2 text-xs text-muted">{compareNote}</p>}
        {comparisons.length > 0 && <div className="mt-3 overflow-x-auto"><table className="tbl min-w-[42rem]"><thead><tr><th>Company</th><th>Exchange</th><th className="r">Price</th><th className="r">Change</th><th className="r">Volume</th><th className="r">Market cap</th><th className="r">P/E</th></tr></thead><tbody>{comparisons.map((item) => <tr key={item.ticker}><td>{item.companyName ?? item.symbol}</td><td>{item.exchange}</td><td className="r num">{formatNumber(item.lastPrice)}</td><td className="r num">{item.change === null ? "Unavailable" : `${formatNumber(item.change)} (${formatPercent(item.percentChange)})`}</td><td className="r num">{formatNumber(item.volume)}</td><td className="r num">{formatNumber(item.marketCap)}</td><td className="r num">{formatNumber(item.peRatio)}</td></tr>)}</tbody></table></div>}
      </Card>

      {stock && <Card title="Historical chart" subtitle={history?.status === "live" ? `${history.provider} · ${history.asOf}` : "Historical data is not returned by the Indian Market API"}>
        {history ? <LinesChart data={history.candles.map((candle) => ({ date: candle.t, close: candle.c }))} x="date" series={[{ key: "close", name: "Close" }]} height={260} area /> : <p className="text-xs text-muted">{historyNote || "Select a stock to check whether a licensed historical-price provider is configured. Synthetic demo history is not displayed."}</p>}
      </Card>}
    </div>
  );
}
