import Link from "next/link";
import type { ReactNode } from "react";

export function Card({ title, subtitle, action, children, className = "", pad = true }: { title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`rounded-xl border border-line bg-panel ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold tracking-tight">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, desc, actions, crumbs }: { title: string; desc?: ReactNode; actions?: ReactNode; crumbs?: { label: string; href?: string }[] }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 fade-up">
      <div>
        {crumbs && (
          <nav aria-label="Breadcrumb" className="mb-1 flex items-center gap-1 text-[11px] text-muted">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1">
                {c.href ? <Link href={c.href} className="hover:text-fg">{c.label}</Link> : <span>{c.label}</span>}
                {i < crumbs.length - 1 && <span>/</span>}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {desc && <p className="mt-1 max-w-3xl text-sm text-muted">{desc}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, tone, hint }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "up" | "down" | "warn"; hint?: string }) {
  const c = tone === "up" ? "text-up" : tone === "down" ? "text-down" : tone === "warn" ? "text-warn" : "text-fg";
  return (
    <div className="rounded-xl border border-line bg-panel p-3.5" title={hint}>
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`num mt-1 text-xl font-semibold ${c}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "up" | "down" | "warn" | "accent" | "demo" }) {
  const m = {
    neutral: "bg-panel2 text-muted border-line", up: "bg-up/10 text-up border-up/30", down: "bg-down/10 text-down border-down/30",
    warn: "bg-warn/10 text-warn border-warn/30", accent: "bg-accent/10 text-accent border-accent/30", demo: "bg-warn/15 text-warn border-warn/40",
  }[tone];
  return <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${m}`}>{children}</span>;
}

export function Notice({ children, tone = "info", title }: { children: ReactNode; tone?: "info" | "warn" | "error" | "ok"; title?: string }) {
  const m = { info: "border-teal/40 bg-teal/5", warn: "border-warn/40 bg-warn/5", error: "border-down/40 bg-down/5", ok: "border-up/40 bg-up/5" }[tone];
  return (
    <div role={tone === "error" ? "alert" : "note"} className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${m}`}>
      {title && <div className="mb-0.5 font-semibold">{title}</div>}
      {children}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <div className="mb-1 text-sm font-semibold">{title}</div>
      {children && <p className="mb-3 max-w-md text-xs text-muted">{children}</p>}
      {action}
    </div>
  );
}

export function Tabs({ tabs, active, base }: { tabs: { id: string; label: string }[]; active: string; base: string }) {
  return (
    <div role="tablist" className="mb-4 flex flex-wrap gap-1 border-b border-line">
      {tabs.map((t) => (
        <Link key={t.id} role="tab" aria-selected={t.id === active} href={`${base}?tab=${t.id}`}
          className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium transition-colors ${t.id === active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

export function Source({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-[11px] text-muted">{children}</p>;
}

export const inr = (v: number | string | null | undefined, dp = 0) => {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
};
export const compact = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e7) return `${(v / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${(v / 1e5).toFixed(2)} L`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)} K`;
  return v.toFixed(0);
};
export const pct = (v: number | null | undefined, dp = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(dp)}%`);
