import { describe, expect, it, vi } from "vitest";
import { buildGstDraft } from "@/engines/gst-filing";
import { reviewGstDraft, type GstReviewCompletion } from "@/services/gst-filing-review";

const gstin = "27AAPFU0939F1ZV";
const draft = buildGstDraft({
  period: "2025-05",
  gstin,
  companyState: "27",
  invoices: [{
    id: "invoice-1",
    kind: "sales",
    number: "INV-001",
    date: "2025-05-10",
    placeOfSupply: "27",
    supplierState: "27",
    partyGstin: gstin,
    status: "approved",
    items: [{ hsn: "1001", qty: 1, rate: "1000", gstRate: 18 }],
    taxable: "1000.00",
    cgst: "90.00",
    sgst: "90.00",
    igst: "0.00",
  }],
});

function completion(response: unknown, capture: (input: string) => void = () => undefined): GstReviewCompletion {
  return async (input) => {
    capture(input);
    return { content: JSON.stringify(response), model: "test:mock-model" };
  };
}

describe("reviewGstDraft", () => {
  it("sends only structured filing data and validates references", async () => {
    let input = "";
    const result = await reviewGstDraft(draft, completion({
      summary: "Review the outward supplies and tax before approval.",
      anomalies: [
        { checkCode: "gstr2b_eligibility", note: "Input credit requires independent reconciliation." },
        { checkCode: "not-a-check", note: "This reference is discarded." },
      ],
    }, (value) => { input = value; }));

    expect(input).not.toContain("INV-001");
    expect(input).not.toContain("invoice-1");
    expect(input).not.toContain("1001");
    expect(JSON.parse(input)).toMatchObject({
      period: "2025-05",
      lines: [{ lineIndex: 0, taxable: "1000.00", invoiceCount: 1 }],
    });
    expect(result.anomalies).toEqual([{ checkCode: "gstr2b_eligibility", note: "Input credit requires independent reconciliation." }]);
    expect(result.filingSummary).toContain("₹1000.00");
  });

  it("withholds fabricated numeric claims instead of displaying them", async () => {
    const result = await reviewGstDraft(draft, completion({
      summary: "This return includes ₹999,999.00 in outward sales.",
      anomalies: [{ checkCode: "gstr2b_eligibility", note: "The mismatch is ₹888.00." }],
    }));

    expect(result.summary).toBe("AI summary withheld because it included an unverified numeric claim.");
    expect(result.anomalies).toEqual([]);
    expect(result.safetyNote).toContain("withheld as unverified");
    expect(result.filingSummary).toContain("₹1000.00");
  });

  it("normalizes harmless provider schema variations and drops unanchored anomalies", async () => {
    const result = await reviewGstDraft(draft, completion({
      summary: "Review the draft before approval.",
      providerMetadata: { finishReason: "stop" },
      anomalies: [
        { checkCode: "gstr2b_eligibility", lineIndex: 0, note: "Reconcile this check." },
        { lineIndex: "0", note: "Verify the line item." },
        { checkCode: "not-a-check", note: "This reference is discarded." },
        { note: "This item has no valid reference." },
      ],
    }));

    expect(result.anomalies).toEqual([
      { checkCode: "gstr2b_eligibility", note: "Reconcile this check." },
      { lineIndex: 0, note: "Verify the line item." },
    ]);
  });

  it("extracts JSON wrapped in explanatory text and a Markdown code fence", async () => {
    const result = await reviewGstDraft(draft, async () => ({
      content: 'Review result:\n```json\n{"summary":"Review the draft before approval.","anomalies":[]}\n```\n',
      model: "test:mock-model",
    }));

    expect(result.summary).toBe("Review the draft before approval.");
    expect(result.anomalies).toEqual([]);
  });

  it("does not call an LLM when the model response is malformed", async () => {
    const fakeCompletion = vi.fn(async () => ({ content: "not json", model: "test" }));
    await expect(reviewGstDraft(draft, fakeCompletion)).rejects.toThrow("invalid JSON");
    expect(fakeCompletion).toHaveBeenCalledTimes(1);
  });
});
