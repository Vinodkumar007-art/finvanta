"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { inventoryItems, invoices, parties, type InvoiceItem } from "@/db/schema";
import { D } from "@/engines/core";
import { invoiceTotals, PAN_RE, TAX_RULES, validateGstin } from "@/engines/tax";
import { assertCan, requireCompany } from "@/lib/ctx";
import { audit } from "@/lib/audit";
import { readImportRows, type ImportKind, type ImportRow } from "@/services/data-import";
import type { FormState } from "./auth";

const fail = (error: unknown): FormState => ({ error: error instanceof Error ? error.message : "Import failed." });
const STATE_CODE_RE = /^(0[1-9]|[1-9][0-9])$/;

function required(row: ImportRow, key: string, label = key): string {
  const value = row.values[key]?.trim() ?? "";
  if (!value) throw new Error(`Row ${row.line}: ${label} is required.`);
  return value;
}

function text(row: ImportRow, key: string, label: string, maxLength: number, fallback = ""): string {
  const value = (row.values[key] ?? fallback).trim();
  if (value.length > maxLength) throw new Error(`Row ${row.line}: ${label} must be ${maxLength} characters or fewer.`);
  return value;
}

function amount(row: ImportRow, key: string, label: string, options: { defaultValue?: string; maxDecimals: number; min?: number; max?: number } ): string {
  const raw = (row.values[key] ?? options.defaultValue ?? "").trim().replace(/,/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) throw new Error(`Row ${row.line}: ${label} must be a number.`);
  const places = raw.includes(".") ? raw.length - raw.indexOf(".") - 1 : 0;
  if (places > options.maxDecimals) throw new Error(`Row ${row.line}: ${label} supports at most ${options.maxDecimals} decimal places.`);
  const value = D(raw);
  if (options.min !== undefined && value.lt(options.min)) throw new Error(`Row ${row.line}: ${label} must be at least ${options.min}.`);
  if (options.max !== undefined && value.gt(options.max)) throw new Error(`Row ${row.line}: ${label} must be no more than ${options.max}.`);
  return value.toFixed(options.maxDecimals);
}

function dateValue(row: ImportRow, key: string, label: string): string {
  const raw = required(row, key, label);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? raw.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (!match) throw new Error(`Row ${row.line}: ${label} must be YYYY-MM-DD or DD/MM/YYYY.`);
  const year = Number(match[1].length === 4 ? match[1] : match[3]);
  const month = Number(match[1].length === 4 ? match[2] : match[2]);
  const day = Number(match[1].length === 4 ? match[3] : match[1]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`Row ${row.line}: ${label} is not a valid calendar date.`);
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function stateCode(row: ImportRow, key: string, fallback: string): string {
  const value = text(row, key, "State code", 2, fallback);
  if (!STATE_CODE_RE.test(value)) throw new Error(`Row ${row.line}: State code must be a valid two-digit code.`);
  return value;
}

function ensureUnique<T>(rows: T[], keyOf: (row: T) => string, label: string) {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = keyOf(row);
    if (seen.has(key)) throw new Error(`The file contains duplicate ${label}: ${key}.`);
    seen.add(key);
  }
}

