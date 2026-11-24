"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { adx, aggregate, atr, bollinger, closes, customIndicator, ema, fibonacci, heikinAshi, ichimoku, macd, rsi, signals, sma, stochastic, supportResistance, vwap, type Candle, type Series } from "@/engines/technical";
import { saveChartTemplate, deleteChartTemplate, createAlert } from "@/actions/invest";
import ActionForm from "@/components/ActionForm";

type Hist = { status: string; candles: Candle[]; provider: string; asOf: string; note?: string };
type Draw = { kind: "trend" | "hline" | "fib"; a: { i: number; p: number }; b?: { i: number; p: number } };
type Cfg = { chartType: string; tf: string; overlays: string[]; panels: string[]; volume: boolean; bars: number; custom: string };
const DEF: Cfg = { chartType: "candle", tf: "D", overlays: ["sma20", "sma50"], panels: ["rsi"], volume: true, bars: 130, custom: "" };
const OVERLAYS: [string, string][] = [["sma20", "SMA 20"], ["sma50", "SMA 50"], ["ema20", "EMA 20"], ["bb", "Bollinger"], ["vwap", "VWAP"], ["ichi", "Ichimoku"], ["sr", "Support/Resistance"]];
const PANELS: [string, string][] = [["rsi", "RSI"], ["macd", "MACD"], ["stoch", "Stochastic"], ["atr", "ATR"], ["adx", "ADX"], ["custom", "Custom"]];
const W = 900, PH = 300, VH = 54, SH = 84, L = 8, R = 56;

function Chart({ symbol, cfg, templates }: { symbol: string; cfg: Cfg; templates?: never }) {
  void templates;
  return <ChartForSymbol key={symbol} symbol={symbol} cfg={cfg} />;
}

