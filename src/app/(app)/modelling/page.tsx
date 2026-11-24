import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { models } from "@/db/schema";
import { PageHeader } from "@/components/ui";
import ModellingStudio from "@/components/ModellingStudio";
import { requireCompany, can } from "@/lib/ctx";
import { loadStatements, stmtFromLedger } from "@/services/finance";

export const metadata = { title: "Modelling & Valuation" };
export default async function Modelling() {
  const ctx = await requireCompany();
  const saved = await db.select().from(models).where(and(eq(models.companyId, ctx.company.id), isNull(models.deletedAt))).orderBy(desc(models.createdAt)).limit(30);
  const base = stmtFromLedger(await loadStatements(ctx));
  return (<><PageHeader title="Financial Modelling & Valuation" desc="DCF, DDM, LBO, comparables, integrated three-statement projections and break-even — every assumption editable, every output traceable." crumbs={[{ label: "Analysis & Planning" }, { label: "Modelling" }]} />
    <ModellingStudio base={base} canWrite={can(ctx.role, "write")} saved={saved.filter((m) => ["dcf", "ddm", "lbo"].includes(m.type)).map((m) => ({ id: m.id, name: m.name, type: m.type, assumptions: m.assumptions }))} /></>);
}
