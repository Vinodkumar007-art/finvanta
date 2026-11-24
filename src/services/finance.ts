import { and, asc, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { invoices, parties, vouchers, voucherLines, accounts, financialStatements } from "@/db/schema";
import { ageingBucket, balanceSheet, cashFlow, profitAndLoss, trialBalance, type AccBal } from "@/engines/accounting";
import type { Stmt } from "@/engines/ratios";
import { D } from "@/engines/core";

type CF = { company: { id: string }; fy: { startDate: string; endDate: string; id: string } };

export async function getBalances(ctx: CF): Promise<AccBal[]> {
  const { startDate: s, endDate: e } = ctx.fy;
  const res = await db.execute(sql`
    select a.id, a.code, a.name, a.type, a.role, a.group_name as "groupName",
      (a.opening_balance + coalesce(sum(case when v.date < ${s}::date then l.debit - l.credit end), 0))::text as prior,
      coalesce(sum(case when v.date between ${s}::date and ${e}::date then l.debit end), 0)::text as dr,
      coalesce(sum(case when v.date between ${s}::date and ${e}::date then l.credit end), 0)::text as cr
    from accounts a
    left join voucher_lines l on l.account_id = a.id
    left join vouchers v on v.id = l.voucher_id and v.deleted_at is null
    where a.company_id = ${ctx.company.id} and a.deleted_at is null
    group by a.id order by a.code`);
  return res.rows as unknown as AccBal[];
}

export async function loadStatements(ctx: CF) {
  const bals = await getBalances(ctx);
  return { bals, tb: trialBalance(bals), pl: profitAndLoss(bals), bs: balanceSheet(bals), cf: cashFlow(bals) };
}

export async function monthlySeries(ctx: CF) {
  const res = await db.execute(sql`
    select to_char(v.date, 'YYYY-MM') as m, a.type, a.role, coalesce(sum(l.debit),0)::text as dr, coalesce(sum(l.credit),0)::text as cr
    from voucher_lines l join vouchers v on v.id = l.voucher_id and v.deleted_at is null
    join accounts a on a.id = l.account_id
    where v.company_id = ${ctx.company.id} and v.date between ${ctx.fy.startDate}::date and ${ctx.fy.endDate}::date
      and a.type in ('income','expense')
    group by 1, 2, 3 order by 1`);
  const start = new Date(ctx.fy.startDate + "T00:00:00Z");
  const months: { key: string; label: string; revenue: number; expense: number; profit: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    months.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleString("en", { month: "short", timeZone: "UTC" }), revenue: 0, expense: 0, profit: 0 });
  }
  for (const r of res.rows as { m: string; type: string; dr: string; cr: string }[]) {
    const m = months.find((x) => x.key === r.m); if (!m) continue;
    if (r.type === "income") m.revenue += Number(D(r.cr).minus(r.dr)); else m.expense += Number(D(r.dr).minus(r.cr));
  }
  months.forEach((m) => (m.profit = m.revenue - m.expense));
  return months;
}

/** Map ledger-derived statements to the analysis schema (Stmt). */
export function stmtFromLedger(x: Awaited<ReturnType<typeof loadStatements>>): Stmt {
  const { pl, bs, cf } = x; const n = (v: { toNumber(): number }) => v.toNumber();
  return {
    revenue: n(pl.revenue), cogs: n(pl.cogs), opex: n(pl.opex), depreciation: n(pl.depreciation), otherIncome: n(pl.otherIncome), interest: n(pl.interest), tax: n(pl.tax),
    cash: n(bs.cash), receivables: n(bs.receivables), inventory: n(bs.inventory), otherCA: n(bs.otherCA.plus(bs.gstInput)), fixedAssets: n(bs.netFixed), otherNCA: n(bs.otherAssets),
    payables: n(bs.payables), otherCL: n(bs.otherCL.plus(bs.gstOutput).plus(bs.tdsPayable)), shortDebt: n(bs.shortDebt), longDebt: n(bs.longDebt), otherNCL: 0,
    equity: n(bs.equity), retained: n(bs.retained.plus(bs.currentPL)), cfo: n(cf.operating), capex: Math.max(0, -n(cf.investing)), dividends: 0, shares: 0, price: 0,
  };
}

export async function savedStatements(companyId: string) {
  return db.select().from(financialStatements).where(eq(financialStatements.companyId, companyId)).orderBy(asc(financialStatements.periodEnd));
}

export async function invoiceRows(ctx: CF, kind: "sales" | "purchase") {
  const rows = await db.select({ inv: invoices, party: parties }).from(invoices).innerJoin(parties, eq(parties.id, invoices.partyId))
    .where(and(eq(invoices.companyId, ctx.company.id), eq(invoices.kind, kind), isNull(invoices.deletedAt), ne(invoices.status, "cancelled"), gte(invoices.date, ctx.fy.startDate), lte(invoices.date, ctx.fy.endDate)))
    .orderBy(asc(invoices.date));
  return rows;
}

export async function ageing(ctx: { company: { id: string } }, kind: "sales" | "purchase", asOf: string) {
  const rows = await db.select({ inv: invoices, party: parties }).from(invoices).innerJoin(parties, eq(parties.id, invoices.partyId))
    .where(and(eq(invoices.companyId, ctx.company.id), eq(invoices.kind, kind), isNull(invoices.deletedAt), sql`${invoices.status} in ('approved','partially_paid')`));
  const byParty = new Map<string, { party: string; buckets: Record<string, number>; total: number }>();
  for (const { inv, party } of rows) {
    const out = D(inv.total).minus(inv.paid); if (out.lte(0)) continue;
    const b = ageingBucket(inv.dueDate, asOf);
    const e = byParty.get(party.id) ?? { party: party.name, buckets: { "Not due": 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 }, total: 0 };
    e.buckets[b] += out.toNumber(); e.total += out.toNumber(); byParty.set(party.id, e);
  }
  return [...byParty.values()].sort((a, b) => b.total - a.total);
}

export async function ledgerStatement(ctx: CF, accountId: string) {
  const [acc] = await db.select().from(accounts).where(and(eq(accounts.id, accountId), eq(accounts.companyId, ctx.company.id)));
  if (!acc) return null;
  const prior = await db.execute(sql`select coalesce(sum(l.debit - l.credit),0)::text as net from voucher_lines l join vouchers v on v.id=l.voucher_id and v.deleted_at is null
    where l.account_id=${accountId} and v.date < ${ctx.fy.startDate}::date`);
  const plAcct = acc.type === "income" || acc.type === "expense";
  const opening = plAcct ? D(0) : D(acc.openingBalance).plus((prior.rows[0] as { net: string }).net);
  const lines = await db.select({ date: vouchers.date, number: vouchers.number, type: vouchers.type, narration: vouchers.narration, debit: voucherLines.debit, credit: voucherLines.credit })
    .from(voucherLines).innerJoin(vouchers, and(eq(vouchers.id, voucherLines.voucherId), isNull(vouchers.deletedAt)))
    .where(and(eq(voucherLines.accountId, accountId), gte(vouchers.date, ctx.fy.startDate), lte(vouchers.date, ctx.fy.endDate)))
    .orderBy(asc(vouchers.date), asc(vouchers.number));
  let run = opening;
  const rows = lines.map((l) => { run = run.plus(l.debit).minus(l.credit); return { ...l, balance: run }; });
  return { account: acc, opening, rows, closing: run };
}
