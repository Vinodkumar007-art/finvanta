export default function InvoicePdfOptions({ invoiceId }: { invoiceId: string }) {
  return (
    <details className="relative">
      <summary className="btn btn-sm cursor-pointer list-none">PDF options</summary>
      <form action={`/api/invoice/${invoiceId}/pdf`} method="get" target="_blank" className="absolute right-0 z-20 mt-1 grid min-w-48 gap-2 rounded border border-line bg-panel p-3 text-xs shadow-lg">
        <label className="grid gap-1">
          Layout
          <select className="field" name="layout" defaultValue="branded">
            <option value="classic">Classic</option>
            <option value="branded">Branded</option>
            <option value="compact">Compact</option>
          </select>
        </label>
        <label className="grid gap-1">
          Language
          <select className="field" name="language" defaultValue="en">
            <option value="en">English</option>
            <option value="es">Spanish (ASCII labels)</option>
          </select>
        </label>
        <button className="btn btn-sm btn-primary" type="submit">Open PDF</button>
      </form>
    </details>
  );
}
