import { eq } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { deleteUploadObject, listUploadObjectPage } from "@/services/upload-storage";

const ORPHAN_GRACE_PERIOD_MS = 60 * 60 * 1000;

export async function cleanupOrphanedUploadObjects(continuationToken?: string) {
  const cutoff = Date.now() - ORPHAN_GRACE_PERIOD_MS;
  let scanned = 0;
  let deleted = 0;
  const page = await listUploadObjectPage(continuationToken);
  for (const object of page.objects) {
    scanned += 1;
    if (!object.lastModified || object.lastModified.getTime() >= cutoff) continue;

    const [, , documentId] = object.key.split("/");
    if (!documentId) continue;
    const [document] = await db.select({ id: documents.id }).from(documents).where(eq(documents.id, documentId)).limit(1);
    if (document) continue;
    await deleteUploadObject(object.key);
    deleted += 1;
  }
  return { scanned, deleted, continuationToken: page.continuationToken ?? null };
}
