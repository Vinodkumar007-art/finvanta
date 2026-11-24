import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { inventoryItems, inventoryMovements, type InvoiceItem } from "@/db/schema";
import { weightedAverageInventory } from "@/engines/accounting";
import { D, r2 } from "@/engines/core";

type InventoryTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type MovementInput = { itemId: string; kind: "in" | "out"; qty: string; rate: string; date: string; note?: string };

export async function getInventoryCatalog(companyId: string) {
  const items = await db.select().from(inventoryItems)
    .where(and(eq(inventoryItems.companyId, companyId), isNull(inventoryItems.deletedAt)))
    .orderBy(asc(inventoryItems.sku));
  if (!items.length) return [];

  const movements = await db.select().from(inventoryMovements)
    .where(inArray(inventoryMovements.itemId, items.map((item) => item.id)))
    .orderBy(asc(inventoryMovements.date));
  const byItem = new Map<string, typeof movements>();
  for (const movement of movements) {
    const itemMovements = byItem.get(movement.itemId) ?? [];
    itemMovements.push(movement);
    byItem.set(movement.itemId, itemMovements);
  }

  return items.map((item) => {
    const stock = weightedAverageInventory((byItem.get(item.id) ?? []).map((movement) => ({
      date: movement.date,
      kind: movement.kind as "in" | "out",
      qty: movement.qty,
      rate: movement.rate,
    })));
    return {
      ...item,
      onHand: stock.qty.toFixed(3),
      averageCost: stock.avgCost.toFixed(4),
      value: stock.value.toFixed(2),
      belowReorder: stock.qty.lt(item.reorderLevel),
      hasHistoryError: stock.errors.length > 0,
    };
  });
}

export async function validateInventoryLinks(companyId: string, items: InvoiceItem[]) {
  const linkedItems = items.filter((item) => item.inventoryItemId);
  if (!linkedItems.length) return;

  if (linkedItems.some((item) => D(item.qty).decimalPlaces() > 3)) {
    throw new Error("Inventory-linked quantities support up to 3 decimal places.");
  }
  if (linkedItems.some((item) => D(item.rate).decimalPlaces() > 4)) {
    throw new Error("Inventory-linked rates support up to 4 decimal places.");
  }
  const itemIds = [...new Set(linkedItems.map((item) => item.inventoryItemId!))];
  const found = await db.select({ id: inventoryItems.id }).from(inventoryItems)
    .where(and(
      eq(inventoryItems.companyId, companyId),
      inArray(inventoryItems.id, itemIds),
      isNull(inventoryItems.deletedAt),
    ));
  if (found.length !== itemIds.length) throw new Error("One or more selected inventory items are unavailable.");
}

export async function postInvoiceInventory(
  tx: InventoryTransaction,
  invoice: { companyId: string; kind: "sales" | "purchase"; number: string; date: string; items: InvoiceItem[] },
) {
  const linkedItems = invoice.items.filter((item) => item.inventoryItemId);
  if (!linkedItems.length) return { costOfGoodsSold: "0.00", inventoryPurchaseCost: "0.00" };

  const quantities = new Map<string, ReturnType<typeof D>>();
  for (const item of linkedItems) {
    const itemId = item.inventoryItemId!;
    quantities.set(itemId, (quantities.get(itemId) ?? D(0)).plus(item.qty));
  }

  const averageCosts = new Map<string, ReturnType<typeof D>>();
  for (const itemId of [...quantities.keys()].sort()) {
    const [item] = await tx.select().from(inventoryItems)
      .where(and(
        eq(inventoryItems.id, itemId),
        eq(inventoryItems.companyId, invoice.companyId),
        isNull(inventoryItems.deletedAt),
      ))
      .for("update");
    if (!item) throw new Error("One or more selected inventory items are unavailable.");

    const movements = await tx.select().from(inventoryMovements)
      .where(and(
        eq(inventoryMovements.itemId, itemId),
        lte(inventoryMovements.date, invoice.date),
      ))
      .orderBy(asc(inventoryMovements.date));
    const stock = weightedAverageInventory(movements.map((movement) => ({
      date: movement.date,
      kind: movement.kind as "in" | "out",
      qty: movement.qty,
      rate: movement.rate,
    })));
    if (stock.errors.length) {
      throw new Error(`Inventory history for ${item.sku} has an over-issue; reconcile it before approving this invoice.`);
    }
    if (invoice.kind === "sales" && quantities.get(itemId)!.gt(stock.qty)) {
      throw new Error(`Insufficient stock for ${item.sku}: ${stock.qty.toFixed(3)} available.`);
    }
    averageCosts.set(itemId, stock.avgCost);
  }

  let costOfGoodsSold = D(0);
  let inventoryPurchaseCost = D(0);
  for (const item of linkedItems) {
    if (invoice.kind === "sales") costOfGoodsSold = costOfGoodsSold.plus(averageCosts.get(item.inventoryItemId!)!.mul(item.qty));
    else inventoryPurchaseCost = inventoryPurchaseCost.plus(r2(D(item.rate).mul(item.qty)));
  }

  const note = `${invoice.kind === "sales" ? "Sales invoice" : "Purchase bill"} ${invoice.number}`;
  await tx.insert(inventoryMovements).values(linkedItems.map((item) => ({
    itemId: item.inventoryItemId!,
    date: invoice.date,
    kind: invoice.kind === "sales" ? "out" : "in",
    qty: D(item.qty).toFixed(3),
    rate: (invoice.kind === "sales" ? averageCosts.get(item.inventoryItemId!)! : D(item.rate)).toFixed(4),
    note,
  })));
  return {
    costOfGoodsSold: r2(costOfGoodsSold).toFixed(2),
    inventoryPurchaseCost: r2(inventoryPurchaseCost).toFixed(2),
  };
}

export async function recordInventoryMovement(companyId: string, movement: MovementInput) {
  const qty = D(movement.qty);
  const rate = D(movement.rate);
  if (qty.lte(0)) throw new Error("Quantity must be positive.");
  if (qty.decimalPlaces() > 3) throw new Error("Inventory quantities support up to 3 decimal places.");
  if (rate.lt(0) || rate.decimalPlaces() > 4) throw new Error("Inventory rates must be non-negative with up to 4 decimal places.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(movement.date)) throw new Error("Invalid stock movement date.");

  await db.transaction(async (tx) => {
    const [item] = await tx.select().from(inventoryItems)
      .where(and(
        eq(inventoryItems.id, movement.itemId),
        eq(inventoryItems.companyId, companyId),
        isNull(inventoryItems.deletedAt),
      ))
      .for("update");
    if (!item) throw new Error("Item not found.");

    const existing = await tx.select().from(inventoryMovements)
      .where(and(
        eq(inventoryMovements.itemId, movement.itemId),
        lte(inventoryMovements.date, movement.date),
      ))
      .orderBy(asc(inventoryMovements.date));
    const stock = weightedAverageInventory(existing.map((row) => ({
      date: row.date,
      kind: row.kind as "in" | "out",
      qty: row.qty,
      rate: row.rate,
    })));
    if (stock.errors.length) throw new Error("Inventory history has an over-issue; reconcile it before recording another movement.");
    if (movement.kind === "out" && qty.gt(stock.qty)) {
      throw new Error(`Insufficient stock: ${stock.qty.toFixed(3)} available.`);
    }

    await tx.insert(inventoryMovements).values({
      itemId: movement.itemId,
      date: movement.date,
      kind: movement.kind,
      qty: qty.toFixed(3),
      rate: rate.toFixed(4),
      note: movement.note,
    });
  });
}
