import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
export const D = (v?: Decimal.Value | null) =>
  new Decimal(v === undefined || v === null || v === "" || (typeof v === "number" && !Number.isFinite(v)) ? 0 : v);
/** Authoritative currency rounding policy: 2dp, half-up. */
export const r2 = (v: Decimal.Value) => D(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
/** Statutory rounding to nearest rupee (e.g. TDS under s.288B). */
export const r0 = (v: Decimal.Value) => D(v).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
export const sum = (xs: Decimal.Value[]) => xs.reduce<Decimal>((a, b) => a.plus(D(b)), D(0));

export type CalcRecord = {
  name: string;
  formula: string;
  inputs: Record<string, unknown>;
  result: unknown;
  assumptions: string[];
  source: string;
  timestamp: string;
};

export function calcRecord(
  name: string, formula: string, inputs: Record<string, unknown>, result: unknown,
  assumptions: string[] = [], source = "FINVANTA deterministic engine",
): CalcRecord {
  return { name, formula, inputs, result, assumptions, source, timestamp: new Date().toISOString() };
}

export const fmtMoney = (v: Decimal.Value | number | null | undefined, cur = "INR") => {
  const n = Number(D(v as Decimal.Value).toFixed(2));
  try {
    return new Intl.NumberFormat(cur === "INR" ? "en-IN" : "en-US", { style: "currency", currency: cur, maximumFractionDigits: 2 }).format(n);
  } catch {
    return n.toFixed(2);
  }
};
export const fmtNum = (v: number | null | undefined, dp = 2) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toLocaleString("en-IN", { maximumFractionDigits: dp, minimumFractionDigits: dp });
export const fmtPct = (v: number | null | undefined, dp = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(dp)}%`;
export const safeDiv = (a: number, b: number): number | null => (b === 0 || !Number.isFinite(a / b) ? null : a / b);
