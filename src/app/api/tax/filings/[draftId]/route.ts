import { apiCtx, json } from "@/lib/http";
import { getGstFilingService, gstFilingApiError } from "@/services/gst-filing";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ draftId: string }> }) {
  const auth = await apiCtx(req, { needCompany: true });
  if ("error" in auth) return auth.error;
  const { draftId } = await params;
  try {
    const service = await getGstFilingService();
    return json({ draft: await service.getDraft(auth.ctx.company.id, draftId) });
  } catch (error) {
    const result = gstFilingApiError(error);
    return json({ error: result.message }, result.status);
  }
}
