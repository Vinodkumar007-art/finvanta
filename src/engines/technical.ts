export type Candle = { t: string; o: number; h: number; l: number; c: number; v: number };
export type Series = (number | null)[];

export const closes = (c: Candle[]) => c.map((x) => x.c);

export function sma(xs: Series, n: number): Series {
  return xs.map((_, i) => {
    if (i < n - 1) return null;
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) { const v = xs[j]; if (v === null) return null; s += v; }
    return s / n;
  });
}
export function ema(xs: Series, n: number): Series {
  const k = 2 / (n + 1); const out: Series = []; let prev: number | null = null; let seed: number[] = [];
  xs.forEach((x) => {
    if (x === null) { out.push(null); return; }
    if (prev === null) { seed.push(x); if (seed.length === n) { prev = seed.reduce((a, b) => a + b, 0) / n; out.push(prev); } else out.push(null); }
    else { prev = x * k + prev * (1 - k); out.push(prev); }
  });
  seed = [];
  return out;
}
export function rsi(xs: number[], n = 14): Series {
  const out: Series = xs.map(() => null); if (xs.length <= n) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = xs[i] - xs[i - 1]; if (d >= 0) g += d; else l -= d; }
  g /= n; l /= n; out[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < xs.length; i++) {
    const d = xs[i] - xs[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}
export function macd(xs: number[], fast = 12, slow = 26, signal = 9) {
  const ef = ema(xs, fast), es = ema(xs, slow);
  const line: Series = xs.map((_, i) => (ef[i] !== null && es[i] !== null ? (ef[i] as number) - (es[i] as number) : null));
  const sig = ema(line, signal);
  const hist: Series = line.map((v, i) => (v !== null && sig[i] !== null ? v - (sig[i] as number) : null));
  return { line, signal: sig, hist };
}
export function bollinger(xs: number[], n = 20, k = 2) {
  const mid = sma(xs, n);
  const upper: Series = [], lower: Series = [];
  xs.forEach((_, i) => {
    const m = mid[i]; if (m === null) { upper.push(null); lower.push(null); return; }
    let s = 0; for (let j = i - n + 1; j <= i; j++) s += (xs[j] - m) ** 2;
    const sd = Math.sqrt(s / n); upper.push(m + k * sd); lower.push(m - k * sd);
  });
  return { mid, upper, lower };
}
export function vwap(c: Candle[]): Series {
  let pv = 0, v = 0; // cumulative over the loaded window (session reset not applicable to daily data)
  return c.map((x) => { const tp = (x.h + x.l + x.c) / 3; pv += tp * x.v; v += x.v; return v ? pv / v : null; });
}
const trueRange = (c: Candle[]) => c.map((x, i) => (i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - c[i - 1].c), Math.abs(x.l - c[i - 1].c))));
function wilder(xs: number[], n: number): Series {
  const out: Series = xs.map(() => null); if (xs.length < n) return out;
  let s = xs.slice(0, n).reduce((a, b) => a + b, 0) / n; out[n - 1] = s;
  for (let i = n; i < xs.length; i++) { s = (s * (n - 1) + xs[i]) / n; out[i] = s; }
  return out;
}
export function atr(c: Candle[], n = 14): Series { return wilder(trueRange(c), n); }
export function adx(c: Candle[], n = 14) {
  const plus: number[] = [0], minus: number[] = [0];
  for (let i = 1; i < c.length; i++) {
    const up = c[i].h - c[i - 1].h, dn = c[i - 1].l - c[i].l;
    plus.push(up > dn && up > 0 ? up : 0); minus.push(dn > up && dn > 0 ? dn : 0);
  }
  const a = atr(c, n), p = wilder(plus, n), m = wilder(minus, n);
  const pdi: Series = [], mdi: Series = [], dx: number[] = [];
  c.forEach((_, i) => {
    if (a[i] === null || p[i] === null || m[i] === null || !a[i]) { pdi.push(null); mdi.push(null); dx.push(0); return; }
    const pi = (100 * (p[i] as number)) / (a[i] as number), mi = (100 * (m[i] as number)) / (a[i] as number);
    pdi.push(pi); mdi.push(mi); dx.push(pi + mi === 0 ? 0 : (100 * Math.abs(pi - mi)) / (pi + mi));
  });
  const start = dx.findIndex((_, i) => pdi[i] !== null);
  const adxLine: Series = c.map(() => null);
  if (start >= 0 && c.length >= start + n) {
    let s = dx.slice(start, start + n).reduce((x, y) => x + y, 0) / n; adxLine[start + n - 1] = s;
    for (let i = start + n; i < c.length; i++) { s = (s * (n - 1) + dx[i]) / n; adxLine[i] = s; }
  }
  return { adx: adxLine, plusDI: pdi, minusDI: mdi };
}
export function stochastic(c: Candle[], k = 14, d = 3) {
  const kk: Series = c.map((x, i) => {
    if (i < k - 1) return null;
    const w = c.slice(i - k + 1, i + 1); const hh = Math.max(...w.map((y) => y.h)), ll = Math.min(...w.map((y) => y.l));
    return hh === ll ? 50 : (100 * (x.c - ll)) / (hh - ll);
  });
  return { k: kk, d: sma(kk, d) };
}
export function ichimoku(c: Candle[], tenkan = 9, kijun = 26, senkouB = 52) {
  const mid = (i: number, n: number) => { if (i < n - 1) return null; const w = c.slice(i - n + 1, i + 1); return (Math.max(...w.map((y) => y.h)) + Math.min(...w.map((y) => y.l))) / 2; };
  const t = c.map((_, i) => mid(i, tenkan)), k = c.map((_, i) => mid(i, kijun)), b = c.map((_, i) => mid(i, senkouB));
  const spanA: Series = c.map((_, i) => (t[i] !== null && k[i] !== null ? ((t[i] as number) + (k[i] as number)) / 2 : null));
  // Spans are plotted kijun periods ahead: shift forward
  const shift = (s: Series): Series => [...Array(kijun).fill(null), ...s].slice(0, c.length);
  return { tenkan: t, kijun: k, spanA: shift(spanA), spanB: shift(b) };
}
export function heikinAshi(c: Candle[]): Candle[] {
  const out: Candle[] = [];
  c.forEach((x, i) => {
    const hc = (x.o + x.h + x.l + x.c) / 4;
    const ho = i === 0 ? (x.o + x.c) / 2 : (out[i - 1].o + out[i - 1].c) / 2;
    out.push({ t: x.t, o: ho, c: hc, h: Math.max(x.h, ho, hc), l: Math.min(x.l, ho, hc), v: x.v });
  });
  return out;
}
export function fibonacci(high: number, low: number) {
  return [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map((r) => ({ ratio: r, price: high - (high - low) * r }));
}
export function aggregate(c: Candle[], tf: "D" | "W" | "M"): Candle[] {
  if (tf === "D") return c;
  const keyOf = (t: string) => {
    const d = new Date(t + "T00:00:00Z");
    if (tf === "M") return t.slice(0, 7);
    const day = (d.getUTCDay() + 6) % 7; const monday = new Date(d.getTime() - day * 86400000);
    return monday.toISOString().slice(0, 10);
  };
  const out: Candle[] = []; let curKey = "";
  c.forEach((x) => {
    const k = keyOf(x.t);
    if (k !== curKey) { out.push({ ...x }); curKey = k; }
    else { const l = out[out.length - 1]; l.h = Math.max(l.h, x.h); l.l = Math.min(l.l, x.l); l.c = x.c; l.v += x.v; }
  });
  return out;
}
export function supportResistance(c: Candle[], lookback = 5, max = 4) {
  const lv: { price: number; kind: "support" | "resistance" }[] = [];
  for (let i = lookback; i < c.length - lookback; i++) {
    const w = c.slice(i - lookback, i + lookback + 1);
    if (c[i].h === Math.max(...w.map((x) => x.h))) lv.push({ price: c[i].h, kind: "resistance" });
    if (c[i].l === Math.min(...w.map((x) => x.l))) lv.push({ price: c[i].l, kind: "support" });
  }
  return lv.slice(-max * 2);
}

/** Descriptive technical readings — analytical context, NOT investment advice. */
export function signals(c: Candle[]) {
  const cl = closes(c); const n = cl.length - 1; const out: { name: string; reading: string; tone: "bullish" | "bearish" | "neutral"; explanation: string }[] = [];
  if (n < 30) return out;
  const r = rsi(cl)[n], m = macd(cl), s50 = sma(cl, 50)[n], s20 = sma(cl, 20)[n], bb = bollinger(cl), st = stochastic(c), ad = adx(c);
  if (r !== null) out.push({ name: "RSI(14)", reading: r.toFixed(1), tone: r > 70 ? "bearish" : r < 30 ? "bullish" : "neutral", explanation: r > 70 ? "Above 70 is conventionally read as overbought: momentum is stretched, not a sell instruction." : r < 30 ? "Below 30 is conventionally read as oversold: selling momentum is stretched." : "Between 30 and 70: momentum is not at an extreme." });
  const ml = m.line[n], ms = m.signal[n];
  if (ml !== null && ms !== null) out.push({ name: "MACD(12,26,9)", reading: `${ml.toFixed(2)} vs ${ms.toFixed(2)}`, tone: ml > ms ? "bullish" : "bearish", explanation: ml > ms ? "MACD line is above its signal line, indicating positive momentum." : "MACD line is below its signal line, indicating negative momentum." });
  if (s20 !== null && s50 !== null) out.push({ name: "SMA 20/50", reading: `${s20.toFixed(2)} / ${s50.toFixed(2)}`, tone: s20 > s50 ? "bullish" : "bearish", explanation: s20 > s50 ? "Short-term average is above the medium-term average (uptrend structure)." : "Short-term average is below the medium-term average (downtrend structure)." });
  const u = bb.upper[n], lo = bb.lower[n];
  if (u !== null && lo !== null) out.push({ name: "Bollinger(20,2)", reading: `${lo.toFixed(2)} – ${u.toFixed(2)}`, tone: cl[n] > u ? "bearish" : cl[n] < lo ? "bullish" : "neutral", explanation: cl[n] > u ? "Close is above the upper band: price is statistically extended." : cl[n] < lo ? "Close is below the lower band: price is statistically extended downward." : "Price is within its volatility envelope." });
  const k = st.k[n]; if (k !== null) out.push({ name: "Stochastic %K", reading: k.toFixed(1), tone: k > 80 ? "bearish" : k < 20 ? "bullish" : "neutral", explanation: "Position of the close within the recent high-low range; >80 high end, <20 low end." });
  const a = ad.adx[n]; if (a !== null) out.push({ name: "ADX(14)", reading: a.toFixed(1), tone: "neutral", explanation: a > 25 ? "ADX above 25 suggests a trending market (direction given by +DI vs −DI)." : "ADX below 25 suggests a weak or range-bound trend." });
  return out;
}

/** Safe expression evaluator for custom indicators, e.g. "sma(close,10) - sma(close,30)". No eval(). */
export function customIndicator(expr: string, c: Candle[]): { series: Series; error?: string } {
  const env: Record<string, number[]> = { close: c.map((x) => x.c), open: c.map((x) => x.o), high: c.map((x) => x.h), low: c.map((x) => x.l), volume: c.map((x) => x.v) };
  const tokens = expr.match(/[A-Za-z_]+|\d+\.?\d*|[()+\-*/,]/g);
  if (!tokens || tokens.join("").length < expr.replace(/\s/g, "").length) return { series: [], error: "Unsupported characters in expression." };
  let pos = 0;
  type V = Series | number;
  const toSeries = (v: V): Series => (typeof v === "number" ? c.map(() => v) : v);
  const bin = (a: V, b: V, f: (x: number, y: number) => number): V => {
    if (typeof a === "number" && typeof b === "number") return f(a, b);
    const A = toSeries(a), B = toSeries(b); return A.map((x, i) => (x === null || B[i] === null ? null : f(x, B[i] as number)));
  };
  const fns: Record<string, (args: V[]) => V> = {
    sma: ([s, n]) => sma(toSeries(s), Number(n)), ema: ([s, n]) => ema(toSeries(s), Number(n)),
    rsi: ([s, n]) => rsi(toSeries(s).map((x) => x ?? 0), Number(n ?? 14)),
    abs: ([s]) => toSeries(s).map((x) => (x === null ? null : Math.abs(x))),
    max: ([a, b]) => bin(a, b, Math.max), min: ([a, b]) => bin(a, b, Math.min),
  };
  const expr_ = (): V => { let l = term(); while (tokens[pos] === "+" || tokens[pos] === "-") { const op = tokens[pos++]; const r = term(); l = bin(l, r, op === "+" ? (x, y) => x + y : (x, y) => x - y); } return l; };
  const term = (): V => { let l = factor(); while (tokens[pos] === "*" || tokens[pos] === "/") { const op = tokens[pos++]; const r = factor(); l = bin(l, r, op === "*" ? (x, y) => x * y : (x, y) => (y === 0 ? NaN : x / y)); } return l; };
  const factor = (): V => {
    const t = tokens[pos++];
    if (t === undefined) throw new Error("Unexpected end of expression");
    if (t === "(") { const v = expr_(); if (tokens[pos++] !== ")") throw new Error("Missing )"); return v; }
    if (t === "-") return bin(0, factor(), (x, y) => x - y);
    if (/^\d/.test(t)) return parseFloat(t);
    if (env[t]) return env[t];
    if (fns[t]) {
      if (tokens[pos++] !== "(") throw new Error(`${t} needs arguments`);
      const args: V[] = []; if (tokens[pos] !== ")") { args.push(expr_()); while (tokens[pos] === ",") { pos++; args.push(expr_()); } }
      if (tokens[pos++] !== ")") throw new Error("Missing )");
      return fns[t](args);
    }
    throw new Error(`Unknown name '${t}'`);
  };
  try {
    const v = expr_(); if (pos < tokens.length) throw new Error("Unexpected token " + tokens[pos]);
    return { series: toSeries(v).map((x) => (x === null || !Number.isFinite(x) ? null : x)) };
  } catch (e) { return { series: [], error: (e as Error).message }; }
}

/** Deterministic synthetic OHLCV — ONLY used for clearly-labelled DEMO data. */
export function demoCandles(symbol: string, n = 400): Candle[] {
  let seed = 0; for (const ch of symbol) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let price = 80 + rnd() * 400; const out: Candle[] = [];
  const day = new Date(); day.setUTCDate(day.getUTCDate() - Math.floor(n * 1.45)); const trend = (rnd() - 0.45) * 0.0012;
  while (out.length < n) {
    day.setUTCDate(day.getUTCDate() + 1); const wd = day.getUTCDay(); if (wd === 0 || wd === 6) continue;
    const o = price; const ch = trend + (rnd() - 0.5) * 0.03; const c = Math.max(1, o * (1 + ch));
    const h = Math.max(o, c) * (1 + rnd() * 0.01), l = Math.min(o, c) * (1 - rnd() * 0.01);
    out.push({ t: day.toISOString().slice(0, 10), o, h, l, c, v: Math.round(100000 + rnd() * 900000) }); price = c;
  }
  return out;
}
