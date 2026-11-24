import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { readImportRows } from "@/services/data-import";

describe("structured data imports", () => {
  it("parses quoted CSV cells, normalizes headers, and skips blank rows", async () => {
    const csv = '\uFEFFKind,Name,credit limit\r\ncustomer,"A, B Industries",1000.50\r\n\r\n';
    const rows = await readImportRows("parties", "parties.csv", "text/csv", Buffer.from(csv));

    expect(rows).toEqual([{ line: 2, values: { kind: "customer", name: "A, B Industries", credit_limit: "1000.50" } }]);
  });

  it("rejects malformed or duplicate CSV headers before importing", async () => {
    await expect(readImportRows("parties", "parties.csv", "text/csv", Buffer.from('kind,name,name\ncustomer,Example,Again'))).rejects.toThrow("duplicate column names");
    await expect(readImportRows("parties", "parties.csv", "text/csv", Buffer.from('kind,name,ignored\ncustomer,Example,value'))).rejects.toThrow("Unsupported columns");
    await expect(readImportRows("parties", "parties.csv", "text/csv", Buffer.from('kind,name\ncustomer,"unfinished'))).rejects.toThrow("unterminated quoted field");
  });

  it("reads XLSX worksheets directly and rejects formulas", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Parties");
    sheet.addRow(["kind", "name"]);
    sheet.addRow(["customer", "Example Ltd"]);
    const valid = Buffer.from(await workbook.xlsx.writeBuffer());
    await expect(readImportRows("parties", "parties.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", valid))
      .resolves.toEqual([{ line: 2, values: { kind: "customer", name: "Example Ltd" } }]);

    sheet.getCell("B2").value = { formula: '"A"+1', result: "Example Ltd" };
    const withFormula = Buffer.from(await workbook.xlsx.writeBuffer());
    await expect(readImportRows("parties", "parties.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", withFormula))
      .rejects.toThrow("Formula cells are not allowed");
  });
});
