import Link from "next/link";
import { oauthProviderReadiness, type OAuthProvider } from "@/lib/oauth-config";

const LABELS: Record<OAuthProvider, string> = {
  google: "Google",
  github: "GitHub",
};

export function OAuthButtons() {
  const providers = (["google", "github"] as const)
    .map((provider) => ({ provider, ...oauthProviderReadiness(provider) }))
    .filter((provider) => provider.hasCredentials);

  if (!providers.length) return null;

  return (
    <div className="mt-5 border-t border-line pt-4">
      <p className="mb-3 text-center text-xs text-muted">Or continue with</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {providers.map(({ provider, ready, missing }) => (
          ready ? (
            <Link key={provider} className="btn justify-center" href={`/api/auth/oauth/${provider}`}>
              Continue with {LABELS[provider]}
            </Link>
          ) : (
            <button
              key={provider}
              className="btn justify-center"
              type="button"
              disabled
              aria-describedby={`${provider}-oauth-status`}
              title={`Configure ${missing.join(", ")} on the server.`}
            >
              Continue with {LABELS[provider]}
            </button>
          )
        ))}
      </div>
      {providers.filter(({ ready }) => !ready).map(({ provider, missing }) => (
        <p
          key={provider}
          id={`${provider}-oauth-status`}
          role="status"
          className="mt-2 text-center text-[11px] text-muted"
        >
          {LABELS[provider]} sign-in is unavailable. Configure {missing.join(", ")} on the server.
        </p>
      ))}
    </div>
  );
}