async function importParties(ctx: Awaited<ReturnType<typeof requireCompany>>, rows: ImportRow[], fileName: string) {
  const values = rows.map((row) => {
    const kind = required(row, "kind", "Kind").toLowerCase();
    if (!["customer", "vendor", "deductee"].includes(kind)) throw new Error(`Row ${row.line}: Kind must be customer, vendor or deductee.`);
    const name = required(row, "name", "Name");
    if (name.length > 120) throw new Error(`Row ${row.line}: Name must be 120 characters or fewer.`);
    const gstin = text(row, "gstin", "GSTIN", 15).toUpperCase();
    const pan = text(row, "pan", "PAN", 10).toUpperCase();
    if (gstin && !validateGstin(gstin)) throw new Error(`Row ${row.line}: GSTIN format/checksum is invalid.`);
    if (pan && !PAN_RE.test(pan)) throw new Error(`Row ${row.line}: PAN format is invalid.`);
    const email = text(row, "email", "Email", 254);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`Row ${row.line}: Email is invalid.`);
    const phone = text(row, "phone", "Phone", 20);
    const code = stateCode(row, "state_code", ctx.company.stateCode);
    const creditLimit = amount(row, "credit_limit", "Credit limit", { defaultValue: "0", maxDecimals: 2, min: 0 });
    const creditDaysRaw = amount(row, "credit_days", "Credit days", { defaultValue: "30", maxDecimals: 0, min: 0, max: 365 });
    const deducteeType = text(row, "deductee_type", "Deductee type", 10, "company").toLowerCase();
    if (deducteeType !== "company" && deducteeType !== "individual") throw new Error(`Row ${row.line}: Deductee type must be company or individual.`);
    return {
      companyId: ctx.company.id, kind, name, gstin: gstin || null, pan: pan || null, email: email || null, phone: phone || null,
      stateCode: code, creditLimit, creditDays: Number(creditDaysRaw), deducteeType,
    };
  });
  ensureUnique(values, (row) => `${row.kind}:${row.name.toLowerCase()}`, "party name");

  await db.transaction(async (tx) => {
    const existing = await tx.select({ kind: parties.kind, name: parties.name }).from(parties)
      .where(and(eq(parties.companyId, ctx.company.id), inArray(parties.kind, ["customer", "vendor", "deductee"]), isNull(parties.deletedAt)));
    const names = new Set(existing.map((party) => `${party.kind}:${party.name.toLowerCase()}`));
    const duplicate = values.find((row) => names.has(`${row.kind}:${row.name.toLowerCase()}`));
    if (duplicate) throw new Error(`Party already exists: ${duplicate.name} (${duplicate.kind}).`);
    await tx.insert(parties).values(values);
    await audit(ctx, "data_import.apply", "data_import", null, { kind: "parties", rows: values.length, file: fileName }, tx);
  });
  return values.length;
}

async function importInventory(ctx: Awaited<ReturnType<typeof requireCompany>>, rows: ImportRow[], fileName: string) {
  const values = rows.map((row) => {
    const sku = required(row, "sku", "SKU").toUpperCase();
    if (sku.length > 60) throw new Error(`Row ${row.line}: SKU must be 60 characters or fewer.`);
    const name = required(row, "name", "Name");
    if (name.length > 160) throw new Error(`Row ${row.line}: Name must be 160 characters or fewer.`);
    const unit = text(row, "unit", "Unit", 20, "Nos");
    const hsn = text(row, "hsn", "HSN", 10);
    const reorderLevel = amount(row, "reorder_level", "Reorder level", { defaultValue: "0", maxDecimals: 3, min: 0 });
    return { companyId: ctx.company.id, sku, name, unit: unit || "Nos", hsn: hsn || null, reorderLevel };
  });
  ensureUnique(values, (row) => row.sku.toUpperCase(), "SKU");

  await db.transaction(async (tx) => {
    const existing = await tx.select({ sku: inventoryItems.sku }).from(inventoryItems)
      .where(eq(inventoryItems.companyId, ctx.company.id));
    const skus = new Set(existing.map((item) => item.sku.toUpperCase()));
    const duplicate = values.find((row) => skus.has(row.sku.toUpperCase()));
    if (duplicate) throw new Error(`SKU already exists: ${duplicate.sku}.`);
    await tx.insert(inventoryItems).values(values);
    await audit(ctx, "data_import.apply", "data_import", null, { kind: "inventory", rows: values.length, file: fileName }, tx);
  });
  return values.length;
}

type InvoiceGroup = {
  kind: "sales" | "purchase";
  number: string;
  partyName: string;
  date: string;
  dueDate: string;
  placeOfSupply: string;
  items: InvoiceItem[];
};

