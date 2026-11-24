"use client";
import { useActionState, useMemo, useState } from "react";
import { createVoucher } from "@/actions/accounting";

type Opt = { id: string; label: string };
type Line = { accountId: string; debit: string; credit: string; costCentreId: string; narration: string };
const TYPES: [string, string][] = [["journal", "Journal"], ["payment", "Payment"], ["receipt", "Receipt"], ["contra", "Contra"], ["sales", "Sales"], ["purchase", "Purchase"], ["debit_note", "Debit note"], ["credit_note", "Credit note"]];
const empty = (): Line => ({ accountId: "", debit: "", credit: "", costCentreId: "", narration: "" });
const cents = (v: string) => { const n = Math.round(parseFloat(v || "0") * 100); return Number.isFinite(n) ? n : 0; };

export default function VoucherForm({ accounts, costCentres, today, currency }: { accounts: Opt[]; costCentres: Opt[]; today: string; currency: string }) {
  const [state, act, pending] = useActionState(createVoucher, undefined);
  const [type, setType] = useState("journal"); const [date, setDate] = useState(today); const [narration, setNarration] = useState("");
  const [cur, setCur] = useState(currency); const [fx, setFx] = useState("1");
  const [lines, setLines] = useState<Line[]>([empty(), empty()]);
  const dr = lines.reduce((s, l) => s + cents(l.debit), 0), cr = lines.reduce((s, l) => s + cents(l.credit), 0);
  const balanced = dr === cr && dr > 0;
  const payload = useMemo(() => JSON.stringify({ type, date, narration, currency: cur, fxRate: fx, lines: lines.map((l) => ({ accountId: l.accountId, debit: l.debit || "0", credit: l.credit || "0", costCentreId: l.costCentreId || null, narration: l.narration || undefined })) }), [type, date, narration, cur, fx, lines]);
  const set = (i: number, k: keyof Line, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v, ...(k === "debit" && v ? { credit: "" } : {}), ...(k === "credit" && v ? { debit: "" } : {}) } : l)));
  const fmt = (c: number) => (c / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 });

  return (
    <form action={act} className="space-y-4">
      <input type="hidden" name="payload" value={payload} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <label className="text-xs"><span className="mb-1 block text-muted">Voucher type</span><select className="inp" value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="text-xs"><span className="mb-1 block text-muted">Date</span><input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        <label className="text-xs"><span className="mb-1 block text-muted">Currency</span><select className="inp" value={cur} onChange={(e) => setCur(e.target.value)}>{[currency, "INR", "USD", "EUR", "GBP", "AED", "SGD"].filter((v, i, a) => a.indexOf(v) === i).map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="text-xs"><span className="mb-1 block text-muted">Rate to {currency}</span><input className="inp num" value={cur === currency ? "1" : fx} disabled={cur === currency} onChange={(e) => setFx(e.target.value)} /></label>
        <label className="col-span-2 text-xs md:col-span-5"><span className="mb-1 block text-muted">Narration</span><input className="inp" value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="e.g. Office rent for April paid by bank" maxLength={500} /></label>
      </div>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="tbl"><thead><tr><th>Ledger account</th><th>Cost centre</th><th className="r">Debit</th><th className="r">Credit</th><th /></tr></thead>
          <tbody>{lines.map((l, i) => (
            <tr key={i}>
              <td className="min-w-56"><select className="inp" aria-label={`Account line ${i + 1}`} value={l.accountId} onChange={(e) => set(i, "accountId", e.target.value)}><option value="">Select account…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></td>
              <td><select className="inp" aria-label="Cost centre" value={l.costCentreId} onChange={(e) => set(i, "costCentreId", e.target.value)}><option value="">—</option>{costCentres.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></td>
              <td><input className="inp num text-right" aria-label={`Debit line ${i + 1}`} inputMode="decimal" value={l.debit} onChange={(e) => set(i, "debit", e.target.value)} /></td>
              <td><input className="inp num text-right" aria-label={`Credit line ${i + 1}`} inputMode="decimal" value={l.credit} onChange={(e) => set(i, "credit", e.target.value)} /></td>
              <td>{lines.length > 2 && <button type="button" className="btn btn-sm" aria-label="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button>}</td>
            </tr>))}
          </tbody>
          <tfoot><tr className="font-semibold"><td colSpan={2} className="text-right text-muted">Totals</td><td className="r num">{fmt(dr)}</td><td className="r num">{fmt(cr)}</td><td /></tr></tfoot>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-sm" onClick={() => setLines([...lines, empty()])}>＋ Add line</button>
        <span className={`text-xs font-semibold ${balanced ? "text-up" : "text-warn"}`} role="status">{balanced ? "✓ Debits equal credits" : dr === cr ? "Enter amounts" : `Difference ${fmt(Math.abs(dr - cr))} (${dr > cr ? "credit short" : "debit short"})`}</span>
        <button className="btn btn-primary ml-auto" disabled={pending || !balanced}>{pending ? "Posting…" : "Post voucher"}</button>
      </div>
      {state?.error && <div role="alert" className="rounded-lg border border-down/40 bg-down/5 px-3 py-2 text-xs text-down">{state.error}</div>}
      {state?.ok && <div role="status" className="rounded-lg border border-up/40 bg-up/5 px-3 py-2 text-xs text-up">{state.ok}</div>}
      <p className="text-[11px] text-muted">Posting writes to the general ledger immediately, is audit-logged, and can only be undone by a reversing entry. Closed financial years reject postings.</p>
    </form>
  );
}