function ChartForSymbol({ symbol, cfg }: { symbol: string; cfg: Cfg }) {
  const [h, setH] = useState<Hist | null>(null); const [draws, setDraws] = useState<Draw[]>([]); const [tool, setTool] = useState<string>(""); const [pend, setPend] = useState<Draw | null>(null); const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/market/history?symbol=${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((history: Hist) => { if (!cancelled) setH(history); })
      .catch(() => { if (!cancelled) setH({ status: "unavailable", candles: [], provider: "", asOf: "", note: "Request failed" }); });
    return () => { cancelled = true; };
  }, [symbol]);
  const calc = useMemo(() => {
    if (!h?.candles.length) return null;
    const base = aggregate(h.candles, cfg.tf as "D"); const vis = cfg.chartType === "ha" ? heikinAshi(base) : base; const cl = closes(base);
    const n = Math.min(cfg.bars, vis.length); const off = vis.length - n; const sl = (s: Series) => s.slice(off);
    const m = macd(cl), bb = bollinger(cl), st = stochastic(base), ad = adx(base), ic = ichimoku(base), cu = cfg.custom ? customIndicator(cfg.custom, base) : null;
    return { all: base, c: vis.slice(off), off, sig: signals(base), sr: supportResistance(base.slice(off)), sma20: sl(sma(cl, 20)), sma50: sl(sma(cl, 50)), ema20: sl(ema(cl, 20)), bbU: sl(bb.upper), bbM: sl(bb.mid), bbL: sl(bb.lower), vw: sl(vwap(base)), tk: sl(ic.tenkan), kj: sl(ic.kijun), sa: sl(ic.spanA), sb: sl(ic.spanB), rsi: sl(rsi(cl)), mL: sl(m.line), mS: sl(m.signal), mH: sl(m.hist), sk: sl(st.k), sd: sl(st.d), atr: sl(atr(base)), adx: sl(ad.adx), pdi: sl(ad.plusDI), mdi: sl(ad.minusDI), cu: cu ? { s: sl(cu.series), err: cu.error } : null };
  }, [h, cfg]);
  if (!h) return <div className="skeleton h-80" />;
  if (!calc) return <div className="rounded-xl border border-dashed border-line p-8 text-center text-sm text-muted">No data: {h.note ?? "provider unavailable"}</div>;
  const { c } = calc; const n = c.length; const hi = Math.max(...c.map((x) => x.h)), lo = Math.min(...c.map((x) => x.l)); const pad = (hi - lo) * 0.06 || 1; const top = hi + pad, bot = lo - pad;
  const bw = (W - L - R) / n; const X = (i: number) => L + i * bw + bw / 2; const Y = (p: number) => ((top - p) / (top - bot)) * PH;
  const vmax = Math.max(...c.map((x) => x.v), 1); const panels = cfg.panels.filter((p) => p !== "custom" || calc.cu); const total = PH + (cfg.volume ? VH : 0) + panels.length * SH + 22;
  const path = (s: Series, y = Y) => s.map((v, i) => (v === null || v === undefined ? null : `${X(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).map((p, i) => `${i ? "L" : "M"}${p}`).join(" ");
  const up = "var(--up)", dn = "var(--down)";
  const toData = (e: React.MouseEvent) => { const r = ref.current!.getBoundingClientRect(); const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * total; return { i: Math.max(0, Math.min(n - 1, Math.round((x - L - bw / 2) / bw))), p: top - (y / PH) * (top - bot) }; };
  const click = (e: React.MouseEvent) => { if (!tool) return; const d = toData(e); if (tool === "hline") { setDraws([...draws, { kind: "hline", a: d }]); setTool(""); } else if (!pend) setPend({ kind: tool as "trend", a: d }); else { setDraws([...draws, { ...pend, b: d }]); setPend(null); setTool(""); } };
  const fibs = draws.filter((d) => d.kind === "fib" && d.b);
  const sub = (idx: number, label: string, children: React.ReactNode, y0: number, ymin: number, ymax: number) => (<g key={label} transform={`translate(0,${y0})`}><rect x={L} y={0} width={W - L - R} height={SH - 6} fill="none" stroke="var(--line)" /><text x={L + 4} y={11} fontSize="10" fill="var(--muted)">{label}</text><text x={W - R + 4} y={11} fontSize="9" fill="var(--muted)">{ymax.toFixed(1)}</text><text x={W - R + 4} y={SH - 8} fontSize="9" fill="var(--muted)">{ymin.toFixed(1)}</text>{children}</g>);
  const sy = (min: number, max: number) => (v: number) => 4 + (1 - (v - min) / (max - min || 1)) * (SH - 14);
  let yy = PH + 4; const vol0 = yy; if (cfg.volume) yy += VH; const panelY = panels.map((_, i) => yy + i * SH);
  const hv = hover !== null ? c[hover] : c[n - 1];

  return (<div>
    <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px]"><b className="text-sm">{symbol}</b><span className="num text-muted">O {hv.o.toFixed(2)} H {hv.h.toFixed(2)} L {hv.l.toFixed(2)} C {hv.c.toFixed(2)} · Vol {hv.v.toLocaleString("en-IN")} · {hv.t}</span>
      <span className={`rounded px-1.5 py-0.5 font-semibold ${h.status === "live" ? "bg-up/15 text-up" : h.status === "demo" ? "bg-warn/20 text-warn" : "bg-down/15 text-down"}`}>{h.status === "demo" ? "DEMO DATA — synthetic" : h.status === "live" ? `LIVE EOD · ${h.provider}` : "UNAVAILABLE"}</span><span className="text-muted">as of {h.asOf.slice(0, 16).replace("T", " ")}</span>
      <span className="ml-auto flex gap-1">{[["trend", "Trendline"], ["hline", "Horizontal"], ["fib", "Fibonacci"]].map(([k, l]) => <button key={k} className={`btn btn-sm ${tool === k ? "btn-primary" : ""}`} onClick={() => { setTool(tool === k ? "" : k); setPend(null); }}>{l}</button>)}<button className="btn btn-sm" onClick={() => setDraws([])}>Clear</button></span></div>
    <svg ref={ref} viewBox={`0 0 ${W} ${total}`} className={`w-full rounded-lg border border-line bg-panel ${tool ? "cursor-crosshair" : ""}`} onClick={click} onMouseMove={(e) => setHover(toData(e).i)} onMouseLeave={() => setHover(null)} role="img" aria-label={`${symbol} price chart`}>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => { const p = top - f * (top - bot); return <g key={f}><line x1={L} x2={W - R} y1={Y(p)} y2={Y(p)} stroke="var(--line)" strokeDasharray="2 4" /><text x={W - R + 4} y={Y(p) + 3} fontSize="9" fill="var(--muted)">{p.toFixed(2)}</text></g>; })}
      {cfg.overlays.includes("ichi") && <><path d={path(calc.sa)} stroke="#34d399" fill="none" opacity=".6" /><path d={path(calc.sb)} stroke="#f87171" fill="none" opacity=".6" /><path d={path(calc.tk)} stroke="#60a5fa" fill="none" /><path d={path(calc.kj)} stroke="#f59e0b" fill="none" /></>}
      {cfg.overlays.includes("bb") && <><path d={path(calc.bbU)} stroke="#a78bfa" fill="none" /><path d={path(calc.bbM)} stroke="#a78bfa" strokeDasharray="3 3" fill="none" /><path d={path(calc.bbL)} stroke="#a78bfa" fill="none" /></>}
      {cfg.chartType === "line" || cfg.chartType === "area" ? <><path d={path(c.map((x) => x.c))} stroke="var(--accent)" strokeWidth="1.8" fill="none" />{cfg.chartType === "area" && <path d={`${path(c.map((x) => x.c))} L${X(n - 1)},${PH} L${X(0)},${PH} Z`} fill="var(--accent)" opacity=".12" />}</> : c.map((x, i) => { const col = x.c >= x.o ? up : dn; return <g key={i}>
        {cfg.chartType === "bar" ? <rect x={X(i) - bw * 0.35} y={Y(x.c)} width={bw * 0.7} height={Math.max(1, PH - Y(x.c))} fill={col} opacity=".5" /> : cfg.chartType === "ohlc" ? <><line x1={X(i)} x2={X(i)} y1={Y(x.h)} y2={Y(x.l)} stroke={col} /><line x1={X(i) - bw * 0.4} x2={X(i)} y1={Y(x.o)} y2={Y(x.o)} stroke={col} /><line x1={X(i)} x2={X(i) + bw * 0.4} y1={Y(x.c)} y2={Y(x.c)} stroke={col} /></> : <><line x1={X(i)} x2={X(i)} y1={Y(x.h)} y2={Y(x.l)} stroke={col} /><rect x={X(i) - bw * 0.35} y={Math.min(Y(x.o), Y(x.c))} width={bw * 0.7} height={Math.max(1, Math.abs(Y(x.o) - Y(x.c)))} fill={col} /></>}</g>; })}
      {cfg.overlays.includes("sma20") && <path d={path(calc.sma20)} stroke="#fbbf24" fill="none" />}{cfg.overlays.includes("sma50") && <path d={path(calc.sma50)} stroke="#60a5fa" fill="none" />}{cfg.overlays.includes("ema20") && <path d={path(calc.ema20)} stroke="#f472b6" fill="none" />}{cfg.overlays.includes("vwap") && <path d={path(calc.vw)} stroke="#2dd4bf" strokeDasharray="4 2" fill="none" />}
      {cfg.overlays.includes("sr") && calc.sr.map((s, i) => <g key={i}><line x1={L} x2={W - R} y1={Y(s.price)} y2={Y(s.price)} stroke={s.kind === "support" ? up : dn} strokeDasharray="6 3" opacity=".55" /><text x={L + 2} y={Y(s.price) - 2} fontSize="8" fill={s.kind === "support" ? up : dn}>{s.kind[0].toUpperCase()} {s.price.toFixed(1)}</text></g>)}
      {fibs.map((d, k) => fibonacci(Math.max(d.a.p, d.b!.p), Math.min(d.a.p, d.b!.p)).map((f) => <g key={`${k}-${f.ratio}`}><line x1={L} x2={W - R} y1={Y(f.price)} y2={Y(f.price)} stroke="#f59e0b" opacity=".6" strokeDasharray="2 2" /><text x={W - R - 70} y={Y(f.price) - 2} fontSize="8" fill="#f59e0b">{(f.ratio * 100).toFixed(1)}% {f.price.toFixed(2)}</text></g>))}
      {draws.map((d, i) => d.kind === "hline" ? <line key={i} x1={L} x2={W - R} y1={Y(d.a.p)} y2={Y(d.a.p)} stroke="#e879f9" /> : d.kind === "trend" && d.b ? <line key={i} x1={X(d.a.i)} y1={Y(d.a.p)} x2={X(d.b.i)} y2={Y(d.b.p)} stroke="#e879f9" strokeWidth="1.5" /> : null)}
      {pend && <circle cx={X(pend.a.i)} cy={Y(pend.a.p)} r="4" fill="#e879f9" />}
      {hover !== null && <line x1={X(hover)} x2={X(hover)} y1={0} y2={total} stroke="var(--muted)" strokeDasharray="2 3" opacity=".5" />}
      {cfg.volume && <g transform={`translate(0,${vol0})`}>{c.map((x, i) => <rect key={i} x={X(i) - bw * 0.35} y={VH - (x.v / vmax) * (VH - 4)} width={bw * 0.7} height={(x.v / vmax) * (VH - 4)} fill={x.c >= x.o ? up : dn} opacity=".45" />)}<text x={L + 4} y={11} fontSize="10" fill="var(--muted)">Volume</text></g>}
      {panels.map((p, i) => { const y0 = panelY[i];
        if (p === "rsi") { const f = sy(0, 100); return sub(i, "RSI(14)", <><line x1={L} x2={W - R} y1={f(70)} y2={f(70)} stroke={dn} strokeDasharray="3 3" opacity=".5" /><line x1={L} x2={W - R} y1={f(30)} y2={f(30)} stroke={up} strokeDasharray="3 3" opacity=".5" /><path d={path(calc.rsi, f)} stroke="#a78bfa" fill="none" /></>, y0, 0, 100); }
        if (p === "macd") { const all = [...calc.mL, ...calc.mS, ...calc.mH].filter((v): v is number => v !== null); const mn = Math.min(...all), mx = Math.max(...all); const f = sy(mn, mx); return sub(i, "MACD(12,26,9)", <>{calc.mH.map((v, k) => v === null ? null : <rect key={k} x={X(k) - bw * 0.3} y={Math.min(f(0), f(v))} width={bw * 0.6} height={Math.abs(f(v) - f(0))} fill={v >= 0 ? up : dn} opacity=".5" />)}<path d={path(calc.mL, f)} stroke="#60a5fa" fill="none" /><path d={path(calc.mS, f)} stroke="#f59e0b" fill="none" /></>, y0, mn, mx); }
        if (p === "stoch") { const f = sy(0, 100); return sub(i, "Stochastic %K/%D", <><path d={path(calc.sk, f)} stroke="#60a5fa" fill="none" /><path d={path(calc.sd, f)} stroke="#f59e0b" fill="none" /></>, y0, 0, 100); }
        if (p === "atr") { const v = calc.atr.filter((x): x is number => x !== null); const mn = Math.min(...v), mx = Math.max(...v); const f = sy(mn, mx); return sub(i, "ATR(14)", <path d={path(calc.atr, f)} stroke="#2dd4bf" fill="none" />, y0, mn, mx); }
        if (p === "adx") { const f = sy(0, 60); return sub(i, "ADX(14) · +DI · −DI", <><path d={path(calc.adx, f)} stroke="#e5e7eb" fill="none" /><path d={path(calc.pdi, f)} stroke={up} fill="none" /><path d={path(calc.mdi, f)} stroke={dn} fill="none" /></>, y0, 0, 60); }
        const cs = calc.cu!.s; const v = cs.filter((x): x is number => x !== null); if (!v.length) return null; const mn = Math.min(...v), mx = Math.max(...v); const f = sy(mn, mx); return sub(i, `Custom: ${cfg.custom.slice(0, 40)}`, <path d={path(cs, f)} stroke="#f472b6" fill="none" />, y0, mn, mx); })}
    </svg>
    {calc.cu?.err && <p className="mt-1 text-xs text-down" role="alert">Custom indicator: {calc.cu.err}</p>}
    <details className="mt-2 text-xs" open><summary className="cursor-pointer font-semibold">Technical readings — descriptive context, not advice</summary><div className="mt-1 grid gap-1.5 md:grid-cols-2">{calc.sig.map((s) => <div key={s.name} className="rounded-lg border border-line p-2"><div className="flex justify-between"><b>{s.name}</b><span className={s.tone === "bullish" ? "text-up" : s.tone === "bearish" ? "text-down" : "text-muted"}>{s.reading} · {s.tone}</span></div><div className="text-[11px] text-muted">{s.explanation}</div></div>)}</div></details>
  </div>);
}

export default function ChartStudio({ templates, alerts }: { templates: { id: string; name: string; config: Cfg }[]; alerts: { id: string; symbol: string; condition: string; price: string; status: string }[] }) {
  const [cfg, setCfg] = useState<Cfg>(DEF); const [layout, setLayout] = useState(1); const [syms, setSyms] = useState(["RELIANCE.NS", "AAPL", "TCS.NS", "MSFT"]); const [input, setInput] = useState(""); const [tn, setTn] = useState(""); const [pending, start] = useTransition(); const [msg, setMsg] = useState("");
  const tog = (k: "overlays" | "panels", v: string) => setCfg({ ...cfg, [k]: cfg[k].includes(v) ? cfg[k].filter((x) => x !== v) : [...cfg[k], v] });
  return (<div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel p-3 text-xs">
      <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); if (input.trim()) { setSyms([input.trim().toUpperCase(), ...syms.slice(1)]); setInput(""); } }}><input className="inp !w-36" placeholder="Symbol (e.g. AAPL)" value={input} onChange={(e) => setInput(e.target.value)} aria-label="Symbol" /><button className="btn btn-sm">Load</button></form>
      <select className="inp !w-auto" value={cfg.chartType} onChange={(e) => setCfg({ ...cfg, chartType: e.target.value })} aria-label="Chart type">{[["candle", "Candlestick"], ["ohlc", "OHLC"], ["line", "Line"], ["area", "Area"], ["ha", "Heikin Ashi"], ["bar", "Bar"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      <select className="inp !w-auto" value={cfg.tf} onChange={(e) => setCfg({ ...cfg, tf: e.target.value })} aria-label="Timeframe"><option value="D">Daily</option><option value="W">Weekly</option><option value="M">Monthly</option></select>
      <select className="inp !w-auto" value={cfg.bars} onChange={(e) => setCfg({ ...cfg, bars: Number(e.target.value) })} aria-label="Bars">{[60, 130, 250, 400].map((b) => <option key={b} value={b}>{b} bars</option>)}</select>
      <select className="inp !w-auto" value={layout} onChange={(e) => setLayout(Number(e.target.value))} aria-label="Layout"><option value={1}>1 chart</option><option value={2}>2 charts</option><option value={4}>4 charts</option></select>
      <label className="flex items-center gap-1"><input type="checkbox" checked={cfg.volume} onChange={(e) => setCfg({ ...cfg, volume: e.target.checked })} />Volume</label>
      <div className="flex flex-wrap gap-1">{OVERLAYS.map(([k, l]) => <button key={k} className={`btn btn-sm ${cfg.overlays.includes(k) ? "btn-primary" : ""}`} onClick={() => tog("overlays", k)}>{l}</button>)}{PANELS.map(([k, l]) => <button key={k} className={`btn btn-sm ${cfg.panels.includes(k) ? "btn-primary" : ""}`} onClick={() => tog("panels", k)}>{l}</button>)}</div>
      <input className="inp !w-64" placeholder="Custom: sma(close,10) - sma(close,30)" value={cfg.custom} onChange={(e) => setCfg({ ...cfg, custom: e.target.value, panels: e.target.value && !cfg.panels.includes("custom") ? [...cfg.panels, "custom"] : cfg.panels })} aria-label="Custom indicator" />
    </div>
    <div className="flex flex-wrap items-center gap-2 text-xs"><input className="inp !w-44" placeholder="Template name" value={tn} onChange={(e) => setTn(e.target.value)} /><button className="btn btn-sm" disabled={pending} onClick={() => start(async () => { try { await saveChartTemplate(tn, cfg as never); setMsg("Template saved"); setTn(""); } catch (e) { setMsg((e as Error).message); } })}>Save template</button>{templates.map((t) => <span key={t.id} className="flex items-center gap-1 rounded border border-line px-2 py-0.5"><button className="text-accent" onClick={() => setCfg({ ...DEF, ...t.config })}>{t.name}</button><button aria-label="Delete template" onClick={() => start(() => deleteChartTemplate(t.id))}>✕</button></span>)}<span className="text-muted" role="status">{msg}</span></div>
    <div className={`grid gap-4 ${layout > 1 ? "xl:grid-cols-2" : ""}`}>{Array.from({ length: layout }, (_, i) => <Chart key={`${i}-${syms[i]}`} symbol={syms[i]} cfg={cfg} />)}</div>
    {layout > 1 && <div className="flex flex-wrap gap-2 text-xs">{Array.from({ length: layout }, (_, i) => <input key={i} className="inp !w-32" value={syms[i]} aria-label={`Chart ${i + 1} symbol`} onChange={(e) => setSyms(syms.map((s, j) => (j === i ? e.target.value.toUpperCase() : s)))} />)}</div>}
    <div className="grid gap-4 lg:grid-cols-2"><div className="rounded-xl border border-line bg-panel p-4"><h3 className="mb-2 text-sm font-semibold">Price alert</h3><ActionForm cols={3} submit="Create alert" action={createAlert} fields={[{ name: "symbol", label: "Symbol", defaultValue: syms[0], required: true }, { name: "condition", label: "When price is", type: "select", options: [["above", "Above"], ["below", "Below"]] }, { name: "price", label: "Price", type: "number", required: true }]} /></div>
      <div className="rounded-xl border border-line bg-panel p-4 text-xs"><h3 className="mb-2 text-sm font-semibold">Your alerts</h3>{alerts.length === 0 ? <p className="text-muted">None. Alerts are checked on demand in Markets (no background push).</p> : <ul className="space-y-1">{alerts.map((a) => <li key={a.id} className="flex justify-between"><span>{a.symbol} {a.condition} {a.price}</span><span className="text-muted">{a.status}</span></li>)}</ul>}</div></div>
    <p className="text-[11px] text-muted">Indicators are mathematical transformations of price/volume shown for analysis. They are not investment advice or recommendations. Intraday timeframes require a licensed intraday feed and are not available; weekly/monthly are aggregated from daily bars. VWAP is cumulative over the loaded window.</p>
  </div>);
}
