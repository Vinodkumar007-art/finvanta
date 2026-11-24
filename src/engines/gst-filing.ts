import { D, Decimal, r2 } from "./core";
import { gstSetOff, gstSplit, TAX_RULES, validateGstin } from "./tax";

export type FilingInvoice = {
  id: string;
  kind: "sales" | "purchase";
  number: string;
  date: string;
  placeOfSupply: string;
  supplierState: string;
  partyGstin?: string | null;
  status: string;
  items: { hsn: string; qty: number; rate: string; gstRate: number }[];
  taxable?: Decimal.Value | null;
  cgst?: Decimal.Value | null;
  sgst?: Decimal.Value | null;
  igst?: Decimal.Value | null;
};

export type GstCheck = {
  code: string;
  status: "pass" | "fail" | "not_configured";
  message: string;
};

type TaxTotals = { taxable: string; cgst: string; sgst: string; igst: string; totalTax: string };
export type GstLineItem = TaxTotals & {
  direction: "outward" | "purchase";
  gstRate: number;
  taxType: "intrastate" | "interstate";
  invoiceCount: number;
  invoiceNumbers: string[];
};

export type GstDraft = {
  period: string;
  gstin: string;
  sourceInvoiceIds: string[];
  lineItems: GstLineItem[];
  gstr1: { lineItems: GstLineItem[]; totals: TaxTotals };
  gstr3b: {
    outward: TaxTotals;
    purchasesFromBooks: TaxTotals;
    inputTaxCredit: { claimed: TaxTotals; note: string };
    netTaxPayable: { igst: string; cgst: string; sgst: string; total: string };
    lateFeeInterest: { status: "overdue_review_required" | "not_configured"; amount: null; message: string };
  };
  totals: {
    outward: TaxTotals;
    purchasesFromBooks: TaxTotals;
    inputTaxCredit: { claimed: TaxTotals; note: string };
    netTaxPayable: { igst: string; cgst: string; sgst: string; total: string };
    lateFeeInterest: { status: "overdue_review_required" | "not_configured"; amount: null; message: string };
  };
  checks: GstCheck[];
};

type MutableLine = {
  direction: GstLineItem["direction"];
  gstRate: number;
  taxType: GstLineItem["taxType"];
  taxable: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  igst: Decimal;
  invoiceNumbers: Set<string>;
};

const approvedStatuses = new Set(["approved", "partially_paid", "paid"]);
const taxRates = new Set<number>(TAX_RULES.gstSlabs);
const emptyTaxTotals = (): TaxTotals => ({ taxable: "0.00", cgst: "0.00", sgst: "0.00", igst: "0.00", totalTax: "0.00" });

function toTaxTotals(taxable: Decimal, cgst: Decimal, sgst: Decimal, igst: Decimal): TaxTotals {
  return {
    taxable: r2(taxable).toFixed(2),
    cgst: r2(cgst).toFixed(2),
    sgst: r2(sgst).toFixed(2),
    igst: r2(igst).toFixed(2),
    totalTax: r2(cgst.plus(sgst).plus(igst)).toFixed(2),
  };
}

function isInPeriod(date: string, period: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date.slice(0, 7) === period;
}

