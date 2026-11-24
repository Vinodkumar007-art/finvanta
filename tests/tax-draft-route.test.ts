import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/tax/draft/route";

const { apiCtxMock, invoiceRowsMock, auditMock, dbMock } = vi.hoisted(() => ({
  apiCtxMock: vi.fn(),
  invoiceRowsMock: vi.fn(),
  auditMock: vi.fn(),
  dbMock: { select: vi.fn() },
}));

vi.mock("@/db", () => ({ db: dbMock }));
vi.mock("@/lib/http", () => ({
  apiCtx: apiCtxMock,
  json: (body: unknown, status = 200) => Response.json(body, { status }),
}));
vi.mock("@/services/finance", () => ({ invoiceRows: invoiceRowsMock }));
vi.mock("@/lib/audit", () => ({ audit: auditMock }));

afterEach(() => vi.resetAllMocks());

describe("GST draft downloads", () => {
  it("omits unapproved invoices from the GSTR-1 draft", async () => {
    apiCtxMock.mockResolvedValue({
      ctx: { company: { id: "company-1" }, fy: { label: "2026-27" } },
    });
    dbMock.select.mockReturnValue({
      from: () => ({ where: async () => [{ gstin: "27AAPFU0939F1ZV", stateCode: "27", name: "Example Co" }] }),
    });
    invoiceRowsMock.mockResolvedValue([
      {
        inv: { number: "INV-APPROVED", date: "2026-04-10", total: "118", placeOfSupply: "27", taxable: "100", cgst: "9", sgst: "9", igst: "0", items: [{ hsn: "1001", qty: 1, rate: "100", gstRate: 18 }], status: "approved" },
        party: { gstin: "27BBBBB0000B1Z5", name: "Buyer" },
      },
      {
        inv: { number: "INV-PENDING", date: "2026-04-11", total: "236", placeOfSupply: "27", taxable: "200", cgst: "18", sgst: "18", igst: "0", items: [{ hsn: "1001", qty: 2, rate: "100", gstRate: 18 }], status: "pending_approval" },
        party: { gstin: "27CCCCC0000C1Z5", name: "Pending Buyer" },
      },
    ]);

    const response = await GET(new Request("http://app.test/api/tax/draft?type=gstr1"));
    if (!response) throw new Error("Expected an API response.");
    const body = await response.json();

    expect(body.b2b).toHaveLength(1);
    expect(body.b2b[0].inum).toBe("INV-APPROVED");
    expect(invoiceRowsMock).toHaveBeenCalledWith(expect.anything(), "sales");
  });

  it("omits unapproved invoices and bills from the GSTR-3B draft", async () => {
    apiCtxMock.mockResolvedValue({
      ctx: { company: { id: "company-1" }, fy: { label: "2026-27" } },
    });
    dbMock.select.mockReturnValue({
      from: () => ({ where: async () => [{ gstin: "27AAPFU0939F1ZV", stateCode: "27", name: "Example Co" }] }),
    });
    invoiceRowsMock.mockImplementation(async (_ctx: unknown, kind: "sales" | "purchase") => {
      const taxable = kind === "sales" ? 100 : 20;
      return [
        { inv: { number: `${kind}-approved`, date: "2026-04-10", taxable, cgst: 9, sgst: 9, igst: 0, status: "approved" }, party: { gstin: null } },
        { inv: { number: `${kind}-pending`, date: "2026-04-11", taxable: taxable * 2, cgst: 18, sgst: 18, igst: 0, status: "pending_approval" }, party: { gstin: null } },
      ];
    });

    const response = await GET(new Request("http://app.test/api/tax/draft?type=gstr3b"));
    if (!response) throw new Error("Expected an API response.");
    const body = await response.json();

    expect(body.outward.taxable).toBe("100.00");
    expect(body.itcAvailable.cgst).toBe("9.00");
  });
});
