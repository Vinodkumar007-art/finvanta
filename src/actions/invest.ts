"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { chartTemplates, portfolioTransactions, portfolios, priceAlerts, priceMarks, savedScreeners, watchlists } from "@/db/schema";
import { assertCan, requireCtx } from "@/lib/ctx";
import { audit } from "@/lib/audit";
import { getQuote } from "@/services/market";
import type { FormState } from "./auth";

const fail = (e: unknown): FormState => ({ error: (e as Error).message });
const SYM = z.string().trim().toUpperCase().regex(/^[A-Z0-9.:^=\-&]{1,30}$/, "Invalid symbol");

export async function createWatchlist(_: FormState, fd: FormData): Promise<FormState> { try { const c = await requireCtx(); const name = z.string().min(1).max(40).parse(fd.get("name")); await db.insert(watchlists).values({ orgId: c.org.id, userId: c.user.id, name }); revalidatePath("/markets"); return { ok: "Watchlist created." }; } catch (e) { return fail(e); } }
export async function addToWatchlist(_: FormState, fd: FormData): Promise<FormState> {
  try { const c = await requireCtx(); const sym = SYM.parse(fd.get("symbol")); const [w] = await db.select().from(watchlists).where(and(eq(watchlists.id, String(fd.get("id"))), eq(watchlists.userId, c.user.id)));
    if (!w) return { error: "Watchlist not found." }; if (w.symbols.includes(sym)) return { error: "Already on the list." };
    await db.update(watchlists).set({ symbols: [...w.symbols, sym] }).where(eq(watchlists.id, w.id)); revalidatePath("/markets"); return { ok: `${sym} added.` }; } catch (e) { return fail(e); }
}
export async function removeFromWatchlist(id: string, sym: string) { const c = await requireCtx(); const [w] = await db.select().from(watchlists).where(and(eq(watchlists.id, id), eq(watchlists.userId, c.user.id))); if (w) await db.update(watchlists).set({ symbols: w.symbols.filter((s) => s !== sym) }).where(eq(watchlists.id, id)); revalidatePath("/markets"); }
export async function createAlert(_: FormState, fd: FormData): Promise<FormState> {
  try { const c = await requireCtx(); const p = z.object({ symbol: SYM, condition: z.enum(["above", "below"]), price: z.coerce.number().positive() }).parse(Object.fromEntries(fd));
    await db.insert(priceAlerts).values({ userId: c.user.id, orgId: c.org.id, symbol: p.symbol, condition: p.condition, price: String(p.price) }); revalidatePath("/markets"); revalidatePath("/charts"); return { ok: "Alert saved. It is evaluated when you press ‘Check alerts’ or open the Markets page (no background push service is running)." }; } catch (e) { return fail(e); }
}
export async function deleteAlert(id: string) { const c = await requireCtx(); await db.delete(priceAlerts).where(and(eq(priceAlerts.id, id), eq(priceAlerts.userId, c.user.id))); revalidatePath("/markets"); revalidatePath("/charts"); }
export async function checkAlerts(): Promise<void> {
  const c = await requireCtx(); const al = await db.select().from(priceAlerts).where(and(eq(priceAlerts.userId, c.user.id), eq(priceAlerts.status, "active")));
  for (const a of al) { const q = await getQuote(a.symbol); if (!q.quote) continue; const hit = a.condition === "above" ? q.quote.price >= Number(a.price) : q.quote.price <= Number(a.price);
    if (hit) { await db.update(priceAlerts).set({ status: "triggered", triggeredAt: new Date() }).where(eq(priceAlerts.id, a.id)); const { notify } = await import("@/lib/audit"); await notify(c.org.id, `Price alert: ${a.symbol} ${a.condition} ${a.price}`, `Last ${q.quote.price} (${q.quote.provider}, ${q.quote.asOf})`, "info", "/markets", c.user.id); } }
  revalidatePath("/markets");
}
export async function saveScreener(name: string, filters: Record<string, string>) { const c = await requireCtx(); if (!name.trim()) throw new Error("Name the screener."); await db.insert(savedScreeners).values({ userId: c.user.id, orgId: c.org.id, name: name.slice(0, 50), filters }); revalidatePath("/markets"); }
export async function deleteScreener(id: string) { const c = await requireCtx(); await db.delete(savedScreeners).where(and(eq(savedScreeners.id, id), eq(savedScreeners.userId, c.user.id))); revalidatePath("/markets"); }
export async function saveChartTemplate(name: string, config: Record<string, unknown>) { const c = await requireCtx(); if (!name.trim()) throw new Error("Name the template."); await db.insert(chartTemplates).values({ userId: c.user.id, orgId: c.org.id, name: name.slice(0, 50), config }); revalidatePath("/charts"); }
export async function deleteChartTemplate(id: string) { const c = await requireCtx(); await db.delete(chartTemplates).where(and(eq(chartTemplates.id, id), eq(chartTemplates.userId, c.user.id))); revalidatePath("/charts"); }

