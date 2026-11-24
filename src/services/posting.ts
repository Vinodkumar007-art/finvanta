import { and, eq, isNull, like } from "drizzle-orm";
import { db } from "@/db";
import { financialYears, vouchers, voucherLines, accounts } from "@/db/schema";
import { D, r2 } from "@/engines/core";
import { nextVoucherNumber, validateVoucher, VOUCHER_PREFIX } from "@/engines/accounting";
import { audit } from "@/lib/audit";

export type PostLine = { accountId: string; debit: string | number; credit: string | number; costCentreId?: string | null; partyId?: string | null; narration?: string };
export type PostInput = {
  type: string; date: string; narration: string; lines: PostLine[]; source?: string; currency?: string; fxRate?: string | number; reversalOf?: string;
};
type Actor = { org: { id: string }; user: { id: string }; company: { id: string } };

/** Single chokepoint for ledger posting: validates double entry, checks FY/period lock, numbers the voucher, writes audit. */
export async function postVoucher(ctx: Actor, input: PostInput, txOverride?: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
  const run = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error("Invalid voucher date.");
    const fxRate = D(input.fxRate ?? 1);
    if (fxRate.lte(0)) throw new Error("Exchange rate must be positive.");
    // convert to base currency at the voucher rate; push rounding residue onto the largest line
    let lines = input.lines.map((l) => ({ ...l, debit: r2(D(l.debit).mul(fxRate)), credit: r2(D(l.credit).mul(fxRate)) }));
    const check0 = validateVoucher(input.lines);
    if (!check0.ok) throw new Error(check0.errors.join(" "));
    const diff = lines.reduce((s, l) => s.plus(l.debit).minus(l.credit), D(0));
    if (!diff.isZero()) {
      const idx = lines.reduce((m, l, i) => (D(l.debit).plus(l.credit).gt(D(lines[m].debit).plus(lines[m].credit)) ? i : m), 0);
      const l = lines[idx];
      if (D(l.debit).gt(0)) l.debit = r2(D(l.debit).minus(diff)); else l.credit = r2(D(l.credit).plus(diff));
    }
    const final = validateVoucher(lines.map((l) => ({ accountId: l.accountId, debit: l.debit.toString(), credit: l.credit.toString() })));
    if (!final.ok) throw new Error(final.errors.join(" "));

    const [fy] = await tx.select().from(financialYears).where(and(eq(financialYears.companyId, ctx.company.id)))
      .then((rows) => rows.filter((f) => f.startDate <= input.date && f.endDate >= input.date));
    if (!fy) throw new Error(`No financial year covers ${input.date}. Create the financial year first.`);
    if (fy.status === "closed") throw new Error(`${fy.label} is closed (period locked). Reopen or post in an open period.`);

    const accIds = [...new Set(lines.map((l) => l.accountId))];
    const found = await tx.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.companyId, ctx.company.id), isNull(accounts.deletedAt)));
    const okIds = new Set(found.map((a) => a.id));
    if (accIds.some((a) => !okIds.has(a))) throw new Error("One or more accounts do not belong to this company.");

    const prefix = VOUCHER_PREFIX[input.type] ?? "VC";
    for (let attempt = 0; attempt < 4; attempt++) {
      const existing = await tx.select({ n: vouchers.number }).from(vouchers)
        .where(and(eq(vouchers.companyId, ctx.company.id), eq(vouchers.fyId, fy.id), like(vouchers.number, `${prefix}-%`)));
      const number = nextVoucherNumber(input.type, existing.map((e) => e.n));
      try {
        const [v] = await tx.insert(vouchers).values({
          companyId: ctx.company.id, fyId: fy.id, type: input.type, number, date: input.date, narration: input.narration,
          currency: input.currency ?? "INR", fxRate: fxRate.toString(), source: input.source ?? "manual", createdBy: ctx.user.id, reversalOf: input.reversalOf,
        }).returning();
        await tx.insert(voucherLines).values(lines.map((l) => ({
          voucherId: v.id, accountId: l.accountId, debit: l.debit.toFixed(2), credit: l.credit.toFixed(2),
          costCentreId: l.costCentreId || null, partyId: l.partyId || null, narration: l.narration,
        })));
        return v;
      } catch (e) {
        if (attempt === 3 || !String((e as Error).message).includes("vouchers_number_uq")) throw e;
      }
    }
    throw new Error("Could not allocate a voucher number.");
  };
  const v = txOverride ? await run(txOverride) : await db.transaction(run);
  await audit(ctx, "voucher.post", "voucher", v.id, { number: v.number, type: v.type, date: v.date, source: input.source ?? "manual" }, txOverride);
  return v;
}

export async function accountByRole(companyId: string, role: string) {
  const [a] = await db.select().from(accounts).where(and(eq(accounts.companyId, companyId), eq(accounts.role, role), isNull(accounts.deletedAt))).limit(1);
  return a;
}
