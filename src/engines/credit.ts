import { D, r2 } from "./core";
import { computeRatios, derive, type Stmt } from "./ratios";

export function emi(principal: number | string, annualRatePct: number, months: number) {
  const P = D(principal), r = D(annualRatePct).div(1200);
  if (months <= 0) return D(0);
  if (r.isZero()) return r2(P.div(months));
  const f = r.plus(1).pow(months);
  return r2(P.mul(r).mul(f).div(f.minus(1)));
}

export function amortisation(principal: number | string, annualRatePct: number, months: number) {
  const r = D(annualRatePct).div(1200); const pay = emi(principal, annualRatePct, months);
  let bal = D(principal); const rows: { n: number; payment: string; interest: string; principal: string; balance: string }[] = [];
  for (let n = 1; n <= months; n++) {
    const interest = r2(bal.mul(r));
    let prin = pay.minus(interest);
    let payment = pay;
    if (n === months) { prin = bal; payment = prin.plus(interest); } // final instalment clears rounding residue
    bal = bal.minus(prin);
    rows.push({ n, payment: payment.toFixed(2), interest: interest.toFixed(2), principal: prin.toFixed(2), balance: bal.toFixed(2) });
  }
  const totalInterest = rows.reduce((s, x) => s.plus(x.interest), D(0));
  return { emi: pay, rows, totalInterest, totalPaid: D(principal).plus(totalInterest) };
}

export type CreditAssessment = ReturnType<typeof assessCredit>;
/** Explainable, illustrative scorecard. Bands are configurable assumptions — not a credit decision. */
export function assessCredit(s: Stmt, loan?: { amount: number; ratePct: number; months: number }) {
  const d = derive(s); const r = Object.fromEntries(computeRatios(s).map((x) => [x.key, x.value]));
  const proposedAnnualDebtService = loan ? Number(emi(loan.amount, loan.ratePct, loan.months)) * 12 : 0;
  const cashAvailable = d.ebitda - (s.tax ?? 0);
  const existingService = (s.interest ?? 0) + (s.shortDebt ?? 0);
  const dscrPost = existingService + proposedAnnualDebtService > 0 ? cashAvailable / (existingService + proposedAnnualDebtService) : null;
  const band = (v: number | null | undefined, bands: [number, number][], higherBetter = true) => {
    if (v === null || v === undefined) return 0;
    for (const [lim, pts] of bands) if (higherBetter ? v >= lim : v <= lim) return pts;
    return 0;
  };
  const comps = [
    { factor: "Liquidity — current ratio", weight: 20, value: r.cr, points: band(r.cr, [[2, 20], [1.5, 16], [1.2, 12], [1, 6]]), rule: "≥2.0:20 · ≥1.5:16 · ≥1.2:12 · ≥1.0:6" },
    { factor: "Leverage — debt/equity", weight: 20, value: r.de, points: band(r.de, [[0.5, 20], [1, 16], [2, 10], [3, 4]], false), rule: "≤0.5:20 · ≤1:16 · ≤2:10 · ≤3:4" },
    { factor: "Coverage — interest cover", weight: 20, value: r.icr, points: band(r.icr, [[6, 20], [4, 16], [2.5, 12], [1.5, 6]]), rule: "≥6:20 · ≥4:16 · ≥2.5:12 · ≥1.5:6" },
    { factor: "Profitability — net margin", weight: 15, value: r.npm, points: band(r.npm, [[0.1, 15], [0.05, 11], [0.02, 7], [0, 3]]), rule: "≥10%:15 · ≥5%:11 · ≥2%:7 · ≥0%:3" },
    { factor: "Repayment capacity — DSCR (post-loan)", weight: 25, value: dscrPost ?? r.dscr, points: band(dscrPost ?? r.dscr, [[2, 25], [1.5, 20], [1.25, 15], [1, 8]]), rule: "≥2:25 · ≥1.5:20 · ≥1.25:15 · ≥1:8" },
  ];
  const score = comps.reduce((a, c) => a + c.points, 0);
  const grade = score >= 80 ? "A — Low risk" : score >= 65 ? "B — Moderate risk" : score >= 50 ? "C — Elevated risk" : score >= 35 ? "D — High risk" : "E — Very high risk";
  return { comps, score, grade, dscrPost, proposedAnnualDebtService, notice: "Illustrative scorecard computed from the figures supplied. It is decision support, not a credit decision or guarantee." };
}
