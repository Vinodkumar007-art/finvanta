import { timingSafeEqual } from "node:crypto";
import { apiCtx, json } from "@/lib/http";
import { can } from "@/lib/ctx";
import { cleanupOrphanedUploadObjects } from "@/services/upload-cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validJobSecret(request: Request, expected: string): boolean {
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

export async function POST(request: Request) {
  const secret = process.env.UPLOADS_CLEANUP_SECRET?.trim();
  if (!secret || !validJobSecret(request, secret)) {
    const auth = await apiCtx(request, { mutate: true });
    if ("error" in auth) return auth.error;
    if (!can(auth.ctx.role, "admin")) return json({ error: "Administrator access is required." }, 403);
  }

  try {
    const continuationToken = new URL(request.url).searchParams.get("cursor") ?? undefined;
    const result = await cleanupOrphanedUploadObjects(continuationToken);
    return json(result);
  } catch (error) {
    console.error("[finvanta] orphan upload cleanup failed", error);
    return json({ error: "Upload cleanup could not be completed." }, 500);
  }
}
