import { beginOAuthResponse } from "@/services/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return beginOAuthResponse("github", request);
}
