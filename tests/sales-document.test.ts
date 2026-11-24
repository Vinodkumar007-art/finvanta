import { afterEach, describe, expect, it, vi } from "vitest";
import { convertSalesDocument } from "@/services/sales-documents";

const { dbMock, auditMock } = vi.hoisted(() => ({
  dbMock: { transaction: vi.fn() },
  auditMock: vi.fn(),
}));

vi.mock("@/db", () => ({ db: dbMock }));
vi.mock("@/lib/audit", () => ({ audit: auditMock }));

afterEach(() => vi.resetAllMocks());

describe("convertSalesDocument", () => {
  it("does not create another invoice when the source document is already converted", async () => {
    const tx = {
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            for: async () => [{ status: "converted" }],
          }),
        }),
      })),
      insert: vi.fn(),
      update: vi.fn(),
    };
    dbMock.transaction.mockImplementation(async (run: (transaction: typeof tx) => Promise<unknown>) => run(tx));

    await expect(convertSalesDocument({
      org: { id: "org-1" },
      user: { id: "user-1" },
      company: { id: "company-1", stateCode: "27" },
    }, "document-1")).rejects.toThrow("Only a draft sales document can be converted.");

    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
  });
});
