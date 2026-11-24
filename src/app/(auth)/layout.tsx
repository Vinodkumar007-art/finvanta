import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/Brand";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="grid-bg relative hidden min-h-screen flex-col justify-between overflow-hidden border-r border-line bg-panel p-10 lg:flex xl:p-14">
        <div aria-hidden="true" className="pointer-events-none absolute -right-32 top-12 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
        <Link href="/" className="relative"><Wordmark size={34} /></Link>
        <div className="relative max-w-xl">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Financial intelligence workspace
          </div>
          <h2 className="text-4xl font-semibold leading-[1.12] tracking-tight xl:text-5xl">
            Make every financial decision <span className="text-accent">traceable.</span>
          </h2>
          <p className="mt-4 max-w-lg text-sm leading-6 text-muted">
            Bring your books, compliance work and analysis into one workspace built for clarity, review and control.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {[
              ["01", "Accounting you can trace", "Double-entry books, reports, period locks and an audit trail."],
              ["02", "Tax work stays reviewable", "GST, TDS and income-tax calculations with visible assumptions."],
              ["03", "Analysis grounded in records", "Ratios, valuation and portfolio tools show their inputs."],
              ["04", "AI with human approval", "Ask general or finance questions, explore records and use voice; postings stay drafts until approved."],
            ].map(([number, title, detail]) => (
              <div key={number} className="rounded-xl border border-line bg-bg/70 p-4">
                <span className="num text-[10px] font-semibold text-accent">{number}</span>
                <h3 className="mt-2 text-sm font-semibold">{title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted">{detail}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="relative text-[11px] leading-relaxed text-muted">
          Created by Vinod Kumar · Calculations are decision support; statutory returns are submitted only through official portals.
        </p>
      </div>
      <div className="relative grid min-h-screen place-items-center px-5 pb-10 pt-20 sm:px-8 lg:p-10">
        <div className="absolute left-5 top-6 sm:left-8 lg:hidden"><Link href="/"><Wordmark size={27} /></Link></div>
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
