import Link from "next/link";
import { Card, Notice, PageHeader } from "@/components/ui";
import DataImportForm from "@/components/DataImportForm";
import { can, requireCompany } from "@/lib/ctx";

export const metadata = { title: "Data Imports" };

export default async function ImportsPage() {
  const ctx = await requireCompany();
  const canWrite = can(ctx.role, "write");
  return (
    <>
      <PageHeader
        title="Data Imports"
        desc="Bring party, inventory and invoice records into this company from a structured CSV or Excel file."
        crumbs={[{ label: "Accounting & Compliance" }, { label: "Data Imports" }]}
      />
      <Notice tone="info" title="Company-scoped, all-or-nothing imports">
        The whole file is validated before any rows are saved. Duplicate names/SKUs/invoice numbers or invalid rows reject the import. Invoice and bill records are created as pending approval only; they do not post to the ledger or change stock until a user approves them.
      </Notice>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Import a file" subtitle="One CSV or XLSX worksheet per import; formulas are not accepted.">
          {canWrite ? <DataImportForm /> : <Notice tone="warn">Your role does not permit imports.</Notice>}
        </Card>
        <Card title="Templates and required columns">
          <div className="space-y-4 text-xs text-muted">
            <section>
              <p className="font-semibold text-ink">Parties</p>
              <p>Required: <code>kind</code> (customer/vendor/deductee), <code>name</code>. Optional: gstin, pan, email, phone, state_code, credit_limit, credit_days, deductee_type.</p>
              <Link className="mt-1 inline-block text-accent underline" href="/templates/parties.csv" download>Download parties CSV template</Link>
            </section>
            <section>
              <p className="font-semibold text-ink">Inventory catalog</p>
              <p>Required: <code>sku</code>, <code>name</code>. Optional: unit, hsn, reorder_level. Starting balances must be entered as audited stock movements after import.</p>
              <Link className="mt-1 inline-block text-accent underline" href="/templates/inventory.csv" download>Download inventory CSV template</Link>
            </section>
            <section>
              <p className="font-semibold text-ink">Invoices and bills</p>
              <p>Required per line: kind (sales/purchase), number, party_name, date, due_date, description, qty, rate, gst_rate. Party name must match an existing customer/vendor (case-insensitive). Dates accept YYYY-MM-DD or DD/MM/YYYY; repeat the same number for additional invoice lines. Optional: place_of_supply, hsn, sku.</p>
              <Link className="mt-1 inline-block text-accent underline" href="/templates/invoices.csv" download>Download invoice CSV template</Link>
            </section>
          </div>
        </Card>
      </div>
    </>
  );
}
