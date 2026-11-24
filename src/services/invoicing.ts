import { and, count, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { companies, invoices, parties, payments, type InvoiceItem } from "@/db/schema";
import { D, r2 } from "@/engines/core";
import { invoiceTotals } from "@/engines/tax";
import { accountByRole, postVoucher, type PostLine } from "./posting";
import { audit } from "@/lib/audit";
import { postInvoiceInventory, validateInventoryLinks } from "./inventory";

type Actor = { org: { id: string }; user: { id: string }; company: { id: string; stateCode: string } };

export async function createInvoice(ctx: Actor, i: { kind: "sales" | "purchase"; partyId: string; date: string; dueDate: string; placeOfSupply?: string; items: InvoiceItem[]; notes?: string; number?: string; fyId: string }) {
  await validateInventoryLinks(ctx.company.id, i.items);
  const [party] = await db.select().from(parties).where(and(eq(parties.id, i.partyId), eq(parties.companyId, ctx.company.id)));
  if (!party) throw new Error("Party not found in this company.");
  if (!i.items.length || i.items.some((x) => !x.description || x.qty <= 0 || D(x.rate).lt(0))) throw new Error("Each line needs a description, positive quantity and non-negative rate.");
  const [co] = await db.select().from(companies).where(eq(companies.id, ctx.company.id));
  const pos = i.kind === "sales" ? (i.placeOfSupply || party.stateCode) : co.stateCode;
  const supplierState = i.kind === "sales" ? co.stateCode : party.stateCode;
  const t = invoiceTotals(i.items.map((x) => ({ qty: x.qty, rate: x.rate, gstRate: x.gstRate })), supplierState, i.kind === "sales" ? pos : co.stateCode);
  const [{ n }] = await db.select({ n: count() }).from(invoices).where(and(eq(invoices.companyId, ctx.company.id), eq(invoices.kind, i.kind), eq(invoices.fyId, i.fyId)));
  const number = i.number || `${i.kind === "sales" ? "INV" : "BILL"}-${String(Number(n) + 1).padStart(4, "0")}`;
  const [inv] = await db.insert(invoices).values({
    companyId: ctx.company.id, fyId: i.fyId, kind: i.kind, number, partyId: i.partyId, date: i.date, dueDate: i.dueDate, placeOfSupply: pos,
    items: i.items, taxable: t.taxable.toFixed(2), cgst: t.cgst.toFixed(2), sgst: t.sgst.toFixed(2), igst: t.igst.toFixed(2), total: t.total.toFixed(2),
    paid: "0", status: "pending_approval", notes: i.notes, createdBy: ctx.user.id,
  }).returning();
  await audit(ctx, "invoice.create", "invoice", inv.id, { number, total: inv.total });
  return inv;
}

export async function approveInvoice(ctx: Actor, id: string) {
  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invoices)
      .where(and(eq(invoices.id, id), eq(invoices.companyId, ctx.company.id), isNull(invoices.deletedAt)))
      .for("update");
    if (!inv) throw new Error("Invoice not found.");
    if (inv.status !== "pending_approval") throw new Error("Invoice is not awaiting approval.");
    if (inv.kind !== "sales" && inv.kind !== "purchase") throw new Error("Invoice kind is invalid.");

    const inventoryAmounts = await postInvoiceInventory(tx, {
      companyId: ctx.company.id,
      kind: inv.kind,
      number: inv.number,
      date: inv.date,
      items: inv.items,
    });

    const co = ctx.company.id;
    const a = async (r: string) => { const x = await accountByRole(co, r); if (!x) throw new Error(`Chart of accounts is missing the '${r}' ledger.`); return x.id; };
    const lines: PostLine[] = [];
    const taxLines = async (side: "debit" | "credit", prefix: "input" | "output") => {
      for (const [k, v] of [["cgst", inv.cgst], ["sgst", inv.sgst], ["igst", inv.igst]] as const) {
        if (D(v).gt(0)) lines.push({ accountId: await a(`${prefix}_${k}`), debit: side === "debit" ? v : 0, credit: side === "credit" ? v : 0, partyId: inv.partyId });
      }
    };
    if (inv.kind === "sales") {
      lines.push({ accountId: await a("ar"), debit: inv.total, credit: 0, partyId: inv.partyId });
      lines.push({ accountId: await a("sales"), debit: 0, credit: inv.taxable });
      await taxLines("credit", "output");
      if (D(inventoryAmounts.costOfGoodsSold).gt(0)) {
        lines.push({ accountId: await a("cogs"), debit: inventoryAmounts.costOfGoodsSold, credit: 0 });
        lines.push({ accountId: await a("inventory"), debit: 0, credit: inventoryAmounts.costOfGoodsSold });
      }
    } else {
      const inventoryPurchaseCost = D(inventoryAmounts.inventoryPurchaseCost);
      const nonInventoryCost = D(inv.taxable).minus(inventoryPurchaseCost);
      if (inventoryPurchaseCost.gt(0)) lines.push({ accountId: await a("inventory"), debit: inventoryPurchaseCost.toFixed(2), credit: 0 });
      if (nonInventoryCost.gt(0)) lines.push({ accountId: await a("cogs"), debit: nonInventoryCost.toFixed(2), credit: 0 });
      await taxLines("debit", "input");
      lines.push({ accountId: await a("ap"), debit: 0, credit: inv.total, partyId: inv.partyId });
    }

    const voucher = await postVoucher(ctx, {
      type: inv.kind === "sales" ? "sales" : "purchase",
      date: inv.date,
      narration: `${inv.kind === "sales" ? "Sales" : "Purchase"} invoice ${inv.number}`,
      lines,
      source: "invoice",
    }, tx);
    await tx.update(invoices).set({ status: "approved", voucherId: voucher.id, approvedBy: ctx.user.id }).where(eq(invoices.id, id));
    await audit(ctx, "invoice.approve", "invoice", id, { voucher: voucher.number }, tx);
    return voucher;
  });
}

