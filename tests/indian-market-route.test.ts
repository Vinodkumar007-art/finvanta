import { afterEach, describe, expect, it, vi } from "vitest";
import { apiCtx } from "@/lib/http";
import { getIndianStock, searchIndianStocks } from "@/services/indian-market";
import { GET } from "@/app/api/indian-market/route";

vi.mock("@/lib/http", () => ({
  apiCtx: vi.fn(),
  json: (body: unknown, status = 200) => Response.json(body, { status }),
}));
vi.mock("@/lib/ratelimit", () => ({ rateLimit: () => ({ ok: true }) }));
vi.mock("@/services/indian-market", () => ({
  getIndianMarketOverview: vi.fn(),
  getIndianStock: vi.fn(),
  getIndianStockList: vi.fn(),
  getIndianSymbols: vi.fn(),
  searchIndianStocks: vi.fn(),
}));

afterEach(() => vi.restoreAllMocks());

describe("Indian market API authorization", () => {
  it("returns the authentication response without querying provider data", async () => {
    const denied = Response.json({ error: "Not authenticated." }, { status: 401 });
    vi.mocked(apiCtx).mockResolvedValue({ error: denied });

    const response = await GET(new Request("http://app.test/api/indian-market?action=search&q=TCS"));

    if (!response) throw new Error("Expected an authentication response.");
    expect(response.status).toBe(401);
    expect(searchIndianStocks).not.toHaveBeenCalled();
  });

  it("validates action inputs and forwards valid stock lookups", async () => {
    vi.mocked(apiCtx).mockResolvedValue({
      ctx: {
        user: { id: "user-1" },
      },
    } as never);
    vi.mocked(getIndianStock).mockResolvedValue({
      status: "live",
      provider: "Indian Market API",
      stock: {
        symbol: "TCS",
        ticker: "TCS.NS",
        exchange: "NSE",
        companyName: "Tata Consultancy Services",
        lastPrice: 4000,
        change: 20,
        percentChange: 0.5,
        previousClose: 3980,
        open: 3990,
        dayHigh: 4020,
        dayLow: 3970,
        yearHigh: 4500,
        yearLow: 3200,
        volume: 1000,
        marketCap: 100000,
        peRatio: 30,
        dividendYield: 1.2,
        bookValue: 200,
        earningsPerShare: 130,
        sector: "Technology",
        industry: "IT Services",
        currency: "INR",
        lastUpdate: null,
        fetchedAt: "2026-11-23T12:00:00.000Z",
      },
    });

    const valid = await GET(new Request("http://app.test/api/indian-market?action=stock&symbol=tcs.ns"));
    if (!valid) throw new Error("Expected a valid stock response.");
    expect(valid.status).toBe(200);
    expect(getIndianStock).toHaveBeenCalledWith("TCS.NS");

    const invalid = await GET(new Request("http://app.test/api/indian-market?action=stock&symbol=bad%20symbol"));
    if (!invalid) throw new Error("Expected an invalid stock response.");
    expect(invalid.status).toBe(400);
  });
});
