import { PageHeader } from "@/components/ui";

const kpiCards = Array.from({ length: 14 }, (_, index) => index);

function SkeletonPanel({ title, height, wide = false }: { title: string; height: number; wide?: boolean }) {
  return (
    <section className={`min-w-0 rounded-xl border border-line bg-panel ${wide ? "lg:col-span-2" : ""}`}>
      <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
      </header>
      <div className="min-w-0 p-4" style={{ minHeight: height }} aria-hidden="true">
        <div className="skeleton h-4 w-2/3" />
        <div className="skeleton mt-4 h-24 w-full" />
        <div className="skeleton mt-3 h-3 w-1/2" />
      </div>
    </section>
  );
}

export default function DashboardLoading() {
  return (
    <>
      <PageHeader title="Executive Dashboard" desc="Loading financial performance from your ledger…" />
      <div className="mb-3 flex justify-end" aria-hidden="true">
        <div className="skeleton h-7 w-36 rounded-lg" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2" aria-busy="true" role="status">
        <p className="sr-only">Loading executive dashboard and financial indicators.</p>
        <section className="min-w-0 rounded-xl border border-line bg-panel lg:col-span-2">
          <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <h2 className="text-sm font-semibold">Key financials</h2>
          </header>
          <div className="p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-hidden="true">
              {kpiCards.map((index) => (
                <div key={index} className="h-[104px] rounded-xl border border-line bg-panel p-3.5">
                  <div className="skeleton h-3 w-24" />
                  <div className="skeleton mt-2 h-6 w-32" />
                  <div className="skeleton mt-1 h-3 w-20" />
                </div>
              ))}
            </div>
          </div>
        </section>
        <SkeletonPanel title="Financial health score" height={260} />
        <SkeletonPanel title="KPI alerts & red flags" height={260} />
        <SkeletonPanel title="Monthly performance" height={380} wide />
        <SkeletonPanel title="Budget vs actual" height={280} />
        <SkeletonPanel title="Cash-flow forecast (indicative)" height={280} />
        <SkeletonPanel title="Working-capital snapshot" height={220} />
        <SkeletonPanel title="Recent activity" height={220} />
      </div>
    </>
  );
}
