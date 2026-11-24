"use server";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { budgetLines, budgets, financialStatements, kpis, models, scheduledReports, accounts } from "@/db/schema";
import { assertCan, requireCompany } from "@/lib/ctx";
import { audit } from "@/lib/audit";
import { loadStatements, stmtFromLedger } from "@/services/finance";
import type { FormState } from "./auth";

const fail = (e: unknown): FormState => ({ error: (e as Error).message });

export async function saveStatement(label: string, periodEnd: string, kind: string, data: Record<string, number>) {
  const ctx = await requireCompany(); assertCan(ctx, "write");
  const clean: Record<string, number> = {}; for (const [k, v] of Object.entries(data)) if (/^[a-zA-Z]{2,20}$/.test(k) && Number.isFinite(Number(v))) clean[k] = Number(v);
  if (!label.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) throw new Error("Label and a valid period-end date are required.");
  await db.insert(financialStatements).values({ companyId: ctx.company.id, label: label.slice(0, 60), kind, periodEnd, data: clean, source: "manual" });
  await audit(ctx, "statement.save", "financial_statement", label); revalidatePath("/analysis"); revalidatePath("/credit");
}
export async function snapshotLedgerStatement(): Promise<void> {
  const ctx = await requireCompany(); assertCan(ctx, "write");
  const st = stmtFromLedger(await loadStatements(ctx));
  await db.insert(financialStatements).values({ companyId: ctx.company.id, label: `${ctx.fy.label} (ledger snapshot)`, kind: "annual", periodEnd: ctx.fy.endDate, data: st, source: "ledger" });
  await audit(ctx, "statement.snapshot", "financial_statement", ctx.fy.label); revalidatePath("/analysis");
}
export async function deleteStatement(id: string) {
  const ctx = await requireCompany(); assertCan(ctx, "approve");
  await db.delete(financialStatements).where(and(eq(financialStatements.id, id), eq(financialStatements.companyId, ctx.company.id))); revalidatePath("/analysis");
}

export async function saveModel(type: string, name: string, assumptions: Record<string, unknown>, outputs: Record<string, unknown> = {}) {
  const ctx = await requireCompany(); assertCan(ctx, "write");
  if (!name.trim()) throw new Error("Name the model.");
  const size = JSON.stringify(assumptions).length + JSON.stringify(outputs).length; if (size > 200_000) throw new Error("Model too large.");
  const [m] = await db.insert(models).values({ companyId: ctx.company.id, name: name.slice(0, 80), type: z.string().max(20).parse(type), assumptions, outputs, createdBy: ctx.user.id }).returning();
  await audit(ctx, "model.save", "model", m.id, { type, name }); revalidatePath("/modelling"); revalidatePath("/credit"); revalidatePath("/fpna"); return m.id;
}
export async function deleteModel(id: string) {
  const ctx = await requireCompany(); assertCan(ctx, "write");
  await db.update(models).set({ deletedAt: new Date() }).where(and(eq(models.id, id), eq(models.companyId, ctx.company.id), isNull(models.deletedAt)));
  revalidatePath("/modelling"); revalidatePath("/credit"); revalidatePath("/fpna");
}

export async function createBudget(name: string, kind: string, department: string, lines: { accountId: string; amounts: string[] }[]) {
  const ctx = await requireCompany(); assertCan(ctx, "write");
  if (!name.trim() || !lines.length) throw new Error("Name the budget and add at least one line.");
  const accs = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.companyId, ctx.company.id)); const ok = new Set(accs.map((a) => a.id));
  const [b] = await db.insert(budgets).values({ companyId: ctx.company.id, fyId: ctx.fy.id, name: name.slice(0, 80), kind, department: department || null }).returning();
  for (const l of lines) { if (!ok.has(l.accountId) || l.amounts.length !== 12 || l.amounts.some((x) => isNaN(Number(x)) || Number(x) < 0)) throw new Error("Invalid budget line."); await db.insert(budgetLines).values({ budgetId: b.id, accountId: l.accountId, amounts: l.amounts.map((x) => Number(x).toFixed(2)) }); }
  await audit(ctx, "budget.create", "budget", b.id, { name }); revalidatePath("/fpna"); return b.id;
}
export async function budgetWorkflow(id: string, to: "submitted" | "approved" | "rejected") {
  const ctx = await requireCompany(); assertCan(ctx, to === "submitted" ? "write" : "approve");
  const [b] = await db.select().from(budgets).where(and(eq(budgets.id, id), eq(budgets.companyId, ctx.company.id))); if (!b) throw new Error("Budget not found.");
  const allowed: Record<string, string[]> = { submitted: ["draft", "rejected"], approved: ["submitted"], rejected: ["submitted"] };
  if (!allowed[to].includes(b.status)) throw new Error(`Cannot move a ${b.status} budget to ${to}.`);
  await db.update(budgets).set(to === "submitted" ? { status: to, submittedBy: ctx.user.id } : { status: to, approvedBy: ctx.user.id }).where(eq(budgets.id, id));
  await audit(ctx, `budget.${to}`, "budget", id, { selfApproval: b.submittedBy === ctx.user.id }); revalidatePath("/fpna"); revalidatePath("/dashboard");
}
export async function saveKpi(_: FormState, fd: FormData): Promise<FormState> {
  try { const ctx = await requireCompany(); assertCan(ctx, "write");
    const p = z.object({ name: z.string().min(2).max(60), formula: z.string().min(1).max(200), target: z.string().optional(), unit: z.string().max(8).default(""), direction: z.enum(["higher", "lower"]) }).parse(Object.fromEntries(fd));
    await db.insert(kpis).values({ companyId: ctx.company.id, name: p.name, formula: p.formula, target: p.target || null, unit: p.unit, direction: p.direction }); revalidatePath("/fpna"); revalidatePath("/mis"); return { ok: "KPI saved." }; } catch (e) { return fail(e); }
}
export async function deleteKpi(id: string) { const ctx = await requireCompany(); assertCan(ctx, "write"); await db.delete(kpis).where(and(eq(kpis.id, id), eq(kpis.companyId, ctx.company.id))); revalidatePath("/fpna"); revalidatePath("/mis"); }
export async function scheduleReport(_: FormState, fd: FormData): Promise<FormState> {
  try { const ctx = await requireCompany(); assertCan(ctx, "write");
    const p = z.object({ name: z.string().min(2).max(60), report: z.string(), frequency: z.string(), format: z.string() }).parse(Object.fromEntries(fd));
    await db.insert(scheduledReports).values({ companyId: ctx.company.id, ...p }); revalidatePath("/mis"); return { ok: "Schedule saved. Delivery requires a cron/email provider; use ‘Run now’ to generate on demand." }; } catch (e) { return fail(e); }
}
