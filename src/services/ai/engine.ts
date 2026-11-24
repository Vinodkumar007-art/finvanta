import { runTool } from "./tools";
import type { CompanyCtx } from "@/lib/ctx";

const md = (rows: Record<string, unknown>[], cols?: string[]) => {
  if (!rows.length) return "_No rows._";
  const c = cols ?? Object.keys(rows[0]);
  return `| ${c.join(" | ")} |\n| ${c.map(() => "---").join(" | ")} |\n${rows.map((r) => `| ${c.map((k) => String(r[k] ?? "")).join(" | ")} |`).join("\n")}`;
};
const nums = (s: string) => (s.replace(/,/g, "").match(/\d+(?:\.\d+)?/g) ?? []).map(Number);

/**
 * Deterministic "engine mode" used when no LLM provider is configured.
 * It routes recognised requests to the same verified tools and formats their output. It does NOT generate free-form advice.
 */
export async function engineAnswer(text: string, ctx: CompanyCtx, conversationId: string) {
  const t = text.toLowerCase(); const tools: { name: string; source: string; result: unknown; calc?: unknown }[] = [];
  const call = async (n: string, a: Record<string, unknown> = {}) => { const r = await runTool(n, a, ctx, conversationId); tools.push({ name: n, ...r }); return r; };
  let out = "";
  const N = nums(text);
  if (/\bemi\b/.test(t) && N.length >= 3) {
    const [principal, rate, per] = N; const months = /year|yr/.test(t) ? per * 12 : per;
    const r = await call("calc_emi", { principal, annual_rate_percent: rate, months });
    out = `**EMI calculation** [source: calc_emi]\n\n${md(Object.entries(r.result as object).map(([k, v]) => ({ Item: k, Value: v })))}\n\nFormula: EMI = P·r·(1+r)^n / ((1+r)^n − 1).`;
  } else if (/\bgst\b/.test(t) && N.length >= 2) {
    const r = await call("calc_gst", { taxable: N[0], rate_percent: N[1], interstate: /inter|igst|other state/.test(t) });
    out = `**GST calculation** [source: calc_gst]\n\n${md(Object.entries(r.result as object).map(([k, v]) => ({ Item: k, Value: v })))}`;
  } else if (/trial balance/.test(t)) {
    const r = await call("get_trial_balance"); const x = r.result as { balanced: boolean; totalDebit: string; totalCredit: string; rows: Record<string, unknown>[] };
    out = `**Trial balance** — ${x.balanced ? "✅ balanced" : "⚠️ NOT balanced"} (Dr ${x.totalDebit} / Cr ${x.totalCredit}) [source: get_trial_balance]\n\n${md(x.rows)}`;
  } else if (/ratio|liquidity|solvency|margin/.test(t)) {
    const r = await call("get_ratios"); const x = r.result as { ratios: Record<string, unknown>[] };
    out = `**Financial ratios (ledger-derived)** [source: get_ratios]\n\n${md(x.ratios, ["name", "value", "formula", "inputs"])}`;
  } else if (/receivable|ageing|aging|outstanding/.test(t)) {
    const r = await call("get_ageing", { kind: /payable|vendor|bill/.test(t) ? "payables" : "receivables" });
    out = `**Ageing** [source: get_ageing]\n\n${md(r.result as Record<string, unknown>[])}`;
  } else if (/profit|revenue|p&l|income|balance sheet|cash flow|briefing|summary|cash/.test(t)) {
    const r = await call("get_financial_summary"); const x = r.result as { pl: Record<string, string>; balanceSheet: Record<string, unknown>; cashFlow: Record<string, unknown> };
    out = `**Financial summary — ${ctx.fy.label}** [source: get_financial_summary]\n\n**Profit & loss**\n\n${md(Object.entries(x.pl).map(([k, v]) => ({ Item: k, Amount: v })))}\n\n**Balance sheet**\n\n${md(Object.entries(x.balanceSheet).map(([k, v]) => ({ Item: k, Value: String(v) })))}\n\n**Cash flow**\n\n${md(Object.entries(x.cashFlow).map(([k, v]) => ({ Item: k, Value: String(v) })))}`;
  } else {
    out = "I can answer this kind of question in **engine mode** only for: EMI (`EMI for 2500000 at 9.5% over 15 years`), GST (`GST on 100000 at 18%`), trial balance, ratios, ageing, and the financial summary.\n\nFree-form analysis, document summarisation and report writing need a language-model provider. Add `GEMINI_API_KEY`, `OPENAI_API_KEY`, or the Cloudflare AI settings to the server environment to enable the full assistant — nothing is simulated here.";
  }
  return { text: out, tools };
}
