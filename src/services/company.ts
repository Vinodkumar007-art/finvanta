import { db } from "@/db";
import { accounts, companies, financialYears, tdsSections } from "@/db/schema";
import { DEFAULT_COA, fyBounds } from "@/engines/accounting";
import { DEFAULT_TDS_SECTIONS } from "@/engines/tax";

type NewCompany = { orgId: string; name: string; gstin?: string; pan?: string; tan?: string; stateCode?: string; baseCurrency?: string; fyStartMonth?: number };

export async function createCompanyWithDefaults(c: NewCompany) {
  const startMonth = c.fyStartMonth ?? 4;
  return db.transaction(async (tx) => {
    const [co] = await tx.insert(companies).values({
      orgId: c.orgId, name: c.name, gstin: c.gstin || null, pan: c.pan || null, tan: c.tan || null,
      stateCode: c.stateCode || "27", baseCurrency: c.baseCurrency || "INR", fyStartMonth: startMonth,
    }).returning();
    const b = fyBounds(startMonth, new Date());
    const [fy] = await tx.insert(financialYears).values({ companyId: co.id, label: b.label, startDate: b.start, endDate: b.end }).returning();
    await tx.insert(accounts).values(DEFAULT_COA.map((a) => ({ ...a, companyId: co.id, isSystem: true })));
    await tx.insert(tdsSections).values(DEFAULT_TDS_SECTIONS.map((t) => ({ ...t, companyId: co.id })));
    return { company: co, fy };
  });
}