async function importInvoices(ctx: Awaited<ReturnType<typeof requireCompany>>, rows: ImportRow[], fileName: string) {
  const [partyRows, inventoryRows, existingRows] = await Promise.all([
    db.select().from(parties).where(and(eq(parties.companyId, ctx.company.id), isNull(parties.deletedAt))),
    db.select().from(inventoryItems).where(and(eq(inventoryItems.companyId, ctx.company.id), isNull(inventoryItems.deletedAt))),
    db.select({ kind: invoices.kind, number: invoices.number }).from(invoices).where(eq(invoices.companyId, ctx.company.id)),
  ]);
  const partyIndex = new Map<string, typeof partyRows>();
  for (const party of partyRows) {
    const key = `${party.kind}:${party.name.toLowerCase()}`;
    partyIndex.set(key, [...(partyIndex.get(key) ?? []), party]);
  }
  const inventoryIndex = new Map(inventoryRows.map((item) => [item.sku.toUpperCase(), item]));
  const groups = new Map<string, InvoiceGroup>();

  for (const row of rows) {
    const kind = required(row, "kind", "Kind").toLowerCase();
    if (kind !== "sales" && kind !== "purchase") throw new Error(`Row ${row.line}: Kind must be sales or purchase.`);
    const number = required(row, "number", "Invoice number");
    if (number.length > 40) throw new Error(`Row ${row.line}: Invoice number must be 40 characters or fewer.`);
    const partyName = required(row, "party_name", "Party name");
    const date = dateValue(row, "date", "Date");
    const dueDate = dateValue(row, "due_date", "Due date");
    const rawPos = text(row, "place_of_supply", "Place of supply", 2);
    const placeOfSupply = rawPos ? stateCode(row, "place_of_supply", ctx.company.stateCode) : "";
    if (kind === "purchase" && placeOfSupply && placeOfSupply !== ctx.company.stateCode) {
      throw new Error(`Row ${row.line}: Purchase place of supply must match this company's state code.`);
    }
    const key = `${kind}:${number.toLowerCase()}`;
    let group = groups.get(key);
    if (!group) {
      group = { kind, number, partyName, date, dueDate, placeOfSupply, items: [] };
      groups.set(key, group);
    } else if (group.partyName.toLowerCase() !== partyName.toLowerCase() || group.date !== date || group.dueDate !== dueDate || group.placeOfSupply !== placeOfSupply) {
      throw new Error(`Row ${row.line}: Rows for invoice ${number} must use the same party, date, due date and place of supply.`);
    }

    const sku = text(row, "sku", "SKU", 60).toUpperCase();
    const stockItem = sku ? inventoryIndex.get(sku) : undefined;
    if (sku && !stockItem) throw new Error(`Row ${row.line}: SKU ${sku} was not found in this company's inventory.`);
    const description = text(row, "description", "Description", 200, stockItem?.name ?? "");
    if (!description) throw new Error(`Row ${row.line}: Description is required (or specify a known SKU).`);
    const qty = Number(amount(row, "qty", "Quantity", { maxDecimals: 3, min: 0.000001 }));
    const rate = amount(row, "rate", "Rate", { maxDecimals: 4, min: 0 });
    const gstRateValue = Number(amount(row, "gst_rate", "GST rate", { maxDecimals: 2, min: 0, max: 40 }));
    if (!TAX_RULES.gstSlabs.includes(gstRateValue)) throw new Error(`Row ${row.line}: GST rate must be one of ${TAX_RULES.gstSlabs.join(", ")}.`);
    const hsn = text(row, "hsn", "HSN", 10, stockItem?.hsn ?? "");
    group.items.push({ description, hsn, qty, rate, gstRate: gstRateValue, ...(stockItem ? { inventoryItemId: stockItem.id } : {}) });
    if (group.items.length > 50) throw new Error(`Invoice ${number} exceeds the 50-line limit.`);
  }

  const existingNumbers = new Set(existingRows.map((row) => `${row.kind}:${row.number.toLowerCase()}`));
  const duplicates = [...groups.keys()].find((key) => existingNumbers.has(key));
  if (duplicates) throw new Error(`Invoice already exists: ${groups.get(duplicates)?.number}.`);

  const prepared = [...groups.values()].map((group) => {
    if (group.date < ctx.fy.startDate || group.date > ctx.fy.endDate) {
      throw new Error(`Invoice ${group.number}: Date is outside the selected financial year ${ctx.fy.label}.`);
    }
    if (group.dueDate < group.date) throw new Error(`Invoice ${group.number}: Due date cannot be before the invoice date.`);
    const partyKind = group.kind === "sales" ? "customer" : "vendor";
    const matches = partyIndex.get(`${partyKind}:${group.partyName.toLowerCase()}`) ?? [];
    if (matches.length !== 1) throw new Error(`Invoice ${group.number}: ${matches.length ? "Party name is ambiguous" : "Party not found"} for ${partyKind}: ${group.partyName}.`);
    const party = matches[0];
    const placeOfSupply = group.kind === "sales" ? (group.placeOfSupply || party.stateCode) : ctx.company.stateCode;
    if (group.kind === "sales" && !STATE_CODE_RE.test(placeOfSupply)) throw new Error(`Invoice ${group.number}: Customer state code is invalid.`);
    const totals = invoiceTotals(
      group.items.map((item) => ({ qty: item.qty, rate: item.rate, gstRate: item.gstRate })),
      group.kind === "sales" ? ctx.company.stateCode : party.stateCode,
      group.kind === "sales" ? placeOfSupply : ctx.company.stateCode,
    );
    return {
      companyId: ctx.company.id, fyId: ctx.fy.id, kind: group.kind, number: group.number, partyId: party.id,
      date: group.date, dueDate: group.dueDate, placeOfSupply, items: group.items,
      taxable: totals.taxable.toFixed(2), cgst: totals.cgst.toFixed(2), sgst: totals.sgst.toFixed(2), igst: totals.igst.toFixed(2),
      total: totals.total.toFixed(2), paid: "0", status: "pending_approval", createdBy: ctx.user.id,
      notes: `Imported from ${fileName.slice(0, 180)}`,
    };
  });
  if (!prepared.length) throw new Error("No invoices found.");

  await db.transaction(async (tx) => {
    await tx.insert(invoices).values(prepared);
    await audit(ctx, "data_import.apply", "data_import", null, { kind: "invoices", rows: prepared.length, lines: rows.length, file: fileName, status: "pending_approval" }, tx);
  });
  return prepared.length;
}

