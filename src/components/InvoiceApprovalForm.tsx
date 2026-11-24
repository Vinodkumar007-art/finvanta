"use client";
import { useActionState } from "react";
import { approveInvoiceAction } from "@/actions/arap";

export default function InvoiceApprovalForm({ invoiceId }: { invoiceId: string }) {
  const [state, action, pending] = useActionState(approveInvoiceAction.bind(null, invoiceId), undefined);
  return (
    <div>
      <form action={action}>
        <button className="btn btn-sm btn-primary" disabled={pending}>{pending ? "Approving…" : "Approve"}</button>
      </form>
      {state?.error && <p role="alert" className="mt-1 max-w-56 whitespace-normal text-[11px] text-down">{state.error}</p>}
      {state?.ok && <p role="status" className="mt-1 max-w-56 whitespace-normal text-[11px] text-up">{state.ok}</p>}
    </div>
  );
}
