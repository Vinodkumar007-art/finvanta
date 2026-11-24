import { describe, expect, it } from "vitest";
import { buildGstDraft, type FilingInvoice } from "@/engines/gst-filing";
import { invoiceTotals } from "@/engines/tax";
import { gstFilingApiError } from "@/services/gst-filing";

const companyGstin = "27AAPFU0939F1ZV";

function invoice(input: Partial<FilingInvoice> & Pick<FilingInvoice, "number" | "kind" | "items">): FilingInvoice {
  const base = {
    id: input.id ?? input.number,
    kind: input.kind,
    number: input.number,
    date: input.date ?? "2025-05-10",
    placeOfSupply: input.placeOfSupply ?? "27",
    supplierState: input.supplierState ?? "27",
    partyGstin: input.partyGstin ?? companyGstin,
    status: input.status ?? "approved",
    items: input.items,
  };
  const totals = invoiceTotals(base.items, base.supplierState, base.placeOfSupply);
  return {
    ...base,
    taxable: input.taxable ?? totals.taxable.toFixed(2),
    cgst: input.cgst ?? totals.cgst.toFixed(2),
    sgst: input.sgst ?? totals.sgst.toFixed(2),
    igst: input.igst ?? totals.igst.toFixed(2),
  };
}

const baseInput = { period: "2025-05", gstin: companyGstin, companyState: "27", today: "2025-06-01" };

describe("gstFilingApiError", () => {
  it("returns actionable provider status without exposing upstream error details", () => {
    const result = gstFilingApiError(new Error("Model provider error (404). upstream-private-detail"));

    expect(result).toEqual({
      status: 502,
      message: "AI provider request failed (404). Verify the configured model ID and API endpoint. No review was stored.",
    });
    expect(result.message).not.toContain("upstream-private-detail");
  });

  it("identifies rate limits without returning provider response text", () => {
    const result = gstFilingApiError(new Error("Provider rate limit or quota reached. upstream-private-detail"));

    expect(result.status).toBe(502);
    expect(result.message).toMatch(/rate limit or quota/i);
    expect(result.message).not.toContain("upstream-private-detail");
  });

  it("reports safe schema field paths when review output is invalid", () => {
    const result = gstFilingApiError(new Error("GST AI review failed schema validation at summary; no review was stored."));

    expect(result).toEqual({
      status: 502,
      message: "The AI review response did not contain valid values for summary. No review was stored.",
    });
  });
});

describe("buildGstDraft", () => {
  it("calculates a clean intrastate sales invoice deterministically", () => {
    const draft = buildGstDraft({
      ...baseInput,
      invoices: [invoice({ number: "INV-001", kind: "sales", items: [{ hsn: "1001", qty: 1, rate: "1000", gstRate: 18 }] })],
    });

    expect(draft.totals.outward).toEqual({ taxable: "1000.00", cgst: "90.00", sgst: "90.00", igst: "0.00", totalTax: "180.00" });
    expect(draft.totals.netTaxPayable).toEqual({ igst: "0.00", cgst: "90.00", sgst: "90.00", total: "180.00" });
    expect(draft.lineItems).toHaveLength(1);
    expect(draft.gstr1.totals.taxable).toBe("1000.00");
    expect(draft.gstr3b.netTaxPayable.total).toBe("180.00");
    expect(draft.checks.filter((check) => check.status === "fail")).toEqual([]);
  });

  it("aggregates multiple rates and interstate sales and reports purchases separately", () => {
    const sales = invoice({
      number: "INV-002",
      kind: "sales",
      placeOfSupply: "29",
      items: [
        { hsn: "1001", qty: 2, rate: "500", gstRate: 5 },
        { hsn: "1002", qty: 1, rate: "1000", gstRate: 18 },
      ],
    });
    const purchase = invoice({
      number: "BILL-001",
      kind: "purchase",
      supplierState: "29",
      items: [{ hsn: "1003", qty: 1, rate: "200", gstRate: 18 }],
    });

    const draft = buildGstDraft({ ...baseInput, invoices: [sales, purchase] });
    expect(draft.lineItems.map((line) => [line.direction, line.gstRate, line.igst])).toEqual([
      ["outward", 5, "50.00"],
      ["outward", 18, "180.00"],
      ["purchase", 18, "36.00"],
    ]);
    expect(draft.totals.purchasesFromBooks.totalTax).toBe("36.00");
    expect(draft.totals.inputTaxCredit.claimed.totalTax).toBe("0.00");
    expect(draft.totals.netTaxPayable.total).toBe("230.00");
  });

  it("marks header mismatches and excludes unapproved invoices", () => {
    const good = invoice({ number: "INV-003", kind: "sales", items: [{ hsn: "1001", qty: 1, rate: "100", gstRate: 18 }] });
    const mismatch = invoice({
      number: "INV-004",
      kind: "sales",
      items: [{ hsn: "1001", qty: 1, rate: "100", gstRate: 18 }],
      cgst: "1.00",
    });
    const pending = invoice({
      number: "INV-005",
      kind: "sales",
      status: "pending_approval",
      items: [{ hsn: "1001", qty: 1, rate: "500", gstRate: 18 }],
    });

    const draft = buildGstDraft({ ...baseInput, invoices: [good, mismatch, pending] });
    expect(draft.sourceInvoiceIds).toEqual(["INV-003", "INV-004"]);
    expect(draft.checks.find((check) => check.code === "invoice_header_totals")?.status).toBe("fail");
    expect(draft.checks.find((check) => check.code === "approved_invoices_only")?.status).toBe("fail");
    expect(draft.totals.outward.taxable).toBe("200.00");
  });

  it("flags an overdue due date without inventing a fee or interest", () => {
    const draft = buildGstDraft({ ...baseInput, dueDate: "2025-05-20", invoices: [invoice({ number: "INV-006", kind: "sales", items: [{ hsn: "1001", qty: 1, rate: "100", gstRate: 5 }] })] });
    expect(draft.totals.lateFeeInterest).toEqual({
      status: "overdue_review_required",
      amount: null,
      message: "The configured due date (2025-05-20) has passed. Verify applicable late fee and interest; no amount is estimated.",
    });
  });
});
