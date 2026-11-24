import fs from "node:fs/promises";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { apiCtx, json } from "@/lib/http";
import { createUploadReadUrl } from "@/services/upload-storage";

export const dynamic = "force-dynamic";
/** Access-controlled download: org + company scoped. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await apiCtx(req, { needCompany: true }); if ("error" in a) return a.error;
  const { id } = await params;
  const [d] = await db.select().from(documents).where(and(eq(documents.id, id), eq(documents.orgId, a.ctx.org.id), eq(documents.companyId, a.ctx.company.id), isNull(documents.deletedAt)));
  if (!d) return json({ error: "Not found" }, 404);
  if (d.storagePath.startsWith("s3://")) {
    const url = await createUploadReadUrl(d.storagePath.slice("s3://".length), d.mime, d.name);
    return Response.redirect(url, 302);
  }
  try { const buf = await fs.readFile(d.storagePath); return new Response(new Uint8Array(buf), { headers: { "Content-Type": d.mime, "Content-Disposition": `attachment; filename="${d.name.replace(/"/g, "")}"`, "X-Content-Type-Options": "nosniff" } }); }
  catch { return json({ error: "File missing from storage" }, 410); }
}
