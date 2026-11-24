"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Month = { key: string; label: string; revenue: number; expense: number; profit: number };
type Expense = { name: string; value: number };
type MetricKey = "revenue" | "expense" | "profit";
type ChartStyle = "trend" | "columns";
type Period = "fy" | "h1" | "h2" | "q1" | "q2" | "q3" | "q4";

const METRICS: { key: MetricKey; label: string; color: string }[] = [
  { key: "revenue", label: "Revenue", color: "#14b8a6" },
  { key: "expense", label: "Expenses", color: "#f59e0b" },
  { key: "profit", label: "Net result", color: "#60a5fa" },
];

const PERIODS: { key: Period; label: string; start: number; end: number }[] = [
  { key: "fy", label: "Full year", start: 0, end: 12 },
  { key: "h1", label: "H1", start: 0, end: 6 },
  { key: "h2", label: "H2", start: 6, end: 12 },
  { key: "q1", label: "Q1", start: 0, end: 3 },
  { key: "q2", label: "Q2", start: 3, end: 6 },
  { key: "q3", label: "Q3", start: 6, end: 9 },
  { key: "q4", label: "Q4", start: 9, end: 12 },
];

const PALETTE = ["#14b8a6", "#60a5fa", "#f59e0b", "#a78bfa", "#fb7185", "#38bdf8"];
const axis = { stroke: "var(--muted)", fontSize: 11 };
const short = (value: number) => {
  const amount = Math.abs(value);
  if (amount >= 1e7) return `${(value / 1e7).toFixed(1)}Cr`;
  if (amount >= 1e5) return `${(value / 1e5).toFixed(1)}L`;
  if (amount >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return String(Math.round(value));
};

function formatAmount(value: number, currency: string) {
  return `${currency} ${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function ChartTooltip({ active, payload, label, currency }: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string }[];
  label?: string;
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-40 rounded-lg border border-line bg-panel p-3 shadow-xl">
      <div className="mb-2 text-xs font-semibold">{label}</div>
      <div className="space-y-1.5">
        {payload.filter((item) => item.value !== null && item.value !== undefined).map((item) => (
          <div key={item.name} className="flex items-center justify-between gap-5 text-xs">
            <span className="flex items-center gap-2 text-muted"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />{item.name}</span>
            <span className="num font-semibold">{formatAmount(Number(item.value), currency)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MISInteractiveDashboard({ months, expenses, company, financialYear, currency }: {
  months: Month[];
  expenses: Expense[];
  company: string;
  financialYear: string;
  currency: string;
}) {
  const [period, setPeriod] = useState<Period>("fy");
  const [style, setStyle] = useState<ChartStyle>("trend");
  const [visible, setVisible] = useState<MetricKey[]>(["revenue", "expense", "profit"]);
  const [selectedExpense, setSelectedExpense] = useState<string | null>(null);

  const selectedPeriod = PERIODS.find((item) => item.key === period) ?? PERIODS[0];
  const filteredMonths = useMemo(
    () => months.slice(selectedPeriod.start, selectedPeriod.end),
    [months, selectedPeriod],
  );
  const totals = useMemo(() => filteredMonths.reduce(
    (result, month) => ({
      revenue: result.revenue + month.revenue,
      expense: result.expense + month.expense,
      profit: result.profit + month.profit,
    }),
    { revenue: 0, expense: 0, profit: 0 },
  ), [filteredMonths]);
  const topExpenses = useMemo(() => expenses.filter((item) => item.value > 0).slice(0, 6), [expenses]);
  const maxExpense = Math.max(0, ...topExpenses.map((item) => item.value));
  const bestMonth = filteredMonths.reduce<Month | null>((best, month) => !best || month.revenue > best.revenue ? month : best, null);
  const profitableMonths = filteredMonths.filter((month) => month.profit > 0).length;
  const noActivity = filteredMonths.every((month) => month.revenue === 0 && month.expense === 0);

  const toggleMetric = (key: MetricKey) => {
    setVisible((current) => {
      if (!current.includes(key)) return [...current, key];
      return current.length > 1 ? current.filter((item) => item !== key) : current;
    });
  };

  return (
    <section className="space-y-4" aria-label="Interactive executive MIS dashboard">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">Executive overview</div>
          <h2 className="mt-1 text-lg font-semibold tracking-tight">{company}</h2>
          <p className="text-xs text-muted">{financialYear} · Ledger-derived actuals · {currency}</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-line bg-panel p-1" role="group" aria-label="Chart display">
          <button type="button" className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${style === "trend" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-fg"}`} aria-pressed={style === "trend"} onClick={() => setStyle("trend")}>Trend</button>
          <button type="button" className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${style === "columns" ? "bg-accent text-white shadow-sm" : "text-muted hover:text-fg"}`} aria-pressed={style === "columns"} onClick={() => setStyle("columns")}>Columns</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[
          { key: "revenue", label: "Revenue", value: totals.revenue, color: "text-teal-500", note: "Posted income, selected period" },
          { key: "expense", label: "Expenses", value: totals.expense, color: "text-amber-500", note: "Posted expenses, selected period" },
          { key: "profit", label: "Net result", value: totals.profit, color: totals.profit >= 0 ? "text-up" : "text-down", note: `${profitableMonths} of ${filteredMonths.length} months positive` },
          { key: "margin", label: "Net margin", value: totals.revenue ? totals.profit / totals.revenue : null, color: totals.profit >= 0 ? "text-up" : "text-down", note: "Net result ÷ revenue" },
        ].map((item) => (
          <div key={item.key} className="rounded-xl border border-line bg-panel p-3.5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">{item.label}</span>
              <span className={`h-1.5 w-1.5 rounded-full ${item.key === "revenue" ? "bg-teal-500" : item.key === "expense" ? "bg-amber-500" : item.key === "margin" && totals.revenue ? (totals.profit >= 0 ? "bg-up" : "bg-down") : "bg-blue-400"}`} />
            </div>
            <div className={`num mt-2 truncate text-xl font-semibold ${item.color}`}>
              {item.value === null ? "—" : item.key === "margin" ? `${(item.value * 100).toFixed(1)}%` : formatAmount(item.value, currency)}
            </div>
            <div className="mt-1 text-[10px] text-muted">{item.note}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(280px,0.8fr)]">
        <section className="overflow-hidden rounded-xl border border-line bg-panel shadow-sm">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold">Monthly performance</h3>
              <p className="mt-0.5 text-[11px] text-muted">Hover over a month for exact values; select a period to focus the chart.</p>
            </div>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Reporting period">
              {PERIODS.map((item) => (
                <button key={item.key} type="button" className={`rounded-md px-2.5 py-1.5 text-[11px] font-medium transition ${period === item.key ? "bg-accent/15 text-accent" : "text-muted hover:bg-panel2 hover:text-fg"}`} aria-pressed={period === item.key} onClick={() => setPeriod(item.key)}>{item.label}</button>
              ))}
            </div>
          </header>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-3" role="group" aria-label="Visible chart metrics">
            {METRICS.map((metric) => (
              <button key={metric.key} type="button" className={`inline-flex items-center gap-1.5 text-[11px] transition ${visible.includes(metric.key) ? "text-fg" : "text-muted opacity-60"}`} aria-pressed={visible.includes(metric.key)} onClick={() => toggleMetric(metric.key)}>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: visible.includes(metric.key) ? metric.color : "var(--muted)" }} />
                {metric.label}
              </button>
            ))}
          </div>
          {noActivity ? (
            <div className="grid h-[300px] place-items-center px-6 text-center">
              <div><div className="text-sm font-medium">No posted activity for this period</div><p className="mt-1 text-xs text-muted">The dashboard only charts ledger entries recorded for this financial year.</p></div>
            </div>
          ) : (
            <div className="h-[300px] w-full px-2 pb-3 pt-2">
              <ResponsiveContainer width="100%" height="100%">
                {style === "trend" ? (
                  <ComposedChart data={filteredMonths} margin={{ top: 8, right: 14, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="misRevenueFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#14b8a6" stopOpacity={0.22} /><stop offset="95%" stopColor="#14b8a6" stopOpacity={0.01} /></linearGradient>
                      <linearGradient id="misExpenseFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f59e0b" stopOpacity={0.16} /><stop offset="95%" stopColor="#f59e0b" stopOpacity={0.01} /></linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--line)" strokeDasharray="3 5" vertical={false} />
                    <XAxis dataKey="label" {...axis} tickLine={false} axisLine={false} />
                    <YAxis {...axis} tickFormatter={short} tickLine={false} axisLine={false} width={48} />
                    <Tooltip content={<ChartTooltip currency={currency} />} />
                    <ReferenceLine y={0} stroke="var(--muted)" strokeDasharray="3 4" />
                    {visible.includes("revenue") && <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#14b8a6" fill="url(#misRevenueFill)" strokeWidth={2.5} activeDot={{ r: 5 }} />}
                    {visible.includes("expense") && <Area type="monotone" dataKey="expense" name="Expenses" stroke="#f59e0b" fill="url(#misExpenseFill)" strokeWidth={2} activeDot={{ r: 4 }} />}
                    {visible.includes("profit") && <Line type="monotone" dataKey="profit" name="Net result" stroke="#60a5fa" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />}
                  </ComposedChart>
                ) : (
                  <BarChart data={filteredMonths} margin={{ top: 8, right: 14, left: 0, bottom: 0 }} barGap={4}>
                    <CartesianGrid stroke="var(--line)" strokeDasharray="3 5" vertical={false} />
                    <XAxis dataKey="label" {...axis} tickLine={false} axisLine={false} />
                    <YAxis {...axis} tickFormatter={short} tickLine={false} axisLine={false} width={48} />
                    <Tooltip content={<ChartTooltip currency={currency} />} />
                    <ReferenceLine y={0} stroke="var(--muted)" strokeDasharray="3 4" />
                    {visible.includes("revenue") && <Bar dataKey="revenue" name="Revenue" fill="#14b8a6" radius={[4, 4, 0, 0]} maxBarSize={24} />}
                    {visible.includes("expense") && <Bar dataKey="expense" name="Expenses" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={24} />}
                    {visible.includes("profit") && <Bar dataKey="profit" name="Net result" fill="#60a5fa" radius={[4, 4, 0, 0]} maxBarSize={24} />}
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-panel2/50 px-4 py-2.5 text-[11px] text-muted">
            <span>{noActivity ? "No ledger values available" : bestMonth ? `Highest revenue: ${bestMonth.label} (${formatAmount(bestMonth.revenue, currency)})` : "No monthly results"}</span>
            <span>{selectedPeriod.label} · {filteredMonths.length} months included</span>
          </div>
        </section>

        <section className="rounded-xl border border-line bg-panel shadow-sm">
          <header className="border-b border-line px-4 py-3">
            <h3 className="text-sm font-semibold">Operating cost mix</h3>
            <p className="mt-0.5 text-[11px] text-muted">Posted expenses by ledger account · full financial year</p>
          </header>
          {topExpenses.length ? (
            <div className="space-y-4 p-4">
              <div className="rounded-lg bg-panel2 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">{selectedExpense ?? "Largest expense category"}</div>
                <div className="num mt-1 text-xl font-semibold">{formatAmount(topExpenses.find((item) => item.name === selectedExpense)?.value ?? topExpenses[0].value, currency)}</div>
              </div>
              <div className="space-y-3">
                {topExpenses.map((item, index) => {
                  const active = selectedExpense === item.name;
                  return (
                    <button key={item.name} type="button" className="w-full text-left" aria-pressed={active} onClick={() => setSelectedExpense(active ? null : item.name)}>
                      <span className="mb-1.5 flex items-center justify-between gap-2 text-[11px]">
                        <span className={`truncate ${active ? "font-semibold text-fg" : "text-muted"}`}>{item.name}</span>
                        <span className="num shrink-0 font-medium">{formatAmount(item.value, currency)}</span>
                      </span>
                      <span className="block h-2 overflow-hidden rounded-full bg-panel2">
                        <span className="block h-full rounded-full transition-all" style={{ width: `${maxExpense ? (item.value / maxExpense) * 100 : 0}%`, backgroundColor: PALETTE[index % PALETTE.length] }} />
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="border-t border-line pt-3 text-[10px] leading-relaxed text-muted">Select a category to inspect its total. Bars compare the largest ledger expense accounts; they are not an expense forecast.</p>
            </div>
          ) : (
            <div className="grid min-h-64 place-items-center px-5 text-center text-xs text-muted">No posted expense categories are available for this financial year.</div>
          )}
        </section>
      </div>
    </section>
  );
}