export async function importData(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const ctx = await requireCompany();
    assertCan(ctx, "write");
    if (fd.get("confirm") !== "on") return { error: "Confirm that you reviewed the file and understand imported invoices remain pending approval." };
    const kind = String(fd.get("kind") ?? "") as ImportKind;
    if (kind !== "parties" && kind !== "inventory" && kind !== "invoices") return { error: "Choose an import type." };
    const file = fd.get("file");
    if (!(file instanceof File) || !file.size) return { error: "Choose a CSV or XLSX file." };
    const rows = await readImportRows(kind, file.name, file.type || "application/octet-stream", Buffer.from(await file.arrayBuffer()));
    const count = kind === "parties"
      ? await importParties(ctx, rows, file.name)
      : kind === "inventory"
        ? await importInventory(ctx, rows, file.name)
        : await importInvoices(ctx, rows, file.name);
    revalidatePath("/imports");
    revalidatePath("/receivables");
    revalidatePath("/payables");
    revalidatePath("/accounting");
    revalidatePath("/tax");
    return { ok: `Imported ${count} ${kind === "parties" ? "parties" : kind === "inventory" ? "inventory items" : "invoices"}. ${kind === "invoices" ? "Invoices await approval; no ledger entries were posted." : "No accounting entries were posted."}` };
  } catch (error) {
    return fail(error);
  }
}
