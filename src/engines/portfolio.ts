import { D, Decimal } from "./core";

export type Tx = { symbol: string; name?: string | null; assetClass: string; sector?: string | null; kind: "buy" | "sell" | "dividend"; date: string; qty: number | string; price: number | string; fees: number | string };
type Lot = { date: string; qty: Decimal; cost: Decimal }; // cost per unit incl. fees

export function positions(txs: Tx[], marks: Record<string, number>) {
  const lots: Record<string, Lot[]> = {};
  const meta: Record<string, { name?: string | null; assetClass: string; sector?: string | null }> = {};
  const realised: { symbol: string; date: string; qty: number; proceeds: number; cost: number; pnl: number; months: number; term: "short" | "long" }[] = [];
  const dividends: Record<string, number> = {};
  const errors: string[] = [];
  [...txs].sort((a, b) => a.date.localeCompare(b.date)).forEach((t) => {
    const q = D(t.qty), p = D(t.price), f = D(t.fees);
    meta[t.symbol] = { name: t.name, assetClass: t.assetClass, sector: t.sector };
    lots[t.symbol] ??= [];
    if (t.kind === "buy") lots[t.symbol].push({ date: t.date, qty: q, cost: q.isZero() ? D(0) : p.mul(q).plus(f).div(q) });
    else if (t.kind === "dividend") dividends[t.symbol] = (dividends[t.symbol] ?? 0) + p.mul(q.isZero() ? 1 : q).toNumber();
    else {
      let remaining = q; const feePerUnit = q.isZero() ? D(0) : f.div(q);
      while (remaining.gt(0) && lots[t.symbol].length) {
        const lot = lots[t.symbol][0]; const take = Decimal.min(lot.qty, remaining);
        const cost = take.mul(lot.cost); const proceeds = take.mul(p.minus(feePerUnit));
        const months = Math.floor((Date.parse(t.date) - Date.parse(lot.date)) / (86400000 * 30.4375));
        const eq = ["equity", "etf"].includes(t.assetClass);
        realised.push({ symbol: t.symbol, date: t.date, qty: take.toNumber(), proceeds: proceeds.toNumber(), cost: cost.toNumber(), pnl: proceeds.minus(cost).toNumber(), months, term: months > (eq ? 12 : 24) ? "long" : "short" });
        lot.qty = lot.qty.minus(take); remaining = remaining.minus(take);
        if (lot.qty.isZero()) lots[t.symbol].shift();
      }
      if (remaining.gt(0)) errors.push(`${t.symbol}: sell of ${t.qty} on ${t.date} exceeds holdings (short selling not supported).`);
    }
  });
  const holdings = Object.entries(lots).map(([symbol, ls]) => {
    const qty = ls.reduce((s, l) => s.plus(l.qty), D(0));
    const cost = ls.reduce((s, l) => s.plus(l.qty.mul(l.cost)), D(0));
    const mark = marks[symbol];
    const value = mark !== undefined ? qty.mul(mark) : null;
    return {
      symbol, ...meta[symbol], qty: qty.toNumber(), avgCost: qty.isZero() ? 0 : cost.div(qty).toNumber(), cost: cost.toNumber(),
      price: mark ?? null, value: value?.toNumber() ?? null, unrealised: value ? value.minus(cost).toNumber() : null,
      unrealisedPct: value && !cost.isZero() ? value.minus(cost).div(cost).toNumber() : null, dividends: dividends[symbol] ?? 0,
    };
  }).filter((h) => h.qty > 0);
  return {
    holdings, realised, errors,
    totals: {
      cost: holdings.reduce((s, h) => s + h.cost, 0),
      value: holdings.reduce((s, h) => s + (h.value ?? h.cost), 0),
      unmarked: holdings.filter((h) => h.price === null).map((h) => h.symbol),
      realisedPnl: realised.reduce((s, r) => s + r.pnl, 0),
      dividends: Object.values(dividends).reduce((a, b) => a + b, 0),
    },
  };
}

export function xirr(flows: { date: string; amount: number }[]): number | null {
  if (flows.length < 2 || !flows.some((f) => f.amount > 0) || !flows.some((f) => f.amount < 0)) return null;
  const t0 = Date.parse(flows[0].date);
  const f = (r: number) => flows.reduce((s, c) => s + c.amount / Math.pow(1 + r, (Date.parse(c.date) - t0) / (365 * 86400000)), 0);
  let lo = -0.9999, hi = 10;
  if (f(lo) * f(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2; const fm = f(mid);
    if (Math.abs(fm) < 1e-9) return mid;
    if (f(lo) * fm < 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

export function cagr(begin: number, end: number, years: number) {
  if (begin <= 0 || years <= 0 || end < 0) return null;
  return Math.pow(end / begin, 1 / years) - 1;
}

/** Time-weighted return from sub-period values: each period {startValue (after prior flow), endValue, flowAtEnd}. */
export function twr(values: { value: number; flow: number }[]) {
  let acc = 1;
  for (let i = 1; i < values.length; i++) {
    const begin = values[i - 1].value; // value after previous flow
    if (begin === 0) continue;
    const endBefore = values[i].value - values[i].flow; // value before this period's flow
    acc *= endBefore / begin;
  }
  return acc - 1;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const std = (xs: number[]) => { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)); };

export function riskMetrics(returns: number[], opts: { periodsPerYear: number; riskFree: number; benchmark?: number[] }) {
  const ppy = opts.periodsPerYear;
  if (returns.length < 3) return null;
  const rfp = opts.riskFree / ppy;
  const excess = returns.map((r) => r - rfp);
  const vol = std(returns) * Math.sqrt(ppy);
  const sharpe = std(excess) > 0 ? (mean(excess) / std(excess)) * Math.sqrt(ppy) : null;
  const downside = Math.sqrt(mean(excess.map((x) => Math.min(0, x) ** 2)));
  const sortino = downside > 0 ? (mean(excess) / downside) * Math.sqrt(ppy) : null;
  let peak = 1, v = 1, mdd = 0;
  returns.forEach((r) => { v *= 1 + r; peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); });
  const total = v - 1; const years = returns.length / ppy;
  let beta: number | null = null, alpha: number | null = null;
  if (opts.benchmark && opts.benchmark.length === returns.length) {
    const b = opts.benchmark; const mb = mean(b), mr = mean(returns);
    const cov = returns.reduce((s, r, i) => s + (r - mr) * (b[i] - mb), 0) / (returns.length - 1);
    const varB = std(b) ** 2;
    if (varB > 0) {
      beta = cov / varB;
      alpha = (mr - rfp - beta * (mb - rfp)) * ppy; // Jensen's alpha, annualised
    }
  }
  return { total, cagr: years > 0 && v > 0 ? Math.pow(v, 1 / years) - 1 : null, vol, sharpe, sortino, maxDrawdown: mdd, beta, alpha };
}

export function rebalance(current: Record<string, number>, targetPct: Record<string, number>, cash = 0) {
  const total = Object.values(current).reduce((a, b) => a + b, 0) + cash;
  const keys = Array.from(new Set([...Object.keys(current), ...Object.keys(targetPct)]));
  return keys.map((k) => {
    const cur = current[k] ?? 0; const target = ((targetPct[k] ?? 0) / 100) * total;
    return { key: k, current: cur, currentPct: total ? cur / total : 0, targetPct: (targetPct[k] ?? 0) / 100, target, trade: target - cur };
  });
}
