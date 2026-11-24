"use client";

import { useActionState } from "react";
import { importData } from "@/actions/imports";

export default function DataImportForm() {
  const [state, action, pending] = useActionState(importData, undefined);
  return (
    <form action={action} key={state?.ok ?? "import"} className="space-y-3">
      <label className="block text-xs">
        <span className="mb-1 block font-medium text-muted">Data type</span>
        <select className="inp" name="kind" required defaultValue="parties">
          <option value="parties">Parties (customers and vendors)</option>
          <option value="inventory">Inventory catalog</option>
          <option value="invoices">Invoices and bills</option>
        </select>
      </label>
      <label className="block text-xs">
        <span className="mb-1 block font-medium text-muted">CSV or XLSX file (max 8 MB)</span>
        <input className="inp" name="file" type="file" required accept=".csv,.xlsx" />
      </label>
      <label className="flex items-start gap-2 text-xs text-muted">
        <input className="mt-0.5" name="confirm" type="checkbox" required />
        <span>I reviewed this file. Imported invoices will remain pending approval; no accounting entries will be posted.</span>
      </label>
      {state?.error && <div role="alert" className="rounded-lg border border-down/40 bg-down/5 px-3 py-2 text-xs text-down">{state.error}</div>}
      {state?.ok && <div role="status" className="rounded-lg border border-up/40 bg-up/5 px-3 py-2 text-xs text-up">{state.ok}</div>}
      <button className="btn btn-primary" disabled={pending}>{pending ? "Validating and importing…" : "Validate and import"}</button>
    </form>
  );
}
