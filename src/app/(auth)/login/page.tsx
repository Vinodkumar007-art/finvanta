import { redirect } from "next/navigation";
import Link from "next/link";
import { LoginForm } from "@/components/AuthForms";
import { OAuthButtons } from "@/components/OAuthButtons";
import { getCtx } from "@/lib/ctx";

export const metadata = {
  title: "Sign in",
  description: "Sign in to FINVANTA for accounting, compliance, financial analysis and approval-controlled AI assistance.",
};
export default async function Page({ searchParams }: { searchParams: Promise<{ reset?: string; error?: string }> }) {
  if (await getCtx()) redirect("/dashboard");
  const sp = await searchParams;
  const oauthErrors: Record<string, string> = {
    access_denied: "Sign-in was cancelled. You can try again at any time.",
    email_verification_required: "Your provider email is not verified. Sign in with your existing account, then explicitly connect the provider from Settings.",
    invalid_state: "This sign-in attempt expired or could not be verified. Please try again.",
    account_already_linked: "That provider account is already connected to a different FINVANTA account.",
    provider_already_linked: "A different account from that provider is already connected.",
    provider_error: "The identity provider could not complete sign-in. Please try again.",
    provider_unavailable: "Social sign-in is not configured for this provider.",
    mfa_required: "This account requires an authenticator code. Sign in with your password and MFA code, then manage connected providers from Settings.",
    oauth_error: "Social sign-in could not be completed. Please try again.",
  };
  const oauthError = sp.error ? oauthErrors[sp.error] ?? oauthErrors.oauth_error : null;
  return (
    <div className="fade-up">
      <div className="mb-6">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">Your secure workspace</p>
        <h1 className="text-3xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">Sign in to continue with your company books, financial workflows and AI assistant.</p>
      </div>
      <div className="rounded-2xl border border-line bg-panel p-5 shadow-2xl shadow-black/10 sm:p-6">
        {oauthError && <p role="alert" className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">{oauthError}</p>}
        <LoginForm reset={!!sp.reset} />
        <OAuthButtons />
      </div>
      <div className="mt-4 rounded-xl border border-accent/20 bg-accent/5 p-3.5">
        <p className="text-xs font-semibold">Built for financial control</p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">Your organisation’s records stay isolated. AI can explain figures and prepare drafts, but it never posts without your approval.</p>
      </div>
      <div className="mt-5 flex items-center justify-between text-[11px] text-muted">
        <Link href="/" className="hover:text-fg">Back to FINVANTA home</Link>
        <span>Created by Vinod Kumar</span>
      </div>
    </div>
  );
}
