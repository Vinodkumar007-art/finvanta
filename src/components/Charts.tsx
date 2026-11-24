"use client";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";

export const PALETTE = ["#10b981", "#14b8a6", "#60a5fa", "#fbbf24", "#a78bfa", "#fb7185", "#94a3b8", "#f97316"];
type Data = Record<string, string | number | null>[];
type S = { key: string; name?: string; color?: string };
const axis = { stroke: "var(--muted)", fontSize: 11 };
const tip = { contentStyle: { background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12, color: "var(--fg)" }, labelStyle: { color: "var(--muted)" } };
const short = (v: number) => { const a = Math.abs(v); return a >= 1e7 ? `${(v / 1e7).toFixed(1)}Cr` : a >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : a >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(Math.round(v * 100) / 100); };
const full = (v: unknown) => (typeof v === "number" ? v.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : String(v));

export function BarsChart({ data, x, series, height = 260, stacked, zero }: { data: Data; x: string; series: S[]; height?: number; stacked?: boolean; zero?: boolean }) {
  return (
    <div style={{ height }} role="img" aria-label="Bar chart">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={x} {...axis} /><YAxis {...axis} tickFormatter={short} width={48} />
          <Tooltip {...tip} formatter={full} /><Legend wrapperStyle={{ fontSize: 11 }} />
          {zero && <ReferenceLine y={0} stroke="var(--muted)" />}
          {series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.name ?? s.key} fill={s.color ?? PALETTE[i % PALETTE.length]} radius={[3, 3, 0, 0]} stackId={stacked ? "a" : undefined} />)}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
export function LinesChart({ data, x, series, height = 260, area }: { data: Data; x: string; series: S[]; height?: number; area?: boolean }) {
  const C = area ? AreaChart : LineChart;
  return (
    <div style={{ height }} role="img" aria-label="Line chart">
      <ResponsiveContainer>
        <C data={data} margin={{ left: 0, right: 8, top: 8 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={x} {...axis} /><YAxis {...axis} tickFormatter={short} width={48} domain={["auto", "auto"]} />
          <Tooltip {...tip} formatter={full} /><Legend wrapperStyle={{ fontSize: 11 }} />
          {series.map((s, i) => area
            ? <Area key={s.key} type="monotone" dataKey={s.key} name={s.name ?? s.key} stroke={s.color ?? PALETTE[i % PALETTE.length]} fill={s.color ?? PALETTE[i % PALETTE.length]} fillOpacity={0.15} strokeWidth={2} dot={false} />
            : <Line key={s.key} type="monotone" dataKey={s.key} name={s.name ?? s.key} stroke={s.color ?? PALETTE[i % PALETTE.length]} strokeWidth={2} dot={false} />)}
        </C>
      </ResponsiveContainer>
    </div>
  );
}
export function DonutChart({ data, height = 240 }: { data: { name: string; value: number }[]; height?: number }) {
  return (
    <div style={{ height }} role="img" aria-label="Donut chart">
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2} stroke="none">
            {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
          </Pie>
          <Tooltip {...tip} formatter={full} /><Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
