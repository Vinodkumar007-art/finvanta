import { describe, expect, it } from "vitest";
import { buildFredMacroIndicators } from "@/services/market";

describe("FRED macro indicators", () => {
  it("uses the latest valid observations and calculates CPI inflation year over year", () => {
    const indicators = buildFredMacroIndicators({
      A191RL1Q225SBEA: [{ date: "2025-03-01", value: "2.4" }],
      CPIAUCSL: [
        { date: "2025-03-01", value: "310.0" },
        { date: "2024-03-01", value: "300.0" },
        { date: "2025-04-01", value: "." },
      ],
      UNRATE: [
        { date: "2025-04-01", value: "." },
        { date: "2025-03-01", value: "4.1" },
      ],
      FEDFUNDS: [{ date: "2025-04-01", value: "4.3" }],
    });

    expect(indicators).toEqual([
      { label: "Real GDP growth (annualized)", value: "2.4%", period: "2025-03-01" },
      { label: "CPI inflation (year over year)", value: "3.3%", period: "2025-03-01" },
      { label: "Unemployment rate", value: "4.1%", period: "2025-03-01" },
      { label: "Federal funds rate", value: "4.3%", period: "2025-04-01" },
    ]);
  });

  it("marks indicators unavailable when observations are missing or invalid", () => {
    const indicators = buildFredMacroIndicators({
      CPIAUCSL: [{ date: "2025-03-01", value: "310.0" }],
      UNRATE: [{ date: "2025-03-01", value: "." }],
    });

    expect(indicators.map(({ value, period }) => [value, period])).toEqual([
      ["Unavailable", "—"],
      ["Unavailable", "2025-03-01"],
      ["Unavailable", "—"],
      ["Unavailable", "—"],
    ]);
  });
});
