import { eq } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { memberships, oauthAccounts, users } from "@/db/schema";
import { requireCtx, can } from "@/lib/ctx";
import { Badge, Card, Notice, PageHeader } from "@/components/ui";
import ActionForm from "@/components/ActionForm";
import SecurityPanel from "@/components/SecurityPanel";
import { addMember, setMemberRole, updateProfile } from "@/actions/settings";
import { setupCompany } from "@/actions/auth";
import { STATES } from "@/lib/states";
import { providers } from "@/services/market";

export const metadata = { title: "Settings & Security" };
export default async function Settings({ searchParams }: { searchParams: Promise<{ oauth_error?: string }> }) {
  const search = await searchParams;
  const oauthMessages: Record<string, string> = {
    access_denied: "Provider connection was cancelled.",
    account_already_linked: "That provider account is connected to a different FINVANTA account.",
    email_verification_required: "The provider did not verify a matching email. Sign in with an existing account before connecting it.",
    invalid_state: "The provider connection expired or could not be verified. Please try again.",
    mfa_required: "This account requires password and authenticator verification before social sign-in.",
    provider_already_linked: "A different account from that provider is already connected.",
    provider_error: "The identity provider could not complete the connection. Please try again.",
    provider_unavailable: "Social sign-in is not configured for this provider.",
    oauth_error: "The provider account could not be connected.",
  };
  const oauthError = search.oauth_error ? oauthMessages[search.oauth_error] ?? oauthMessages.oauth_error : null;
  const ctx = await requireCtx(); const [me] = await db.select().from(users).where(eq(users.id, ctx.user.id));
  const members = await db.select({ id: users.id, name: users.name, email: users.email, role: memberships.role }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.orgId, ctx.org.id));
  const linkedProviders = await db.select({ provider: oauthAccounts.provider, email: oauthAccounts.providerEmail, verified: oauthAccounts.emailVerified })
    .from(oauthAccounts).where(eq(oauthAccounts.userId, ctx.user.id));
  const googleOAuthReady = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.OAUTH_TOKEN_ENCRYPTION_KEY);
  const githubOAuthReady = Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET && process.env.OAUTH_TOKEN_ENCRYPTION_KEY);
  const admin = can(ctx.role, "admin"); const p = providers();
  return (<><PageHeader title="Settings & Security" desc="Profile, authentication, workspace members and role-based access." crumbs={[{ label: "Workspace" }, { label: "Settings" }]} />
    {oauthError && <p role="alert" className="mb-4 rounded-lg border border-down/40 bg-down/5 px-3 py-2 text-xs text-down">{oauthError}</p>}
    <div className="grid gap-4 lg:grid-cols-2"><Card title="Profile"><ActionForm submit="Save" cols={1} resetOnOk={false} action={updateProfile} fields={[{ name: "name", label: "Display name", defaultValue: ctx.user.name }]} /><p className="mt-2 text-xs text-muted">{ctx.user.email} · role <b className="uppercase">{ctx.role}</b> in {ctx.org.name}. Theme and accent colour are in the avatar menu (top right).</p></Card>
      <Card title="Authentication"><SecurityPanel mfaEnabled={!!me?.mfaEnabled} email={ctx.user.email} /><p className="mt-3 text-[11px] text-muted">Passwords are hashed with scrypt; sessions are server-side with HttpOnly cookies and are revoked on password reset. Google and GitHub sign-in use PKCE and FINVANTA sessions.</p></Card>
      <Card title="Social sign-in">
        <p className="mb-3 text-xs text-muted">Connect a provider to this signed-in account. Provider tokens are encrypted at rest and never sent to the browser.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {(["google", "github"] as const).map((provider) => {
            const linked = linkedProviders.find((account) => account.provider === provider);
            const configured = provider === "google" ? googleOAuthReady : githubOAuthReady;
            return <div key={provider} className="flex flex-col gap-2 rounded-xl border border-line p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{provider === "google" ? "Google" : "GitHub"}</span>
                <Badge tone={linked ? "up" : "neutral"}>{linked ? "connected" : configured ? "not connected" : "not configured"}</Badge>
              </div>
              {linked?.email && <p className="text-[11px] text-muted">{linked.email}{linked.verified ? " · verified" : ""}</p>}
              {configured && <Link className="btn btn-sm justify-center" href={`/api/auth/oauth/${provider}`}>{linked ? "Reconnect" : "Connect account"}</Link>}
            </div>;
          })}
        </div>
      </Card>
      <Card title="Members & roles" className="lg:col-span-2 min-w-0" pad={false}><div className="min-w-0 p-3"><div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th /></tr></thead><tbody>{members.map((m) => <tr key={m.id}><td>{m.name}</td><td>{m.email}</td><td><Badge tone={m.role === "owner" ? "accent" : "neutral"}>{m.role}</Badge></td><td className="flex flex-wrap gap-1">{admin && m.role !== "owner" && m.id !== ctx.user.id && ["admin", "accountant", "analyst", "viewer"].filter((r) => r !== m.role).map((r) => <form key={r} action={setMemberRole.bind(null, m.id, r)}><button className="btn btn-sm">→ {r}</button></form>)}</td></tr>)}</tbody></table></div>
        <div className="mt-3 grid gap-4 md:grid-cols-2"><div className="rounded-lg border border-line p-3 text-xs text-muted"><b className="text-fg">Permission model</b><br />owner/admin: everything incl. period close, members · accountant: post, approve, reverse, tax · analyst: write analyses/models, no approvals · viewer: read-only. Every organisation’s data is isolated by organisation and company IDs on every query.</div>{admin ? <ActionForm submit="Add existing user" cols={2} action={addMember} fields={[{ name: "email", label: "User email (must already be registered)", required: true, span: 2 }, { name: "role", label: "Role", type: "select", options: [["accountant", "Accountant"], ["analyst", "Analyst"], ["viewer", "Viewer"], ["admin", "Admin"]], span: 2 }]} /> : <Notice>Admin role required to manage members.</Notice>}</div></div></Card>
      <Card title="Add another company (multi-company)" className="lg:col-span-2">{can(ctx.role, "write") ? <ActionForm submit="Create company" cols={4} action={setupCompany} fields={[{ name: "name", label: "Legal name", required: true, span: 2 }, { name: "gstin", label: "GSTIN" }, { name: "pan", label: "PAN" }, { name: "stateCode", label: "State", type: "select", options: STATES.map(([c, n]) => [c, `${c} · ${n}`] as [string, string]), defaultValue: "27" }, { name: "currency", label: "Currency", type: "select", options: ["INR", "USD", "EUR", "GBP", "AED", "SGD"].map((c) => [c, c] as [string, string]) }, { name: "fyStart", label: "FY start", type: "select", options: [["4", "April"], ["1", "January"], ["7", "July"], ["10", "October"]] }]} /> : <p className="text-xs text-muted">Read-only role.</p>}</Card>
      <Card title="Integrations status" className="lg:col-span-2"><div className="flex flex-wrap gap-2 text-xs">{[["OpenAI", p.openai], ["Financial Modeling Prep", p.fmp], ["Twelve Data", p.twelve], ["Indian Market API", p.indianMarket], ["FRED (U.S. macro)", p.fred], ["Email (Resend)", !!process.env.RESEND_API_KEY], ["OCR provider", false], ["OAuth", googleOAuthReady || githubOAuthReady], ["Bank connectivity", false], ["GSTN / IRP / TRACES filing", false]].map(([k, v]) => <span key={String(k)} className="flex items-center gap-1 rounded-lg border border-line px-2 py-1">{String(k)} <Badge tone={v ? "up" : "neutral"}>{v ? "configured" : "not configured"}</Badge></span>)}</div><p className="mt-2 text-[11px] text-muted">Secrets live in server environment variables only. Unconfigured integrations are never simulated.</p></Card></div></>);
}
