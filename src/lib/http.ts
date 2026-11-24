import { getCtx, type CompanyCtx } from "./ctx";

export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

/** CSRF defence for cookie-authenticated mutations: require same-origin Origin header. */
export function sameOrigin(req: Request) {
  const o = req.headers.get("origin");
  if (!o) return true; // non-browser or same-origin GET-like navigation
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try { return new URL(o).host === host; } catch { return false; }
}

export async function apiCtx(req: Request, opts: { mutate?: boolean; needCompany?: boolean } = {}) {
  if (opts.mutate && !sameOrigin(req)) return { error: json({ error: "Cross-origin request blocked." }, 403) } as const;
  const ctx = await getCtx();
  if (!ctx) return { error: json({ error: "Not authenticated." }, 401) } as const;
  if (opts.needCompany && (!ctx.company || !ctx.fy)) return { error: json({ error: "No active company." }, 400) } as const;
  return { ctx: ctx as CompanyCtx } as const;
}
