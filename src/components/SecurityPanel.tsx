"use client";
import { useActionState, useState, useTransition } from "react";
import { changePassword, confirmMfa, disableMfa, startMfa } from "@/actions/auth";

function ActionMessage({ state }: { state: { error?: string; ok?: string } | undefined }) {
  return state?.error ? <p role="alert" className="text-xs text-down">{state.error}</p> : state?.ok ? <p role="status" className="text-xs text-up">{state.ok}</p> : null;
}

export default function SecurityPanel({ mfaEnabled, email }: { mfaEnabled: boolean; email: string }) {
  const [secret, setSecret] = useState<string | null>(null); const [pending, start] = useTransition();
  const [c, ca, cp] = useActionState(confirmMfa, undefined); const [d, da, dp] = useActionState(disableMfa, undefined); const [p, pa, pp] = useActionState(changePassword, undefined);
  const uri = secret ? `otpauth://totp/FINVANTA:${encodeURIComponent(email)}?secret=${secret}&issuer=FINVANTA` : "";
  return (<div className="grid gap-6 md:grid-cols-2"><div className="space-y-3"><h3 className="text-sm font-semibold">Multi-factor authentication (TOTP)</h3><p className="text-xs text-muted">Status: <b className={mfaEnabled ? "text-up" : "text-warn"}>{mfaEnabled ? "enabled" : "not enabled"}</b>. Works with any authenticator app (RFC 6238).</p>
    {!mfaEnabled && !secret && <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => start(async () => { const r = await startMfa(); setSecret(r?.secret ?? null); })}>Set up MFA</button>}
    {!mfaEnabled && secret && (<form action={ca} className="space-y-2"><p className="text-xs">Add this key in your authenticator app (manual entry), then enter the 6-digit code:</p><code className="num block break-all rounded border border-line bg-bg2 p-2 text-xs">{secret}</code><a className="text-[11px] text-accent underline" href={uri}>Open otpauth link</a><input className="inp num" name="code" inputMode="numeric" maxLength={6} placeholder="123456" required /><button className="btn btn-primary btn-sm" disabled={cp}>Verify & enable</button><ActionMessage state={c} /></form>)}
    {mfaEnabled && <form action={da} className="space-y-2"><input className="inp" type="password" name="password" placeholder="Confirm password to disable" required /><button className="btn btn-sm" disabled={dp}>Disable MFA</button><ActionMessage state={d} /></form>}</div>
    <form action={pa} className="space-y-2"><h3 className="text-sm font-semibold">Change password</h3><input className="inp" type="password" name="current" placeholder="Current password" required /><input className="inp" type="password" name="next" placeholder="New password (min 10 chars)" minLength={10} required /><button className="btn btn-sm" disabled={pp}>Update password</button><ActionMessage state={p} /></form></div>);
}
