import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { companies, financialYears, memberships, organisations, userPreferences } from "@/db/schema";
import { sessionUser } from "./auth";

export type Role = "owner" | "admin" | "accountant" | "analyst" | "viewer";
export type Perm = "read" | "write" | "approve" | "admin";
const ROLE_PERMS: Record<Role, Perm[]> = {
  owner: ["read", "write", "approve", "admin"],
  admin: ["read", "write", "approve", "admin"],
  accountant: ["read", "write", "approve"],
  analyst: ["read", "write"],
  viewer: ["read"],
};
export const can = (role: string, perm: Perm) => (ROLE_PERMS[role as Role] ?? []).includes(perm);

export const getCtx = cache(async () => {
  const user = await sessionUser();
  if (!user) return null;
  const [m] = await db
    .select({ orgId: organisations.id, orgName: organisations.name, plan: organisations.plan, role: memberships.role })
    .from(memberships).innerJoin(organisations, eq(organisations.id, memberships.orgId))
    .where(and(eq(memberships.userId, user.id), isNull(organisations.deletedAt)))
    .orderBy(asc(memberships.createdAt)).limit(1);
  if (!m) return null;
  const cos = await db.select().from(companies).where(and(eq(companies.orgId, m.orgId), isNull(companies.deletedAt))).orderBy(asc(companies.createdAt));
  const jar = await cookies();
  const company = cos.find((c) => c.id === jar.get("fv_company")?.value) ?? cos[0] ?? null;
  const fys = company ? await db.select().from(financialYears).where(eq(financialYears.companyId, company.id)).orderBy(desc(financialYears.startDate)) : [];
  const today = new Date().toISOString().slice(0, 10);
  const fy = fys.find((f) => f.id === jar.get("fv_fy")?.value) ?? fys.find((f) => f.startDate <= today && f.endDate >= today) ?? fys[0] ?? null;
  const [prefs] = await db.select().from(userPreferences).where(eq(userPreferences.userId, user.id)).limit(1);
  return { user, org: { id: m.orgId, name: m.orgName, plan: m.plan }, role: m.role as Role, companies: cos, company, fys, fy, prefs: prefs ?? null };
});
export type Ctx = NonNullable<Awaited<ReturnType<typeof getCtx>>>;
export type CompanyCtx = Ctx & { company: NonNullable<Ctx["company"]>; fy: NonNullable<Ctx["fy"]> };

export async function requireCtx(): Promise<Ctx> {
  const c = await getCtx();
  if (!c) redirect("/login");
  return c;
}
/** Page-level guard: authenticated + has an active company and FY. */
export async function requireCompany(): Promise<CompanyCtx> {
  const c = await requireCtx();
  if (!c.company || !c.fy) redirect("/onboarding");
  return c as CompanyCtx;
}
export function assertCan(ctx: { role: string }, perm: Perm) {
  if (!can(ctx.role, perm)) throw new Error(`Your role (${ctx.role}) does not permit this action.`);
}
