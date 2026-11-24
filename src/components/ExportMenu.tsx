export default function ExportMenu({ report, params = {}, formats = ["pdf", "xlsx", "csv"] }: { report: string; params?: Record<string, string>; formats?: string[] }) {
  const q = (f: string) => `/api/export?${new URLSearchParams({ report, format: f, ...params }).toString()}`;
  return (
    <span className="inline-flex items-center gap-1" role="group" aria-label="Export">
      <span className="text-[11px] text-muted">Export</span>
      {formats.map((f) => <a key={f} className="btn btn-sm uppercase" href={q(f)} download>{f}</a>)}
    </span>
  );
}
