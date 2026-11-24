"use client";
import { useState, useTransition, type ReactNode } from "react";
import { saveDashboardLayout } from "@/actions/prefs";

type W = { id: string; title: string; span: 1 | 2; node: ReactNode };

export default function DashboardGrid({ widgets, initial }: { widgets: W[]; initial: string[] | null }) {
  const ids = widgets.map((w) => w.id);
  const start = (initial ?? []).filter((x) => ids.includes(x.replace(/^-/, "")));
  const hidden0 = new Set(start.filter((x) => x.startsWith("-")).map((x) => x.slice(1)));
  const order0 = [...start.filter((x) => !x.startsWith("-")), ...ids.filter((i) => !start.some((s) => s.replace(/^-/, "") === i))];
  const [order, setOrder] = useState(order0); const [hidden, setHidden] = useState(hidden0);
  const [edit, setEdit] = useState(false); const [drag, setDrag] = useState<string | null>(null);
  const [pending, startT] = useTransition(); const [saved, setSaved] = useState("");
  const persist = (o: string[], h: Set<string>) => startT(async () => { await saveDashboardLayout([...o, ...[...h].map((x) => `-${x}`)]); setSaved("Layout saved"); setTimeout(() => setSaved(""), 1500); });
  const drop = (target: string) => { if (!drag || drag === target) return; const o = order.filter((x) => x !== drag); o.splice(o.indexOf(target), 0, drag); setOrder(o); setDrag(null); persist(o, hidden); };
  const toggle = (id: string) => { const h = new Set(hidden); if (h.has(id)) h.delete(id); else h.add(id); setHidden(h); persist(order, h); };
  const move = (id: string, d: -1 | 1) => { const i = order.indexOf(id); const j = i + d; if (j < 0 || j >= order.length) return; const o = [...order]; [o[i], o[j]] = [o[j], o[i]]; setOrder(o); persist(o, hidden); };

  return (
    <div>
      <div className="mb-3 flex items-center justify-end gap-2">
        {saved && <span className="text-[11px] text-up" role="status">{saved}</span>}
        <button className="btn btn-sm" aria-pressed={edit} onClick={() => setEdit(!edit)}>{edit ? "Done" : "Customise widgets"}</button>
      </div>
      {edit && (
        <div className="mb-3 flex flex-wrap gap-2 rounded-lg border border-line bg-panel p-3 text-xs">
          <span className="text-muted">Show / hide:</span>
          {widgets.map((w) => <label key={w.id} className="flex items-center gap-1"><input type="checkbox" checked={!hidden.has(w.id)} onChange={() => toggle(w.id)} />{w.title}</label>)}
          <span className="ml-auto text-muted">Drag widget headers (or use ▲▼) to reorder{pending ? " · saving…" : ""}</span>
        </div>
      )}
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {order.filter((id) => !hidden.has(id)).map((id) => {
          const w = widgets.find((x) => x.id === id)!;
          return (
            <section key={id} draggable={edit} onDragStart={() => setDrag(id)} onDragOver={(e) => edit && e.preventDefault()} onDrop={() => drop(id)}
              className={`min-w-0 rounded-xl border bg-panel ${w.span === 2 ? "lg:col-span-2" : ""} ${edit ? "cursor-grab border-dashed border-accent/60" : "border-line"} ${drag === id ? "opacity-50" : ""}`}>
              <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
                <h2 className="text-sm font-semibold">{edit && "⠿ "}{w.title}</h2>
                {edit && <span className="flex gap-1"><button className="btn btn-sm" aria-label={`Move ${w.title} up`} onClick={() => move(id, -1)}>▲</button><button className="btn btn-sm" aria-label={`Move ${w.title} down`} onClick={() => move(id, 1)}>▼</button></span>}
              </header>
              <div className="min-w-0 p-4">{w.node}</div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
