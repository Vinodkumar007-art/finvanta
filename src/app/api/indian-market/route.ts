import { z } from "zod";
import { apiCtx, json } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import {
  getIndianMarketOverview,
  getIndianStock,
  getIndianStockList,
  getIndianSymbols,
  searchIndianStocks,
} from "@/services/indian-market";

export const dynamic = "force-dynamic";
const symbolSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9&._-]{1,30}$/);
const querySchema = z.string().trim().min(1).max(80).refine((value) => !/[\u0000-\u001f\u007f]/.test(value));

export async function GET(req: Request) {
  const auth = await apiCtx(req);
  if ("error" in auth) return auth.error;
  const limit = rateLimit(`indian-market:${auth.ctx.user.id}`, 60, 60_000);
  if (!limit.ok) return json({ error: `Rate limited. Retry in ${limit.retryAfter}s.` }, 429);

  const params = new URL(req.url).searchParams;
  const action = params.get("action") ?? "overview";
  if (action === "overview") {
    const result = await getIndianMarketOverview();
    return json(result, result.status === "unavailable" ? 503 : 200);
  }
  if (action === "search") {
    const query = querySchema.safeParse(params.get("q"));
    if (!query.success) return json({ error: "Enter a search term between 1 and 80 characters." }, 400);
    const result = await searchIndianStocks(query.data);
    return json(result, result.status === "unavailable" ? 503 : 200);
  }
  if (action === "stock") {
    const symbol = symbolSchema.safeParse(params.get("symbol"));
    if (!symbol.success) return json({ error: "Invalid Indian stock symbol." }, 400);
    const result = await getIndianStock(symbol.data);
    return json(result, result.status === "not-found" ? 404 : result.status === "unavailable" ? 503 : 200);
  }
  if (action === "compare") {
    const raw = params.get("symbols")?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
    if (raw.length < 1 || raw.length > 10) return json({ error: "Compare between 1 and 10 symbols." }, 400);
    const parsed = raw.map((value) => symbolSchema.safeParse(value));
    if (parsed.some((value) => !value.success)) return json({ error: "One or more symbols are invalid." }, 400);
    const symbols = [...new Set(parsed.flatMap((value) => value.success ? [value.data] : []))];
    if (symbols.length !== raw.length) return json({ error: "Duplicate symbols are not allowed." }, 400);
    const result = await getIndianStockList(symbols);
    return json(result, result.status === "unavailable" ? 503 : 200);
  }
  if (action === "symbols") {
    const result = await getIndianSymbols();
    return json(result, result.status === "unavailable" ? 503 : 200);
  }
  return json({ error: "Unknown Indian market action." }, 400);
}
