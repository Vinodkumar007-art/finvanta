import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { companies, accounts, bankAccounts, bankTransactions, budgetLines, budgets, financialStatements, financialYears, fixedAssets, inventoryItems, inventoryMovements, parties, kpis, costCentres } from "@/db/schema";
import { sha256 } from "@/lib/auth";
import { accountByRole, postVoucher } from "./posting";
import { approveInvoice, createInvoice, recordPayment } from "./invoicing";

type Actor = { org: { id: string }; user: { id: string }; company: { id: string; stateCode: string } };

/** Seeds clearly-labelled DEMO records ("[DEMO]") through the same posting engine real data uses. */
export async function seedDemoData(ctx: Actor, companyId: string) {
  const [fy] = await db.select().from(financialYears).where(eq(financialYears.companyId, companyId)).limit(1);
  const [co] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  const actor = { ...ctx, company: { id: companyId, stateCode: co.stateCode } };
  const acc = async (role: string) => (await accountByRole(companyId, role))!.id;
  const byCode = async (code: string) => (await db.select().from(accounts).where(and(eq(accounts.companyId, companyId), eq(accounts.code, code))))[0].id;

  // Opening balances (sum to zero)
  const open: Record<string, string> = { bank: "2500000", cash: "50000", inventory: "400000", ar: "0", fixed_asset: "1800000", accum_dep: "-300000", capital: "-3000000", loan: "-1200000", ap: "0", reserves: "-250000" };
  for (const [role, bal] of Object.entries(open)) await db.update(accounts).set({ openingBalance: bal }).where(and(eq(accounts.companyId, companyId), eq(accounts.role, role)));

  const cust = await db.insert(parties).values([
    { companyId, kind: "customer", name: "[DEMO] Orion Retail Pvt Ltd", gstin: "27AAPFU0939F1ZV", pan: "AAPFU0939F", stateCode: "27", creditLimit: "1500000", creditDays: 30, email: "ap@orion.example" },
    { companyId, kind: "customer", name: "[DEMO] Vega Industries Ltd", stateCode: "29", creditLimit: "2500000", creditDays: 45, email: "accounts@vega.example" },
    { companyId, kind: "customer", name: "[DEMO] Lyra Services LLP", stateCode: "27", creditLimit: "800000", creditDays: 15 },
  ]).returning();
  const vend = await db.insert(parties).values([
    { companyId, kind: "vendor", name: "[DEMO] Atlas Components", stateCode: "27", creditDays: 30, pan: "AAACA1234A", deducteeType: "company" },
    { companyId, kind: "vendor", name: "[DEMO] Nimbus Logistics", stateCode: "24", creditDays: 20, pan: "AAACN4321B", deducteeType: "company" },
    { companyId, kind: "vendor", name: "[DEMO] R. Sharma & Associates", stateCode: "27", creditDays: 15, pan: "ABCPS1234D", deducteeType: "individual" },
  ]).returning();
  await db.insert(costCentres).values([{ companyId, name: "Sales", category: "Department" }, { companyId, name: "Operations", category: "Department" }, { companyId, name: "Project Phoenix", category: "Project" }]);

  const start = new Date(fy.startDate + "T00:00:00Z"); const today = new Date();
  const months: Date[] = [];
  for (let i = 0; i < 12; i++) { const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1)); if (d <= today) months.push(d); }
  const iso = (d: Date, day: number) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), Math.min(day, 28))).toISOString().slice(0, 10);
  const addDays = (s: string, n: number) => new Date(Date.parse(s) + n * 86400000).toISOString().slice(0, 10);
  const todayIso = today.toISOString().slice(0, 10);

  for (let mi = 0; mi < months.length; mi++) {
    const m = months[mi]; const g = 1 + mi * 0.025;
    for (let ci = 0; ci < cust.length; ci++) {
      const date = iso(m, 5 + ci * 7);
      if (date > todayIso) continue;
      const base = [420000, 610000, 230000][ci] * g;
      const inv = await createInvoice(actor, { kind: "sales", partyId: cust[ci].id, date, dueDate: addDays(date, cust[ci].creditDays), placeOfSupply: cust[ci].stateCode, fyId: fy.id,
        items: [{ description: "[DEMO] Product supply", hsn: "8479", qty: 10, rate: String(Math.round(base * 0.7 / 10)), gstRate: 18 }, { description: "[DEMO] Installation services", hsn: "998719", qty: 1, rate: String(Math.round(base * 0.3)), gstRate: 18 }] });
      await approveInvoice(actor, inv.id);
      // older invoices are mostly collected; recent ones stay outstanding
      if (mi < months.length - 1 || (ci === 0 && mi === months.length - 1 && false)) {
        const payDate = addDays(date, 20 + ci * 10);
        if (payDate <= todayIso && !(mi === months.length - 2 && ci === 1)) await recordPayment(actor, { invoiceId: inv.id, amount: String(inv.total), date: payDate, mode: "bank", reference: "DEMO-NEFT" });
      }
    }
    for (let vi = 0; vi < vend.length; vi++) {
      const date = iso(m, 8 + vi * 6); if (date > todayIso) continue;
      const base = [210000, 85000, 40000][vi] * g;
      const inv = await createInvoice(actor, { kind: "purchase", partyId: vend[vi].id, date, dueDate: addDays(date, vend[vi].creditDays), fyId: fy.id,
        items: [{ description: vi === 2 ? "[DEMO] Professional fees" : "[DEMO] Materials & freight", hsn: vi === 2 ? "998311" : "7308", qty: 1, rate: String(Math.round(base)), gstRate: 18 }] });
      await approveInvoice(actor, inv.id);
      const payDate = addDays(date, vend[vi].creditDays);
      if (mi < months.length - 1 && payDate <= todayIso) await recordPayment(actor, { invoiceId: inv.id, amount: String(inv.total), date: payDate, mode: "bank", reference: "DEMO-PAY" });
    }
    // payroll, rent, utilities, marketing, interest
    const exp: [string, string, number][] = [["5100", "Salaries", 260000 * (1 + mi * 0.01)], ["5110", "Office rent", 60000], ["5120", "Utilities", 14000 + (mi % 3) * 2500], ["5130", "Marketing", 30000 + (mi % 4) * 9000], ["5950", "Loan interest", 9500]];
    for (const [code, label, amt] of exp) {
      const date = iso(m, code === "5100" ? 28 : 3); if (date > todayIso) continue;
      await postVoucher(actor, { type: "payment", date, narration: `[DEMO] ${label}`, source: "manual", lines: [{ accountId: await byCode(code), debit: Math.round(amt).toFixed(2), credit: 0, costCentreId: null }, { accountId: await acc("bank"), debit: 0, credit: Math.round(amt).toFixed(2) }] });
    }
    const depDate = iso(m, 28); if (depDate <= todayIso) await postVoucher(actor, { type: "journal", date: depDate, narration: "[DEMO] Monthly depreciation", source: "depreciation", lines: [{ accountId: await acc("depreciation"), debit: "22500.00", credit: 0 }, { accountId: await acc("accum_dep"), debit: 0, credit: "22500.00" }] });
  }

  await db.insert(inventoryItems).values([{ companyId, sku: "DEMO-A100", name: "[DEMO] Controller Unit", unit: "Nos", hsn: "8537", reorderLevel: "20" }, { companyId, sku: "DEMO-B200", name: "[DEMO] Sensor Pack", unit: "Box", hsn: "9031", reorderLevel: "50" }]);
  const items = await db.select().from(inventoryItems).where(eq(inventoryItems.companyId, companyId));
  for (const it of items) await db.insert(inventoryMovements).values([{ itemId: it.id, date: fy.startDate, kind: "in", qty: "100", rate: "1500", note: "Opening" }, { itemId: it.id, date: addDays(fy.startDate, 30), kind: "out", qty: "35", rate: "0", note: "Issue to production" }]);
  await db.insert(fixedAssets).values([{ companyId, name: "[DEMO] CNC Machine", category: "Plant & Machinery", purchaseDate: "2023-06-15", cost: "1200000", salvage: "60000", lifeYears: 10, method: "SLM", accumulated: "228000" }, { companyId, name: "[DEMO] Office Servers", category: "Computers", purchaseDate: "2024-01-10", cost: "600000", salvage: "0", lifeYears: 5, method: "WDV", wdvRate: "40", accumulated: "72000" }]);

  // Bank account with an uploaded-style statement
  const [ba] = await db.insert(bankAccounts).values({ companyId, name: "[DEMO] Current A/c", bankName: "Demo Bank", last4: "0000", ledgerAccountId: await acc("bank") }).returning();
  const rows = [
    [addDays(fy.startDate, 6), "NEFT CR ORION RETAIL INV", 0, 495600], [addDays(fy.startDate, 10), "RTGS DR ATLAS COMPONENTS", 247800, 0],
    [addDays(fy.startDate, 28), "SALARY PAYOUT", 260000, 0], [addDays(fy.startDate, 28), "SALARY PAYOUT", 260000, 0], [addDays(fy.startDate, 12), "UPI SWIGGY CORP LUNCH", 1850, 0], [addDays(fy.startDate, 14), "BANK CHARGES QTR", 590, 0],
  ] as const;
  await db.insert(bankTransactions).values(rows.map((r) => ({ bankAccountId: ba.id, companyId, date: r[0], description: r[1], debit: String(r[2]), credit: String(r[3]), hash: sha256(`${ba.id}|${r[0]}|${r[1]}|${r[2]}|${r[3]}`), batch: "demo" })));

  // Budget
  const [b] = await db.insert(budgets).values({ companyId, fyId: fy.id, name: "[DEMO] Annual operating budget", kind: "annual", status: "approved", submittedBy: ctx.user.id, approvedBy: ctx.user.id }).returning();
  const bl: [string, number][] = [["4001", 1500000], ["5001", 650000], ["5100", 265000], ["5110", 60000], ["5120", 15000], ["5130", 40000]];
  for (const [code, amt] of bl) await db.insert(budgetLines).values({ budgetId: b.id, accountId: await byCode(code), amounts: Array(12).fill(String(amt)) });
  await db.insert(kpis).values([{ companyId, name: "Gross margin %", formula: "(revenue - cogs) / revenue * 100", target: "30", unit: "%" }, { companyId, name: "Opex to revenue %", formula: "opex / revenue * 100", target: "35", unit: "%", direction: "lower" }]);

  // Historical statements (DEMO) for multi-year analysis
  const y = Number(fy.startDate.slice(0, 4));
  const mk = (k: number, label: string) => ({ revenue: 14.0e6 * k, cogs: 8.9e6 * k, opex: 3.1e6 * k * 1.02, depreciation: 270000, otherIncome: 80000, interest: 130000 - (k - 1) * 40000, tax: 380000 * k * k, cash: 2.1e6 * k, receivables: 2.2e6 * k * 1.05, inventory: 0.9e6 * k, otherCA: 250000, fixedAssets: 1.7e6 - (k - 1) * 100000, otherNCA: 100000, payables: 1.1e6 * k, otherCL: 450000, shortDebt: 200000, longDebt: 1.4e6 - (k - 1) * 150000, otherNCL: 0, equity: 4.4e6 + (k - 1) * 900000, retained: 1.8e6 + (k - 1) * 900000, cfo: 1.5e6 * k, capex: 300000, dividends: 150000, shares: 1000000, price: 22 * k, _l: label as unknown as number });
  const hist = [mk(0.8, "a"), mk(0.9, "b"), mk(1, "c")].map(({ _l, ...rest }) => { void _l; return rest; });
  await db.insert(financialStatements).values(hist.map((d, i) => ({ companyId, label: `FY ${y - 3 + i}-${String((y - 2 + i) % 100).padStart(2, "0")} [DEMO]`, periodEnd: `${y - 2 + i}-03-31`, data: d as Record<string, number>, source: "demo" })));
}
