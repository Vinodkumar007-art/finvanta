"use client";
import { useActionState } from "react";
import type { FormState } from "@/actions/auth";

export type FieldDef = {
  name: string; label: string; type?: "text" | "hidden" | "number" | "date" | "select" | "textarea" | "checkbox" | "password" | "file";
  options?: [string, string][]; placeholder?: string; required?: boolean; defaultValue?: string | number; step?: string; span?: number; hint?: string; accept?: string;
};

export default function ActionForm({ action, fields, submit, cols = 2, compact, resetOnOk = true }: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>; fields: FieldDef[]; submit: string; cols?: number; compact?: boolean; resetOnOk?: boolean;
}) {
  const [s, act, pending] = useActionState(async (p: FormState, fd: FormData) => { const r = await action(p, fd); return r; }, undefined);
  return (
    <form action={act} key={resetOnOk && s?.ok ? s.ok : "f"} className="space-y-3">
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(cols, 4)}, minmax(0, 1fr))` }}>
        {fields.filter((f) => f.type === "hidden").map((f) => <input key={f.name} type="hidden" name={f.name} defaultValue={f.defaultValue} />)}
        {fields.filter((f) => f.type !== "hidden").map((f) => (
          <label key={f.name} className={`block text-xs ${f.type === "checkbox" ? "flex items-center gap-2" : ""}`} style={{ gridColumn: `span ${Math.min(f.span ?? 1, cols)}` }}>
            {f.type === "checkbox" ? <input type="checkbox" name={f.name} defaultChecked={!!f.defaultValue} /> : null}
            <span className={f.type === "checkbox" ? "" : "mb-1 block font-medium text-muted"}>{f.label}{f.required ? " *" : ""}</span>
            {f.type === "select" ? (
              <select className="inp" name={f.name} defaultValue={f.defaultValue} required={f.required}>{f.options?.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            ) : f.type === "textarea" ? (
              <textarea className="inp" name={f.name} rows={compact ? 2 : 4} placeholder={f.placeholder} required={f.required} defaultValue={f.defaultValue} />
            ) : f.type === "checkbox" ? null : (
              <input className="inp" name={f.name} type={f.type ?? "text"} step={f.step ?? (f.type === "number" ? "any" : undefined)} placeholder={f.placeholder} required={f.required} defaultValue={f.defaultValue} accept={f.accept} />
            )}
            {f.hint && <span className="mt-1 block text-[11px] text-muted">{f.hint}</span>}
          </label>
        ))}
      </div>
      {s?.error && <div role="alert" className="rounded-lg border border-down/40 bg-down/5 px-3 py-2 text-xs text-down">{s.error}</div>}
      {s?.ok && <div role="status" className="rounded-lg border border-up/40 bg-up/5 px-3 py-2 text-xs text-up">{s.ok}</div>}
      <button className="btn btn-primary" disabled={pending}>{pending ? "Working…" : submit}</button>
    </form>
  );
}
