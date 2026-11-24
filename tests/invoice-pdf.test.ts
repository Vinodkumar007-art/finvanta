import { describe, expect, it } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";
import { createInvoicePdf, normalizeInvoicePdfOptions, type InvoicePdfData } from "@/services/invoice-pdf";

const sample: InvoicePdfData = {
  company: {
    name: "Acme Manufacturing Pvt Ltd",
    address: "12 Finance Road, Mumbai",
    gstin: "27ABCDE1234F1Z5",
    pan: "ABCDE1234F",
    stateCode: "27",
    currency: "INR",
  },
  invoice: {
    kind: "sales",
    number: "INV-2026-001",
    date: "2026-11-23",
    dueDate: "2026-12-23",
    placeOfSupply: "27 - Maharashtra",
    items: [{ description: "Consulting service", hsn: "9983", qty: 2, rate: "1250.00", gstRate: 18 }],
    taxable: "2500.00",
    cgst: "225.00",
    sgst: "225.00",
    igst: "0.00",
    total: "2950.00",
    paid: "500.00",
    notes: "Payment due within 30 days.",
  },
  party: { name: "Example Customer", gstin: "27XYZDE6789F1Z2", pan: "XYZDE6789F" },
};

async function textFromPdf(pdf: Uint8Array) {
  const document = await getDocumentProxy(pdf);
  return (await extractText(document, { mergePages: true })).text;
}

describe("invoice PDF options", () => {
  it("keeps classic English as the default and safely defaults invalid options", () => {
    expect(normalizeInvoicePdfOptions(undefined, undefined)).toEqual({ layout: "classic", language: "en" });
    expect(normalizeInvoicePdfOptions("unknown", "fr")).toEqual({ layout: "classic", language: "en" });
    expect(normalizeInvoicePdfOptions("compact", "es")).toEqual({ layout: "compact", language: "es" });
  });

  it("preserves the classic PDF's English content by default", async () => {
    const text = await textFromPdf(createInvoicePdf(sample));
    expect(text).toContain("TAX INVOICE");
    expect(text).toContain("Invoice no: INV-2026-001");
    expect(text).toContain("Description");
    expect(text).toContain("Amount paid");
  });

  it("renders Spanish labels and company profile fields in the branded layout", async () => {
    const pdf = createInvoicePdf(sample, { layout: "branded", language: "es" });
    const text = await textFromPdf(pdf);
    expect(text).toContain("FACTURA DE VENTA");
    expect(text).toContain("Numero de factura: INV-2026-001");
    expect(text).toContain("Descripcion");
    expect(text).toContain("Saldo pendiente");
    expect(text).toContain("Acme Manufacturing Pvt Ltd");
    expect(text).toContain("12 Finance Road, Mumbai");
    expect(text).toContain("GSTIN: 27ABCDE1234F1Z5");
    expect(text).toContain("PAN: ABCDE1234F");
    expect(text).toContain("Estado: 27 - Maharashtra");
    expect(text).toContain("Moneda: INR");
  });

  it("generates a distinct compact layout with currency and purchase labels", async () => {
    const text = await textFromPdf(createInvoicePdf({
      ...sample,
      invoice: { ...sample.invoice, kind: "purchase" },
    }, { layout: "compact", language: "es" }));
    expect(text).toContain("FACTURA DE COMPRA");
    expect(text).toContain("Precio (INR)");
    expect(text).toContain("Proveedor");
  });

  it("formats large rupee amounts without losing paise precision", async () => {
    const text = await textFromPdf(createInvoicePdf({
      ...sample,
      invoice: {
        ...sample.invoice,
        items: [{ description: "Large amount", hsn: "9983", qty: 1, rate: "12345678901234567.89", gstRate: 0 }],
        taxable: "12345678901234567.89",
        cgst: "0.00",
        sgst: "0.00",
        igst: "0.00",
        total: "12345678901234567.89",
        paid: "0.01",
      },
    }));
    expect(text).toContain("12,34,56,78,90,12,34,567.89");
    expect(text).toContain("12,34,56,78,90,12,34,567.88");
  });
});