export async function recordPayment(ctx: Actor, p: { invoiceId: string; amount: string; date: string; mode: string; reference?: string }) {
  const [inv] = await db.select().from(invoices).where(and(eq(invoices.id, p.invoiceId), eq(invoices.companyId, ctx.company.id)));
  if (!inv) throw new Error("Invoice not found.");
  if (!["approved", "partially_paid"].includes(inv.status)) throw new Error("Only approved invoices can receive payments.");
  const amt = r2(p.amount); const out = D(inv.total).minus(inv.paid);
  if (amt.lte(0)) throw new Error("Amount must be positive.");
  if (amt.gt(out)) throw new Error(`Amount exceeds outstanding balance of ${out.toFixed(2)}.`);
  const cashRole = p.mode === "cash" ? "cash" : "bank";
  const cash = await accountByRole(ctx.company.id, cashRole); const ctl = await accountByRole(ctx.company.id, inv.kind === "sales" ? "ar" : "ap");
  if (!cash || !ctl) throw new Error("Required ledgers missing.");
  const lines: PostLine[] = inv.kind === "sales"
    ? [{ accountId: cash.id, debit: amt.toFixed(2), credit: 0 }, { accountId: ctl.id, debit: 0, credit: amt.toFixed(2), partyId: inv.partyId }]
    : [{ accountId: ctl.id, debit: amt.toFixed(2), credit: 0, partyId: inv.partyId }, { accountId: cash.id, debit: 0, credit: amt.toFixed(2) }];
  const v = await postVoucher(ctx, { type: inv.kind === "sales" ? "receipt" : "payment", date: p.date, narration: `${inv.kind === "sales" ? "Receipt" : "Payment"} against ${inv.number}${p.reference ? ` (${p.reference})` : ""}`, lines, source: "payment" });
  const paid = D(inv.paid).plus(amt);
  await db.insert(payments).values({ companyId: ctx.company.id, invoiceId: inv.id, kind: inv.kind === "sales" ? "receipt" : "payment", amount: amt.toFixed(2), date: p.date, mode: p.mode, reference: p.reference, voucherId: v.id });
  await db.update(invoices).set({ paid: paid.toFixed(2), status: paid.gte(inv.total) ? "paid" : "partially_paid" }).where(eq(invoices.id, inv.id));
  await audit(ctx, "payment.record", "invoice", inv.id, { amount: amt.toFixed(2), voucher: v.number });
  return v;
}
