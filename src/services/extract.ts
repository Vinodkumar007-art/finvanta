import ExcelJS from "exceljs";

export const ALLOWED_MIME: Record<string, string[]> = {
  pdf: ["application/pdf"], csv: ["text/csv", "application/vnd.ms-excel", "text/plain"], txt: ["text/plain"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], png: ["image/png"], jpg: ["image/jpeg"], jpeg: ["image/jpeg"],
};
export const MAX_UPLOAD = 8 * 1024 * 1024;

export function validateUpload(name: string, mime: string, size: number, head: Buffer) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (size > MAX_UPLOAD) return "File exceeds the 8 MB limit.";
  if (!ALLOWED_MIME[ext]) return `Unsupported file type .${ext}. Allowed: ${Object.keys(ALLOWED_MIME).join(", ")}.`;
  if (!ALLOWED_MIME[ext].includes(mime) && mime !== "application/octet-stream") return `MIME type ${mime} does not match .${ext}.`;
  const sig = head.subarray(0, 8);
  if (ext === "pdf" && sig.subarray(0, 4).toString() !== "%PDF") return "File content is not a valid PDF.";
  if (ext === "xlsx" && !(sig[0] === 0x50 && sig[1] === 0x4b)) return "File content is not a valid XLSX workbook.";
  if (ext === "png" && sig[0] !== 0x89) return "File content is not a valid PNG.";
  if ((ext === "jpg" || ext === "jpeg") && !(sig[0] === 0xff && sig[1] === 0xd8)) return "File content is not a valid JPEG.";
  return null;
}

export async function extractText(buf: Buffer, name: string): Promise<{ text: string; needsOcr: boolean; note?: string }> {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "csv" || ext === "txt") return { text: buf.toString("utf8"), needsOcr: false };
  if (ext === "xlsx") {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const parts: string[] = [];
    wb.eachSheet((ws) => {
      parts.push(`## Sheet: ${ws.name}`);
      ws.eachRow((row) => {
        const vals = (row.values as unknown[]).slice(1).map((v) => (v && typeof v === "object" && "result" in (v as object) ? String((v as { result: unknown }).result) : v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "")));
        parts.push(vals.join(","));
      });
    });
    return { text: parts.join("\n"), needsOcr: false };
  }
  if (ext === "pdf") {
    try {
      const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text } = await pdfText(pdf, { mergePages: true });
      const t = Array.isArray(text) ? text.join("\n") : text;
      if (t.trim().length < 20) return { text: "", needsOcr: true, note: "No text layer found — this looks like a scanned PDF. OCR provider is not configured." };
      return { text: t, needsOcr: false };
    } catch {
      return { text: "", needsOcr: true, note: "PDF text extraction failed." };
    }
  }
  return { text: "", needsOcr: true, note: "Images require an OCR provider, which is not configured on this deployment." };
}

/** Minimal CSV parser (quotes, commas, newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); if (row.some((x) => x.trim() !== "")) rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

/** Rule-based field extraction & classification for financial documents. Output is a SUGGESTION requiring human confirmation. */
export function classifyAndExtract(text: string, name: string) {
  const t = text.toLowerCase();
  const scores: [string, number][] = [
    ["invoice", +/tax invoice|invoice no|invoice number|bill to/.test(t) * 3 + +/gstin/.test(t)],
    ["receipt", +/receipt|received with thanks/.test(t) * 3],
    ["bank_statement", +/opening balance|closing balance|narration|withdrawal|deposit|ifsc/.test(t) * 2 + +/statement of account/.test(t) * 2],
    ["gst_return", +/gstr-?1|gstr-?3b|gstr-?2b|return period/.test(t) * 4],
    ["purchase_order", +/purchase order|p\.?o\.? no/.test(t) * 4],
    ["credit_note", +/credit note/.test(t) * 4], ["debit_note", +/debit note/.test(t) * 4],
    ["tax_document", +/form 16|form 26as|tds certificate|income tax/.test(t) * 3],
    ["audit_report", +/independent auditor|key audit matters|opinion/.test(t) * 3],
    ["financial_statement", +/balance sheet|statement of profit|cash flow statement/.test(t) * 3],
    ["annual_report", +/annual report|directors' report|management discussion/.test(t) * 3],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  const docType = scores[0][1] > 0 ? scores[0][0] : "unclassified";
  const pick = (re: RegExp) => re.exec(text)?.[1]?.trim();
  const amountRaw = pick(/(?:grand\s+total|total\s+amount|amount\s+payable|invoice\s+total|net\s+payable|total)\s*[:\-]?\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d{1,2})?)/i);
  const taxableRaw = pick(/(?:taxable\s+(?:value|amount))\s*[:\-]?\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d{1,2})?)/i);
  const fields = {
    invoiceNumber: pick(/(?:invoice\s*(?:no\.?|number|#)|bill\s*no\.?)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\/\-]{2,})/i),
    date: pick(/(?:invoice\s*date|date)\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}-\d{2}-\d{2})/i),
    gstin: pick(/\b(\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z])\b/),
    pan: pick(/\b([A-Z]{5}\d{4}[A-Z])\b/),
    taxable: taxableRaw?.replace(/,/g, ""),
    total: amountRaw?.replace(/,/g, ""),
    cgst: pick(/cgst[^\d\n]{0,20}([\d,]+(?:\.\d{1,2})?)/i)?.replace(/,/g, ""),
    sgst: pick(/sgst[^\d\n]{0,20}([\d,]+(?:\.\d{1,2})?)/i)?.replace(/,/g, ""),
    igst: pick(/igst[^\d\n]{0,20}([\d,]+(?:\.\d{1,2})?)/i)?.replace(/,/g, ""),
  };
  const issues: string[] = [];
  if (docType === "invoice") {
    if (!fields.invoiceNumber) issues.push("Invoice number not found");
    if (!fields.total) issues.push("Total amount not found");
    if (fields.taxable && fields.total) {
      const tax = ["cgst", "sgst", "igst"].reduce((s, k) => s + Number((fields as Record<string, string | undefined>)[k] ?? 0), 0);
      if (Math.abs(Number(fields.taxable) + tax - Number(fields.total)) > 1) issues.push("Taxable + taxes does not equal total");
    }
  }
  return { docType, fields, issues, confidence: scores[0][1] >= 3 ? "medium" : "low", file: name };
}