export async function createPortfolio(_: FormState, fd: FormData): Promise<FormState> {
  try { const c = await requireCtx(); assertCan(c, "write"); const p = z.object({ name: z.string().min(2).max(60), type: z.enum(["tracking", "paper"]), benchmark: z.string().max(20).optional() }).parse(Object.fromEntries(fd));
    await db.insert(portfolios).values({ orgId: c.org.id, userId: c.user.id, ...p }); await audit(c, "portfolio.create", "portfolio", p.name); revalidatePath("/portfolio"); return { ok: `${p.type === "paper" ? "Paper (simulated)" : "Tracking"} portfolio created.` }; } catch (e) { return fail(e); }
}
export async function addPortfolioTx(_: FormState, fd: FormData): Promise<FormState> {
  try { const c = await requireCtx(); assertCan(c, "write");
    const p = z.object({ portfolioId: z.string().uuid(), symbol: SYM, name: z.string().max(80).optional(), assetClass: z.enum(["equity", "etf", "mutual_fund", "bond", "other"]), sector: z.string().max(40).optional(), kind: z.enum(["buy", "sell", "dividend"]), date: z.string(), qty: z.coerce.number().min(0), price: z.coerce.number().min(0), fees: z.coerce.number().min(0).default(0) }).parse(Object.fromEntries(fd));
    const [pf] = await db.select().from(portfolios).where(and(eq(portfolios.id, p.portfolioId), eq(portfolios.orgId, c.org.id))); if (!pf) return { error: "Portfolio not found." };
    if (p.kind !== "dividend" && p.qty <= 0) return { error: "Quantity must be positive." };
    await db.insert(portfolioTransactions).values({ ...p, qty: String(p.qty), price: String(p.price), fees: String(p.fees) });
    await audit(c, pf.type === "paper" ? "paper.trade" : "portfolio.tx", "portfolio", pf.id, { symbol: p.symbol, kind: p.kind }); revalidatePath("/portfolio"); return { ok: pf.type === "paper" ? "Simulated order recorded (no real order was sent)." : "Transaction recorded." }; } catch (e) { return fail(e); }
}
export async function deletePortfolioTx(id: string) { const c = await requireCtx(); const [t] = await db.select().from(portfolioTransactions).where(eq(portfolioTransactions.id, id)); if (!t) return; const [pf] = await db.select().from(portfolios).where(and(eq(portfolios.id, t.portfolioId), eq(portfolios.orgId, c.org.id))); if (pf) await db.delete(portfolioTransactions).where(eq(portfolioTransactions.id, id)); revalidatePath("/portfolio"); }
export async function setMark(_: FormState, fd: FormData): Promise<FormState> {
  try { const c = await requireCtx(); const p = z.object({ portfolioId: z.string().uuid(), symbol: SYM, price: z.coerce.number().positive() }).parse(Object.fromEntries(fd));
    const [pf] = await db.select().from(portfolios).where(and(eq(portfolios.id, p.portfolioId), eq(portfolios.orgId, c.org.id))); if (!pf) return { error: "Portfolio not found." };
    await db.insert(priceMarks).values({ portfolioId: p.portfolioId, symbol: p.symbol, price: String(p.price), source: "user-entered" }).onConflictDoUpdate({ target: [priceMarks.portfolioId, priceMarks.symbol], set: { price: String(p.price), source: "user-entered", asOf: new Date() } }); revalidatePath("/portfolio"); return { ok: "Price mark saved (user-entered)." }; } catch (e) { return fail(e); }
}
export async function refreshMarks(portfolioId: string, symbols: string[]) {
  const c = await requireCtx(); const [pf] = await db.select().from(portfolios).where(and(eq(portfolios.id, portfolioId), eq(portfolios.orgId, c.org.id))); if (!pf) return;
  for (const s of symbols.slice(0, 15)) { const q = await getQuote(s); if (q.quote) await db.insert(priceMarks).values({ portfolioId, symbol: s, price: String(q.quote.price), source: q.quote.provider, asOf: new Date(q.quote.asOf) }).onConflictDoUpdate({ target: [priceMarks.portfolioId, priceMarks.symbol], set: { price: String(q.quote.price), source: q.quote.provider, asOf: new Date(q.quote.asOf) } }); }
  revalidatePath("/portfolio");
}
export async function saveTargets(_: FormState, fd: FormData): Promise<FormState> {
  try { const c = await requireCtx(); const id = String(fd.get("portfolioId")); const t: Record<string, number> = {}; for (const k of ["equity", "etf", "mutual_fund", "bond", "other"]) t[k] = Number(fd.get(k) || 0);
    const tot = Object.values(t).reduce((a, b) => a + b, 0); if (Math.abs(tot - 100) > 0.01) return { error: `Targets must total 100% (currently ${tot}%).` };
    await db.update(portfolios).set({ targets: t }).where(and(eq(portfolios.id, id), eq(portfolios.orgId, c.org.id))); revalidatePath("/portfolio"); return { ok: "Targets saved." }; } catch (e) { return fail(e); }
}
