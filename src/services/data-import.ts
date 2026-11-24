import ExcelJS from "exceljs";
import { validateUpload } from "@/services/extract";

export type ImportKind = "parties" | "inventory" | "invoices";
export type ImportRow = { line: number; values: Record<string, string> };

const REQUIRED_HEADERS: Record<ImportKind, string[]> = {
  parties: ["kind", "name"],
  inventory: ["sku", "name"],
  invoices: ["kind", "number", "party_name", "date", "due_date", "description", "qty", "rate", "gst_rate"],
};
const ALLOWED_HEADERS: Record<ImportKind, string[]> = {
  parties: ["kind", "name", "gstin", "pan", "email", "phone", "state_code", "credit_limit", "credit_days", "deductee_type"],
  inventory: ["sku", "name", "unit", "hsn", "reorder_level"],
  invoices: ["kind", "number", "party_name", "date", "due_date", "place_of_supply", "description", "qty", "rate", "gst_rate", "hsn", "sku"],
};
const MAX_ROWS = 1000;
const MAX_COLUMNS = 40;

const normalizeHeader = (value: string) => value.trim().replace(/^\uFEFF/, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

function parseImportCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let afterQuote = false;

  const finishCell = () => { row.push(cell); cell = ""; afterQuote = false; };
  const finishRow = () => {
    finishCell();
    if (row.some((value) => value.trim())) rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"' && text[index + 1] === '"') { cell += '"'; index++; }
      else if (character === '"') { inQuotes = false; afterQuote = true; }
      else cell += character;
      continue;
    }
    if (afterQuote && character !== "," && character !== "\r" && character !== "\n" && !/\s/.test(character)) {
      throw new Error("CSV contains unexpected characters after a quoted field.");
    }
    if (character === '"' && !cell && !afterQuote) inQuotes = true;
    else if (character === "," ) finishCell();
    else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index++;
      finishRow();
    } else if (!afterQuote) cell += character;
  }
  if (inQuotes) throw new Error("CSV contains an unterminated quoted field.");
  if (cell || row.length || afterQuote) finishRow();
  return rows;
}

function cellText(value: unknown, line: number, column: number): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    const cell = value as Record<string, unknown>;
    if ("formula" in cell || "sharedFormula" in cell) throw new Error(`Formula cells are not allowed (row ${line}, column ${column}). Paste calculated values before importing.`);
    if (Array.isArray(cell.richText)) {
      return cell.richText.map((part) => typeof part === "object" && part !== null && "text" in part ? String((part as { text: unknown }).text) : "").join("");
    }
    if ("text" in cell) return String(cell.text ?? "");
  }
  throw new Error(`Unsupported spreadsheet cell value at row ${line}, column ${column}.`);
}

async function readMatrix(name: string, mime: string, buffer: Buffer): Promise<string[][]> {
  const validationError = validateUpload(name, mime, buffer.byteLength, buffer);
  if (validationError) throw new Error(validationError);
  const extension = name.split(".").pop()?.toLowerCase();
  if (extension === "csv") return parseImportCsv(buffer.toString("utf8").replace(/^\uFEFF/, ""));
  if (extension !== "xlsx") throw new Error("Choose a CSV or XLSX file.");

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheets = workbook.worksheets.filter((sheet) => sheet.rowCount > 0);
  if (sheets.length !== 1) throw new Error("XLSX imports must contain exactly one non-empty worksheet.");
  const rows: string[][] = [];
  sheets[0].eachRow({ includeEmpty: false }, (row, line) => {
    if (row.cellCount > MAX_COLUMNS) throw new Error(`Row ${line} exceeds the ${MAX_COLUMNS}-column limit.`);
    rows.push(Array.from({ length: row.cellCount }, (_, index) => cellText(row.getCell(index + 1).value, line, index + 1)));
  });
  return rows;
}

export async function readImportRows(kind: ImportKind, name: string, mime: string, buffer: Buffer): Promise<ImportRow[]> {
  const matrix = await readMatrix(name, mime, buffer);
  if (!matrix.length) throw new Error("The file is empty.");
  const required = REQUIRED_HEADERS[kind];
  const headerIndex = matrix.findIndex((row) => {
    const headers = row.map(normalizeHeader);
    return required.every((header) => headers.includes(header));
  });
  if (headerIndex < 0) throw new Error(`Could not find a header row containing: ${required.join(", ")}.`);
  const headers = matrix[headerIndex].map(normalizeHeader);
  if (headers.length > MAX_COLUMNS) throw new Error(`The file exceeds the ${MAX_COLUMNS}-column limit.`);
  if (new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length) throw new Error("The file contains duplicate column names.");
  const unknown = headers.filter((header) => header && !ALLOWED_HEADERS[kind].includes(header));
  if (unknown.length) throw new Error(`Unsupported columns for ${kind}: ${unknown.join(", ")}.`);
  const rows: ImportRow[] = [];

  for (let index = headerIndex + 1; index < matrix.length; index++) {
    const row = matrix[index];
    if (!row.some((value) => value.trim())) continue;
    if (rows.length >= MAX_ROWS) throw new Error(`The file exceeds the ${MAX_ROWS}-row limit.`);
    if (row.length > headers.length && row.slice(headers.length).some((value) => value.trim())) {
      throw new Error(`Row ${index + 1} has values beyond the header columns.`);
    }
    if (headers.some((header, column) => !header && row[column]?.trim())) {
      throw new Error(`Row ${index + 1} contains data under a blank column header.`);
    }
    const values: Record<string, string> = {};
    headers.forEach((header, column) => { if (header) values[header] = (row[column] ?? "").trim(); });
    rows.push({ line: index + 1, values });
  }

  if (!rows.length) throw new Error("No data rows found below the header.");
  return rows;
}
