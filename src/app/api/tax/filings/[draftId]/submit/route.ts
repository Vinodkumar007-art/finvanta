import { can } from "@/lib/ctx";
import { apiCtx, json } from "@/lib/http";
import { getGstFilingService, gstFilingApiError } from "@/services/gst-filing";

export async function POST(req: Request, { params }: { params: Promise<{ draftId: string }> }) {
  const auth = await apiCtx(req, { mutate: true, needCompany: true });
  if ("error" in auth) return auth.error;
  if (!can(auth.ctx.role, "approve")) return json({ error: "An approver role is required to submit a GST draft." }, 403);
  const { draftId } = await params;
  try {
    const service = await getGstFilingService();
    const draft = await service.submit(auth.ctx.company.id, draftId, auth.ctx.user.id);
    return json({ draft });
  } catch (error) {
    const result = gstFilingApiError(error);
    return json({ error: result.message }, result.status);
  }
}
