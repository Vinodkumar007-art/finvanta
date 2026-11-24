import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cache: null as { key: string; payload: unknown; provider: string; fetchedAt: Date } | null,
  failureCount: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => state.cache ? [state.cache] : [],
        }),
      }),
    }),
    insert: () => ({
      values: (value: { key?: string; payload?: unknown; provider?: string; fetchedAt?: Date }) => {
        if (value.key && value.provider && value.fetchedAt) state.cache = value as typeof state.cache;
        else state.failureCount++;
        return { onConflictDoUpdate: async () => undefined };
      },
    }),
  },
}));

import {
  getIndianHistory,
  getIndianMarketOverview,
  getIndianStock,
  getIndianStockList,
  getIndianSymbols,
  searchIndianStocks,
} from "@/services/indian-market";
import { getQuote } from "@/services/market";
import { AGENTS } from "@/services/ai/agents";
import { TOOL_DEFS } from "@/services/ai/tools";

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  state.cache = null;
  state.failureCount = 0;
  vi.stubEnv("INDIAN_MARKET_API_BASE_URL", "http://market-api.test");
  vi.stubEnv("FMP_API_KEY", "");
  vi.stubEnv("TWELVE_DATA_API_KEY", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Indian market provider", () => {
  it("uses Yahoo Finance search and quotes when the Indian API URL is not configured", async () => {
    vi.stubEnv("INDIAN_MARKET_API_BASE_URL", "");
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/finance/search") return response({
        quotes: [{ symbol: "TCS.NS", longname: "Tata Consultancy Services", exchange: "NSE" }],
      });
      return response({
        chart: { result: [{
          meta: { symbol: "TCS.NS", regularMarketPrice: 2460, chartPreviousClose: 2406.6, currency: "INR", regularMarketTime: 1795452000 },
          indicators: { quote: [{ close: [2406.6, 2460], open: [2395, 2450], high: [2448, 2470], low: [2384, 2440], volume: [3027101, 1200] }] },
        }] },
      });
    });
    vi.stubGlobal("fetch", fetcher);

    expect((await getIndianMarketOverview()).status).toBe("unavailable");
    const search = await searchIndianStocks("TCS");
    const stock = await getIndianStock("TCS.NS");
    expect(search.status).toBe("live");
    expect(search.data?.[0]).toMatchObject({ symbol: "TCS", companyName: "Tata Consultancy Services" });
    expect(stock.status).toBe("live");
    expect(stock.provider).toContain("Yahoo Finance");
    expect(stock.stock).toMatchObject({ lastPrice: 2460, currency: "INR" });
    expect(stock.stock?.change).toBeCloseTo(53.4, 5);
    expect(stock.stock?.percentChange).toBeCloseTo(2.22, 1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("falls back to the configured Twelve Data search endpoint when the Indian API is unavailable", async () => {
    vi.stubEnv("TWELVE_DATA_API_KEY", "test-key");
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "api.twelvedata.com") {
        return response({ data: [
          { symbol: "TCS", instrument_name: "Tata Consultancy Services Ltd.", exchange: "NSE", mic_code: "XNSE" },
          { symbol: "TCS", instrument_name: "Tata Consultancy Services Ltd.", exchange: "BSE", mic_code: "XBOM" },
        ] });
      }
      return Promise.reject(new Error("Indian API unavailable"));
    });
    vi.stubGlobal("fetch", fetcher);

    const result = await searchIndianStocks("TCS");

    expect(result.status).toBe("live");
    expect(result.provider).toBe("Twelve Data symbol search");
    expect(result.data).toEqual([{
      symbol: "TCS",
      nseTicker: "TCS.NS",
      bseTicker: "TCS.BO",
      companyName: "Tata Consultancy Services Ltd.",
    }]);
  });

  it("parses the provider overview and symbol catalog endpoints", async () => {
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return url.pathname === "/"
        ? response({ status: "operational", message: "Ready", version: "1.0", features: ["search"], exchanges: { NSE: { description: "National Stock Exchange", suffix: ".NS", example: "TCS.NS" } } })
        : response({ status: "success", total_symbols: 1, symbols: [{ search_term: "Tata Consultancy Services", symbol: "TCS", nse_ticker: "TCS.NS", bse_ticker: "TCS.BO" }] });
    });
    vi.stubGlobal("fetch", fetcher);

    const overview = await getIndianMarketOverview();
    state.cache = null;
    const symbols = await getIndianSymbols();

    expect(overview.status).toBe("live");
    expect(overview.data?.exchanges.NSE.suffix).toBe(".NS");
    expect(symbols.status).toBe("live");
    if (symbols.status !== "live") throw new Error("Expected live symbol data.");
    expect(symbols.data[0]).toEqual({
      searchTerm: "Tata Consultancy Services",
      symbol: "TCS",
      nseTicker: "TCS.NS",
      bseTicker: "TCS.BO",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("searches, normalizes symbols and serves a repeated query from cache", async () => {
    const fetcher = vi.fn((_url: RequestInfo | URL) => response({
      status: "success",
      results: [{ symbol: "TCS.NS" }, { symbol: "TCS.BO" }, { symbol: "INFY.NS" }],
    }));
    vi.stubGlobal("fetch", fetcher);

    const first = await searchIndianStocks(" Tata   Consultancy ");
    const second = await searchIndianStocks("tata consultancy");

    expect(first.status).toBe("live");
    expect(first.data).toEqual([
      { symbol: "TCS", nseTicker: "TCS.NS", bseTicker: "TCS.BO" },
      { symbol: "INFY", nseTicker: "INFY.NS", bseTicker: "INFY.BO" },
    ]);
    expect(second.data).toEqual(first.data);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get("q")).toBe("Tata Consultancy");
  });

  it("preserves the provider's no-results message", async () => {
    const fetcher = vi.fn((_url: RequestInfo | URL) => response({ status: "error", message: "No matching symbols" }, 404));
    vi.stubGlobal("fetch", fetcher);

    const result = await searchIndianStocks("unknown");

    expect(result.status).toBe("empty");
    expect(result.note).toBe("No matching symbols");
  });

  it("parses a single stock without inventing missing metrics", async () => {
    const fetcher = vi.fn((_url: RequestInfo | URL) => response({
      symbol: "RELIANCE",
      exchange: "NSE",
      ticker: "RELIANCE.NS",
      data: { company_name: "Reliance Industries", last_price: 1234.5, change: 5.5, percent_change: 0.45, pe_ratio: null },
    }));
    vi.stubGlobal("fetch", fetcher);

    const result = await getIndianStock("reliance.NS");

    expect(result.status).toBe("live");
    expect(result.stock?.lastPrice).toBe(1234.5);
    expect(result.stock?.peRatio).toBeNull();
    expect(result.stock?.exchange).toBe("NSE");
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get("res")).toBe("num");
  });

  it("adapts an Indian quote for existing market consumers", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: RequestInfo | URL) => response({
      symbol: "TCS",
      exchange: "NSE",
      ticker: "TCS.NS",
      data: { last_price: 4000, change: 20, percent_change: 0.5, currency: "INR" },
    })));

    const result = await getQuote("TCS.NS");

    expect(result.status).toBe("live");
    expect(result.quote).toMatchObject({
      symbol: "TCS.NS",
      price: 4000,
      changePct: 0.005,
      provider: "Indian Market API",
    });
  });

  it("compares multiple stocks and preserves missing quotes as null", async () => {
    const fetcher = vi.fn((_url: RequestInfo | URL) => response({
      status: "success",
      stocks: [
        { symbol: "TCS", exchange: "NSE", ticker: "TCS.NS", last_price: 4000, change: 10, percent_change: 0.25, volume: 100 },
        { symbol: "INFY", exchange: "NSE", ticker: "INFY.NS", error: "No quote available" },
      ],
    }));
    vi.stubGlobal("fetch", fetcher);

    const result = await getIndianStockList(["TCS.NS", "INFY.NS"]);

    expect(result.status).toBe("live");
    if (result.status !== "live") throw new Error("Expected live comparison data.");
    expect(result.data.map((item) => [item.symbol, item.lastPrice, item.error])).toEqual([
      ["TCS", 4000, null],
      ["INFY", null, "No quote available"],
    ]);
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get("symbols")).toBe("TCS.NS,INFY.NS");
  });

  it("rejects invalid symbols and search strings before making provider requests", async () => {
    const fetcher = vi.fn((_url: RequestInfo | URL) => response({}));
    vi.stubGlobal("fetch", fetcher);

    expect((await getIndianStock("RELIANCE<script>")).status).toBe("unavailable");
    expect((await getIndianStockList(["TCS.NS", "bad symbol"])).status).toBe("unavailable");
    expect((await searchIndianStocks(" \n ")).status).toBe("unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("retries provider timeouts and reports the failure when no cached data exists", async () => {
    const fetcher = vi.fn((_url: RequestInfo | URL) => Promise.reject(new Error("provider timeout")));
    vi.stubGlobal("fetch", fetcher);

    const result = await getIndianStock("RELIANCE.NS");

    expect(result.status).toBe("unavailable");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(state.failureCount).toBeGreaterThan(0);
  });

  it("rejects malformed stock responses and records the provider failure", async () => {
    const fetcher = vi.fn((_url: RequestInfo | URL) => response({
      status: "success",
      symbol: "RELIANCE",
      exchange: "NSE",
      ticker: "RELIANCE.NS",
      data: { company_name: "Reliance Industries" },
    }));
    vi.stubGlobal("fetch", fetcher);

    const result = await getIndianStock("RELIANCE.NS");

    expect(result.status).toBe("unavailable");
    expect(result.stock).toBeUndefined();
    expect(state.failureCount).toBeGreaterThan(0);
  });

  it("loads real daily Indian history from the Yahoo chart fallback without demo values", async () => {
    const fetcher = vi.fn((_url: RequestInfo | URL) => response({
      chart: { result: [{
        timestamp: [1795302000, 1795388400],
        indicators: { quote: [{ open: [100, 102], high: [105, 106], low: [99, 101], close: [103, 104], volume: [500, 600] }] },
      }] },
    }));
    vi.stubGlobal("fetch", fetcher);

    const history = await getIndianHistory("TCS.NS");

    expect(history.status).toBe("live");
    expect(history.provider).toContain("Yahoo Finance");
    expect(history.candles).toHaveLength(2);
    expect(history.candles[1]).toMatchObject({ o: 102, h: 106, l: 101, c: 104, v: 600 });
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get("range")).toBe("1y");
  });
});

describe("Indian Stock Analyst grounding", () => {
  it("exposes only data-backed Indian market tools and a grounded analyst prompt", () => {
    const names = TOOL_DEFS.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining([
      "search_indian_stocks",
      "get_indian_stock",
      "compare_indian_stocks",
    ]));

    const agent = AGENTS.find((item) => item.id === "indian-equity");
    expect(agent).toBeDefined();
    expect(agent?.prompt).toContain("ONLY search_indian_stocks");
    expect(agent?.prompt).toContain("Retrieved data");
    expect(agent?.prompt).toContain("do not invent");
  });
});
