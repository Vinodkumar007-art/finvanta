import { z } from "zod";
import { can } from "@/lib/ctx";
import { apiCtx, json } from "@/lib/http";
import { getGstFilingService, gstFilingApiError } from "@/services/gst-filing";

const otpActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request") }).strict(),
  z.object({ action: z.literal("verify"), code: z.string().regex(/^\d{6}$/) }).strict(),
]);

export async function POST(req: Request, { params }: { params: Promise<{ draftId: string }> }) {
  const auth = await apiCtx(req, { mutate: true, needCompany: true });
  if ("error" in auth) return auth.error;
  if (!can(auth.ctx.role, "approve")) return json({ error: "An approver role is required for GST approval." }, 403);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }
  const parsed = otpActionSchema.safeParse(body);
  if (!parsed.success) return json({ error: "Use action=request or action=verify with a six-digit code." }, 400);
  const { draftId } = await params;
  try {
    const service = await getGstFilingService();
    if (parsed.data.action === "request") {
      return json(await service.requestApprovalCode(auth.ctx.company.id, draftId, auth.ctx.user.id));
    }
    const result = await service.verifyApprovalCode(auth.ctx.company.id, draftId, auth.ctx.user.id, parsed.data.code);
    if (!result.success) {
      const message = result.status === "locked" ? "Too many incorrect codes. Approval is locked for 15 minutes."
        : result.status === "expired" ? "The approval code expired. Request a new code."
          : result.status === "already_verified" ? "This code has already been used."
            : "The approval code is incorrect.";
      return json({ error: message, attempts: result.attempts, lockedUntil: result.lockedUntil }, 400);
    }
    return json({ approved: true, message: "Approval verified. Mock submission is now available for ten minutes." });
  } catch (error) {
    const result = gstFilingApiError(error);
    return json({ error: result.message }, result.status);
  }
}
