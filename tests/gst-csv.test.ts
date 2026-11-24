import { describe, expect, it } from "vitest";
import { gstCsv } from "@/services/gst-csv";

describe("gstCsv", () => {
  it("quotes and escapes CSV cells", () => {
    expect(gstCsv([["Invoice", 'ACME, "West"'], ["Note", "line 1\nline 2"]])).toBe(
      '"Invoice","ACME, ""West"""\r\n"Note","line 1\nline 2"',
    );
  });

  it("neutralizes spreadsheet formulas while preserving numeric negatives", () => {
    expect(gstCsv([["=HYPERLINK(\"https://example.test\")", "+SUM(A1:A2)", -125.5]])).toBe(
      "\"'=HYPERLINK(\"\"https://example.test\"\")\",\"'+SUM(A1:A2)\",\"-125.5\"",
    );
  });
});
