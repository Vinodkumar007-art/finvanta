import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { apiCtx, json } from "@/lib/http";
import { createUploadReadUrl } from "@/services/upload-storage";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await apiCtx(request, { needCompany: true });
  if ("error" in auth) return auth.error;
  const { id } = await params;
  const [document] = await db.select().from(documents).where(and(
    eq(documents.id, id),
    eq(documents.orgId, auth.ctx.org.id),
    eq(documents.companyId, auth.ctx.company.id),
    isNull(documents.deletedAt),
  ));
  if (!document || !document.storagePath.startsWith("s3://")) return json({ error: "Not found." }, 404);
  const key = document.storagePath.slice("s3://".length);
  const url = await createUploadReadUrl(key, document.mime, document.name);
  return json({ id: document.id, url, expiresIn: 300 });
}
