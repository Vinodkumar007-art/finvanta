"use client";
import { useActionState, useMemo, useState } from "react";
import { createInvoiceAction, createSalesDocumentAction } from "@/actions/arap";
import { invoiceTotals, TAX_RULES } from "@/engines/tax";

type Item = { description: string; hsn: string; qty: string; rate: string; gstRate: string; inventoryItemId: string };
type InventoryOption = { id: string; sku: string; name: string; unit: string; hsn: string | null; onHand: string; belowReorder: boolean; hasHistoryError: boolean };
export default function InvoiceForm({ kind, parties, stateCode, today, states, inventoryItems = [], documentMode = false }: { kind: "sales" | "purchase"; parties: { id: string; name: string; stateCode: string; creditDays: number }[]; stateCode: string; today: string; states: [string, string][]; inventoryItems?: InventoryOption[]; documentMode?: boolean }) {
  const [st, act, pending] = useActionState(documentMode ? createSalesDocumentAction : createInvoiceAction, undefined);
  const [partyId, setParty] = useState(parties[0]?.id ?? ""); const [date, setDate] = useState(today); const [due, setDue] = useState(documentMode ? "" : today); const [pos, setPos] = useState("");
  const [documentType, setDocumentType] = useState("quotation");
  const [items, setItems] = useState<Item[]>([{ description: "", hsn: "", qty: "1", rate: "", gstRate: "18", inventoryItemId: "" }]); const [notes, setNotes] = useState(""); const [number, setNumber] = useState("");
  const party = parties.find((p) => p.id === partyId);
  const effPos = kind === "sales" ? (pos || party?.stateCode || stateCode) : stateCode;
  const t = useMemo(() => invoiceTotals(items.map((i) => ({ qty: Number(i.qty) || 0, rate: i.rate || "0", gstRate: Number(i.gstRate) })), kind === "sales" ? stateCode : party?.stateCode ?? stateCode, effPos), [items, kind, stateCode, party, effPos]);
  const up = (i: number, k: keyof Item, v: string) => setItems(items.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const selectInventoryItem = (i: number, inventoryItemId: string) => {
    const selected = inventoryItems.find((item) => item.id === inventoryItemId);
    setItems(items.map((item, index) => index === i ? {
      ...item,
      inventoryItemId,
      description: selected?.name ?? item.description,
      hsn: selected?.hsn ?? "",
    } : item));
  };
  const setPartyAndDue = (id: string) => { setParty(id); const p = parties.find((x) => x.id === id); if (p && !documentMode) setDue(new Date(Date.parse(date) + p.creditDays * 86400000).toISOString().slice(0, 10)); };
  const payload = JSON.stringify({ kind, type: documentType, partyId, date, dueDate: due || today, validUntil: due || undefined, placeOfSupply: effPos, notes, number: number || undefined, items: items.map((i) => ({ description: i.description, hsn: i.hsn, qty: Number(i.qty), rate: i.rate || "0", gstRate: Number(i.gstRate), inventoryItemId: i.inventoryItemId || undefined })) });
  if (!parties.length) return <p className="text-sm text-muted">Add a {kind === "sales" ? "customer" : "vendor"} first (Parties tab).</p>;
  return (
    <form action={act} className="space-y-3"><input type="hidden" name="payload" value={payload} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {documentMode && <label className="col-span-2 text-xs"><span className="mb-1 block text-muted">Document type</span><select className="inp" value={documentType} onChange={(e) => setDocumentType(e.target.value)}><option value="quotation">Quotation</option><option value="proforma">Pro-forma invoice</option><option value="sales_order">Sales order</option><option value="delivery_challan">Delivery challan</option></select></label>}
        <label className="col-span-2 text-xs"><span className="mb-1 block text-muted">{kind === "sales" ? "Customer" : "Vendor"}</span><select className="inp" value={partyId} onChange={(e) => setPartyAndDue(e.target.value)}>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="text-xs"><span className="mb-1 block text-muted">{documentMode ? "Document" : kind === "sales" ? "Invoice" : "Bill"} date</span><input type="date" className="inp" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
        <label className="text-xs"><span className="mb-1 block text-muted">{documentMode ? "Valid until (optional)" : "Due date"}</span><input type="date" className="inp" value={due} onChange={(e) => setDue(e.target.value)} required={!documentMode} /></label>
        {kind === "sales" ? <label className="text-xs"><span className="mb-1 block text-muted">Place of supply</span><select className="inp" value={effPos} onChange={(e) => setPos(e.target.value)}>{states.map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}</select></label> : <label className="text-xs"><span className="mb-1 block text-muted">Supplier’s bill no.</span><input className="inp" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Required for ITC matching" /></label>}
      </div>
      <table className="tbl"><thead><tr><th>Description</th><th>HSN/SAC</th><th className="r">Qty</th><th className="r">Rate</th><th className="r">GST %</th><th /></tr></thead><tbody>{items.map((it, i) => (<tr key={i}>
        <td><input className="inp" aria-label="Description" value={it.description} onChange={(e) => up(i, "description", e.target.value)} required />
          {inventoryItems.length > 0 && <><select className="inp mt-1 text-xs" aria-label="Inventory item" value={it.inventoryItemId} onChange={(e) => selectInventoryItem(i, e.target.value)}><option value="">Non-inventory item</option>{inventoryItems.map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.name} · {item.onHand} {item.unit}{item.belowReorder ? " · LOW STOCK" : ""}</option>)}</select>
            {it.inventoryItemId && (() => { const selected = inventoryItems.find((item) => item.id === it.inventoryItemId); return selected ? <p className={`mt-1 text-[10px] ${selected.hasHistoryError || selected.belowReorder ? "text-down" : "text-muted"}`}>On hand: {selected.onHand} {selected.unit}{selected.hasHistoryError ? " · stock history needs reconciliation" : selected.belowReorder ? " · below reorder level" : ""}</p> : null; })()}</>}
        </td><td><input className="inp num w-24" aria-label="HSN" value={it.hsn} onChange={(e) => up(i, "hsn", e.target.value)} /></td>
        <td><input className="inp num w-20 text-right" aria-label="Quantity" value={it.qty} onChange={(e) => up(i, "qty", e.target.value)} /></td><td><input className="inp num w-28 text-right" aria-label="Rate" value={it.rate} onChange={(e) => up(i, "rate", e.target.value)} required /></td>
        <td><select className="inp w-20" aria-label="GST rate" value={it.gstRate} onChange={(e) => up(i, "gstRate", e.target.value)}>{TAX_RULES.gstSlabs.map((s) => <option key={s}>{s}</option>)}</select></td><td>{items.length > 1 && <button type="button" className="btn btn-sm" onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</button>}</td></tr>))}</tbody></table>
      <div className="flex flex-wrap items-start justify-between gap-3"><button type="button" className="btn btn-sm" onClick={() => setItems([...items, { description: "", hsn: "", qty: "1", rate: "", gstRate: "18", inventoryItemId: "" }])}>＋ Add line</button>
        <dl className="num grid grid-cols-2 gap-x-6 text-xs"><dt className="text-muted">Taxable</dt><dd className="text-right">{t.taxable.toFixed(2)}</dd>{t.igst.gt(0) ? <><dt className="text-muted">IGST</dt><dd className="text-right">{t.igst.toFixed(2)}</dd></> : <><dt className="text-muted">CGST</dt><dd className="text-right">{t.cgst.toFixed(2)}</dd><dt className="text-muted">SGST</dt><dd className="text-right">{t.sgst.toFixed(2)}</dd></>}<dt className="font-semibold">Total</dt><dd className="text-right font-semibold">{t.total.toFixed(2)}</dd></dl></div>
      <input className="inp" placeholder="Notes / terms (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      {inventoryItems.length > 0 && <p className="text-[11px] text-muted">Linked stock changes only when an invoice or bill is approved. Sales approval checks available quantity; purchase approval increases stock.</p>}
      {inventoryItems.length === 0 && <p className="text-[11px] text-muted">No inventory items are set up. You can continue with non-inventory lines or <a className="text-accent underline" href="/accounting?tab=inventory">add catalog items</a>.</p>}
      {st?.error && <div role="alert" className="rounded-lg border border-down/40 bg-down/5 px-3 py-2 text-xs text-down">{st.error}</div>}{st?.ok && <div role="status" className="rounded-lg border border-up/40 bg-up/5 px-3 py-2 text-xs text-up">{st.ok}</div>}
      <button className="btn btn-primary" disabled={pending}>{pending ? "Saving…" : documentMode ? "Save sales document" : "Save for approval"}</button>
    </form>
  );
}
