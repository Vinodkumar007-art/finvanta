import { afterEach, describe, expect, it, vi } from "vitest";
import { inventoryItems, inventoryMovements } from "@/db/schema";
import { postInvoiceInventory, validateInventoryLinks } from "@/services/inventory";

const { dbMock } = vi.hoisted(() => ({ dbMock: { select: vi.fn() } }));
vi.mock("@/db", () => ({ db: dbMock }));

afterEach(() => vi.resetAllMocks());

function makeTransaction(movements: { date: string; kind: string; qty: string; rate: string }[] = []) {
  const insertValues = vi.fn().mockResolvedValue(undefined);
  const tx = {
    select: vi.fn(() => {
      let table: unknown;
      const builder = {
        from: vi.fn((source: unknown) => { table = source; return builder; }),
        where: vi.fn(() => ({
          for: vi.fn(async () => table === inventoryItems ? [{ sku: "SKU-1" }] : []),
          orderBy: vi.fn(async () => table === inventoryMovements ? movements : []),
        })),
      };
      return builder;
    }),
    insert: vi.fn(() => ({ values: insertValues })),
  };
  return {
    tx: tx as unknown as Parameters<typeof postInvoiceInventory>[0],
    insertValues,
  };
}

const invoice = {
  companyId: "company-1",
  number: "INV-0001",
  date: "2025-04-03",
  items: [{ inventoryItemId: "item-1", description: "Widget", hsn: "", qty: 2, rate: "30", gstRate: 18 }],
};

describe("inventory-linked invoices", () => {
  it("records approved purchase quantities as weighted-average receipts", async () => {
    const { tx, insertValues } = makeTransaction();

    const amounts = await postInvoiceInventory(tx, { ...invoice, kind: "purchase" });

    expect(amounts).toEqual({ costOfGoodsSold: "0.00", inventoryPurchaseCost: "60.00" });
    expect(insertValues).toHaveBeenCalledWith([{
      itemId: "item-1",
      date: "2025-04-03",
      kind: "in",
      qty: "2.000",
      rate: "30.0000",
      note: "Purchase bill INV-0001",
    }]);
  });

  it("records sales issues at current weighted-average cost", async () => {
    const { tx, insertValues } = makeTransaction([
      { date: "2025-04-01", kind: "in", qty: "10", rate: "10" },
      { date: "2025-04-02", kind: "in", qty: "10", rate: "20" },
    ]);

    const amounts = await postInvoiceInventory(tx, { ...invoice, kind: "sales" });

    expect(amounts).toEqual({ costOfGoodsSold: "30.00", inventoryPurchaseCost: "0.00" });
    expect(insertValues).toHaveBeenCalledWith([{
      itemId: "item-1",
      date: "2025-04-03",
      kind: "out",
      qty: "2.000",
      rate: "15.0000",
      note: "Sales invoice INV-0001",
    }]);
  });

  it("blocks sales approval when linked quantity exceeds available stock", async () => {
    const { tx, insertValues } = makeTransaction([
      { date: "2025-04-01", kind: "in", qty: "1", rate: "10" },
    ]);

    await expect(postInvoiceInventory(tx, { ...invoice, kind: "sales" }))
      .rejects.toThrow("Insufficient stock for SKU-1: 1.000 available.");
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("checks combined quantities when one item appears on multiple lines", async () => {
    const { tx, insertValues } = makeTransaction([
      { date: "2025-04-01", kind: "in", qty: "3", rate: "10" },
    ]);

    await expect(postInvoiceInventory(tx, {
      ...invoice,
      kind: "sales",
      items: [invoice.items[0], { ...invoice.items[0], qty: 2 }],
    })).rejects.toThrow("Insufficient stock for SKU-1: 3.000 available.");
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("rejects linked quantities that exceed inventory precision", async () => {
    await expect(validateInventoryLinks("company-1", [{
      ...invoice.items[0],
      qty: 1.2345,
    }])).rejects.toThrow("Inventory-linked quantities support up to 3 decimal places.");
    expect(dbMock.select).not.toHaveBeenCalled();
  });

  it("rejects an inventory link that is not owned by the billing company", async () => {
    dbMock.select.mockReturnValue({
      from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
    });

    await expect(validateInventoryLinks("company-1", invoice.items))
      .rejects.toThrow("One or more selected inventory items are unavailable.");
  });
});
