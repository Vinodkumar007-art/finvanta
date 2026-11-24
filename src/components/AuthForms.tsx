"use client";
import Link from "next/link";
import { useActionState } from "react";
import { forgotPassword, login, resetPassword, setupCompany, signup, type FormState } from "@/actions/auth";
import { STATES } from "@/lib/states";

function Msg({ s }: { s: FormState }) {
  if (!s) return null;
  return (<>
    {s.error && <div role="alert" className="rounded-lg border border-down/40 bg-down/5 px-3 py-2 text-xs text-down">{s.error}</div>}
    {s.ok && <div role="status" className="rounded-lg border border-up/40 bg-up/5 px-3 py-2 text-xs text-up">{s.ok}</div>}
  </>);
}
const L = ({ t, children }: { t: string; children: React.ReactNode }) => <label className="block text-xs"><span className="mb-1 block font-medium text-muted">{t}</span>{children}</label>;

export function LoginForm({ reset }: { reset?: boolean }) {
  const [s, act, pending] = useActionState(login, undefined);
  return (
    <form action={act} className="space-y-3">
      {reset && <div className="rounded-lg border border-up/40 bg-up/5 px-3 py-2 text-xs text-up">Password updated. Sign in with your new password.</div>}
      <L t="Email"><input className="inp" name="email" type="email" autoComplete="email" required /></L>
      <L t="Password"><input className="inp" name="password" type="password" autoComplete="current-password" required /></L>
      {s?.needMfa && <L t="Authenticator code"><input className="inp num" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus required /></L>}
      <Msg s={s} />
      <button className="btn btn-primary w-full justify-center" disabled={pending}>{pending ? "Signing in…" : s?.needMfa ? "Verify & sign in" : "Sign in"}</button>
      <div className="flex justify-between text-xs text-muted"><Link href="/forgot-password" className="hover:text-fg">Forgot password?</Link><Link href="/signup" className="text-accent">Create account</Link></div>
    </form>
  );
}
export function SignupForm() {
  const [s, act, pending] = useActionState(signup, undefined);
  return (
    <form action={act} className="space-y-3">
      <L t="Your name"><input className="inp" name="name" autoComplete="name" required /></L>
      <L t="Work email"><input className="inp" name="email" type="email" autoComplete="email" required /></L>
      <L t="Organisation name"><input className="inp" name="orgName" required /></L>
      <L t="Password (min 10 characters)"><input className="inp" name="password" type="password" minLength={10} autoComplete="new-password" required /></L>
      <Msg s={s} />
      <button className="btn btn-primary w-full justify-center" disabled={pending}>{pending ? "Creating…" : "Create workspace"}</button>
      <p className="text-center text-xs text-muted">Already registered? <Link href="/login" className="text-accent">Sign in</Link></p>
    </form>
  );
}
export function ForgotForm() {
  const [s, act, pending] = useActionState(forgotPassword, undefined);
  return (
    <form action={act} className="space-y-3">
      <L t="Account email"><input className="inp" name="email" type="email" required /></L>
      <Msg s={s} />
      <button className="btn btn-primary w-full justify-center" disabled={pending}>Request reset link</button>
      <p className="text-center text-xs"><Link href="/login" className="text-accent">Back to sign in</Link></p>
    </form>
  );
}
export function ResetForm({ token }: { token: string }) {
  const [s, act, pending] = useActionState(resetPassword, undefined);
  return (
    <form action={act} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <L t="New password (min 10 characters)"><input className="inp" name="password" type="password" minLength={10} required /></L>
      <Msg s={s} />
      <button className="btn btn-primary w-full justify-center" disabled={pending}>Set new password</button>
    </form>
  );
}
export function OnboardingForm() {
  const [s, act, pending] = useActionState(setupCompany, undefined);
  return (
    <form action={act} className="space-y-3">
      <L t="Company legal name"><input className="inp" name="name" required /></L>
      <div className="grid grid-cols-2 gap-3">
        <L t="GSTIN (optional)"><input className="inp num uppercase" name="gstin" maxLength={15} /></L>
        <L t="PAN (optional)"><input className="inp num uppercase" name="pan" maxLength={10} /></L>
        <L t="TAN (optional)"><input className="inp num uppercase" name="tan" maxLength={10} /></L>
        <L t="State (GST place of supply)"><select className="inp" name="stateCode" defaultValue="27">{STATES.map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}</select></L>
        <L t="Base currency"><select className="inp" name="currency"><option>INR</option><option>USD</option><option>EUR</option><option>GBP</option><option>AED</option><option>SGD</option></select></L>
        <L t="Financial year starts"><select className="inp" name="fyStart" defaultValue="4"><option value="4">April (India standard)</option><option value="1">January</option><option value="7">July</option><option value="10">October</option></select></L>
      </div>
      <label className="flex items-start gap-2 rounded-lg border border-line p-3 text-xs"><input type="checkbox" name="demo" className="mt-0.5" /><span><b>Load clearly-labelled demo data</b> — fictional parties, invoices, vouchers, bank lines and a budget (all tagged “[DEMO]”) posted through the real accounting engine, so you can explore every module. Leave unchecked for a clean book.</span></label>
      <Msg s={s} />
      <button className="btn btn-primary w-full justify-center" disabled={pending}>{pending ? "Creating books…" : "Create company & open dashboard"}</button>
      <p className="text-[11px] text-muted">A default chart of accounts, TDS section table and the current financial year are created automatically. You can add companies later.</p>
    </form>
  );
}
