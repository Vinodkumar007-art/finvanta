import { apiCtx, json } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { getHistory } from "@/services/market";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const a = await apiCtx(req); if ("error" in a) return a.error;
  if (!rateLimit(`hist:${a.ctx.user.id}`, 60, 60_000).ok) return json({ error: "Rate limited" }, 429);
  const symbol = new URL(req.url).searchParams.get("symbol") ?? "";
  if (!/^[A-Za-z0-9.:^=\-&]{1,30}$/.test(symbol)) return json({ status: "unavailable", candles: [], provider: "", asOf: new Date().toISOString(), note: "Invalid symbol" });
  return json(await getHistory(symbol));
}