export function buildGstDraft(input: {
  period: string;
  gstin: string;
  companyState: string;
  invoices: FilingInvoice[];
  dueDate?: string;
  today?: string;
}): GstDraft {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period)) throw new Error("GST return period must use YYYY-MM format.");
  if (!/^\d{2}$/.test(input.companyState)) throw new Error("Company state code must be a two-digit GST state code.");

  const periodInvoices = input.invoices.filter((invoice) => isInPeriod(invoice.date, input.period));
  const approvedInvoices = periodInvoices.filter((invoice) => approvedStatuses.has(invoice.status));
  const checks: GstCheck[] = [];
  const addCheck = (code: string, status: GstCheck["status"], message: string) => checks.push({ code, status, message });

  addCheck("company_gstin", validateGstin(input.gstin) ? "pass" : "fail", validateGstin(input.gstin) ? "Company GSTIN format and checksum are valid." : "Company GSTIN is invalid.");
  addCheck(
    "approved_invoices_only",
    periodInvoices.length === approvedInvoices.length ? "pass" : "fail",
    periodInvoices.length === approvedInvoices.length
      ? "All period invoices included in this draft are approved."
      : `${periodInvoices.length - approvedInvoices.length} unapproved or cancelled period invoice(s) were excluded; resolve them before filing.`,
  );
  addCheck("period_has_approved_invoices", approvedInvoices.length ? "pass" : "fail", approvedInvoices.length ? `${approvedInvoices.length} approved invoice(s) are included.` : "No approved invoices are available for this period.");

  const seenNumbers = new Set<string>();
  const duplicateNumbers = new Set<string>();
  for (const invoice of approvedInvoices) {
    const key = `${invoice.kind}:${invoice.number.trim().toUpperCase()}`;
    if (seenNumbers.has(key)) duplicateNumbers.add(invoice.number);
    seenNumbers.add(key);
  }
  addCheck(
    "unique_invoice_numbers",
    duplicateNumbers.size ? "fail" : "pass",
    duplicateNumbers.size ? `Duplicate invoice number(s): ${[...duplicateNumbers].join(", ")}.` : "No duplicate invoice numbers were found within invoice type.",
  );

  const lines = new Map<string, MutableLine>();
  let outwardTaxable = D(0), outwardCgst = D(0), outwardSgst = D(0), outwardIgst = D(0);
  let purchaseTaxable = D(0), purchaseCgst = D(0), purchaseSgst = D(0), purchaseIgst = D(0);
  let taxRateMismatch = false;
  let gstinMismatch = false;
  let invoiceTotalMismatch = false;

  for (const invoice of approvedInvoices) {
    if (invoice.partyGstin && !validateGstin(invoice.partyGstin)) gstinMismatch = true;
    let invoiceTaxable = D(0), invoiceCgst = D(0), invoiceSgst = D(0), invoiceIgst = D(0);
    for (const item of invoice.items) {
      if (!taxRates.has(item.gstRate)) taxRateMismatch = true;
      const taxable = r2(D(item.rate).mul(item.qty));
      const tax = gstSplit(taxable, item.gstRate, invoice.supplierState, invoice.placeOfSupply);
      const direction = invoice.kind === "sales" ? "outward" : "purchase";
      const taxType = tax.intra ? "intrastate" : "interstate";
      const key = `${direction}:${item.gstRate}:${taxType}`;
      const existing = lines.get(key) ?? {
        direction,
        gstRate: item.gstRate,
        taxType,
        taxable: D(0),
        cgst: D(0),
        sgst: D(0),
        igst: D(0),
        invoiceNumbers: new Set<string>(),
      };
      existing.taxable = existing.taxable.plus(taxable);
      existing.cgst = existing.cgst.plus(tax.cgst);
      existing.sgst = existing.sgst.plus(tax.sgst);
      existing.igst = existing.igst.plus(tax.igst);
      existing.invoiceNumbers.add(invoice.number);
      lines.set(key, existing);

      invoiceTaxable = invoiceTaxable.plus(taxable);
      invoiceCgst = invoiceCgst.plus(tax.cgst);
      invoiceSgst = invoiceSgst.plus(tax.sgst);
      invoiceIgst = invoiceIgst.plus(tax.igst);
    }

    const matches = (actual: Decimal, stored: Decimal.Value | null | undefined) =>
      stored !== null && stored !== undefined && r2(actual).eq(r2(stored));
    if (
      !matches(invoiceTaxable, invoice.taxable) ||
      !matches(invoiceCgst, invoice.cgst) ||
      !matches(invoiceSgst, invoice.sgst) ||
      !matches(invoiceIgst, invoice.igst)
    ) invoiceTotalMismatch = true;

    if (invoice.kind === "sales") {
      outwardTaxable = outwardTaxable.plus(invoiceTaxable);
      outwardCgst = outwardCgst.plus(invoiceCgst);
      outwardSgst = outwardSgst.plus(invoiceSgst);
      outwardIgst = outwardIgst.plus(invoiceIgst);
    } else {
      purchaseTaxable = purchaseTaxable.plus(invoiceTaxable);
      purchaseCgst = purchaseCgst.plus(invoiceCgst);
      purchaseSgst = purchaseSgst.plus(invoiceSgst);
      purchaseIgst = purchaseIgst.plus(invoiceIgst);
    }
  }

  addCheck("counterparty_gstin", gstinMismatch ? "fail" : "pass", gstinMismatch ? "An invoice contains an invalid counterparty GSTIN." : "All provided counterparty GSTINs are valid.");
  addCheck("gst_rate_slab", taxRateMismatch ? "fail" : "pass", taxRateMismatch ? "One or more invoice tax rates are not in the configured GST rate list." : "Invoice tax rates match the configured GST rate list.");
  addCheck("invoice_header_totals", invoiceTotalMismatch ? "fail" : "pass", invoiceTotalMismatch ? "Computed item totals do not match one or more stored invoice tax totals." : "Computed item totals match the stored invoice tax totals.");
  addCheck("hsn_rate_validation", "not_configured", "No authoritative HSN-to-rate mapping is configured; verify HSN tax rates independently.");
  addCheck("gstr2b_eligibility", "not_configured", "GSTR-2B matching and ITC eligibility data are unavailable; no purchase tax is claimed as ITC.");

  const lineItems: GstLineItem[] = [...lines.values()].map((line) => ({
    direction: line.direction,
    gstRate: line.gstRate,
    taxType: line.taxType,
    ...toTaxTotals(line.taxable, line.cgst, line.sgst, line.igst),
    invoiceCount: line.invoiceNumbers.size,
    invoiceNumbers: [...line.invoiceNumbers].sort(),
  })).sort((a, b) => a.direction.localeCompare(b.direction) || a.gstRate - b.gstRate || a.taxType.localeCompare(b.taxType));

  const outward = toTaxTotals(outwardTaxable, outwardCgst, outwardSgst, outwardIgst);
  const purchases = toTaxTotals(purchaseTaxable, purchaseCgst, purchaseSgst, purchaseIgst);
  const claimed = emptyTaxTotals();
  const setoff = gstSetOff(
    { igst: outward.igst, cgst: outward.cgst, sgst: outward.sgst },
    { igst: claimed.igst, cgst: claimed.cgst, sgst: claimed.sgst },
  );
  const dueDatePast = Boolean(input.dueDate && input.today && input.dueDate < input.today);
  const inputTaxCredit = {
    claimed,
    note: "Claimed ITC is zero until invoice eligibility and GSTR-2B reconciliation are available and verified.",
  };
  const netTaxPayable = {
    igst: setoff.cashIgst.toFixed(2),
    cgst: setoff.cashCgst.toFixed(2),
    sgst: setoff.cashSgst.toFixed(2),
    total: setoff.cashTotal.toFixed(2),
  };
  const lateFeeInterest = dueDatePast
    ? { status: "overdue_review_required" as const, amount: null, message: `The configured due date (${input.dueDate}) has passed. Verify applicable late fee and interest; no amount is estimated.` }
    : { status: "not_configured" as const, amount: null, message: "No applicable return due date was provided; late fee and interest are not estimated." };

  return {
    period: input.period,
    gstin: input.gstin.trim().toUpperCase(),
    sourceInvoiceIds: approvedInvoices.map((invoice) => invoice.id).sort(),
    lineItems,
    gstr1: { lineItems: lineItems.filter((line) => line.direction === "outward"), totals: outward },
    gstr3b: {
      outward,
      purchasesFromBooks: purchases,
      inputTaxCredit,
      netTaxPayable,
      lateFeeInterest,
    },
    totals: {
      outward,
      purchasesFromBooks: purchases,
      inputTaxCredit,
      netTaxPayable,
      lateFeeInterest,
    },
    checks,
  };
}
