import { z } from "zod";
import { apiCtx, json } from "@/lib/http";
import { can } from "@/lib/ctx";
import { getGstFilingService, gstFilingApiError } from "@/services/gst-filing";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM for the return period."),
}).strict();

export async function GET(req: Request) {
  const auth = await apiCtx(req, { needCompany: true });
  if ("error" in auth) return auth.error;
  try {
    const service = await getGstFilingService();
    return json({ drafts: await service.listDrafts(auth.ctx.company.id) });
  } catch {
    return json({ error: "Could not load GST filing drafts." }, 500);
  }
}

export async function POST(req: Request) {
  const auth = await apiCtx(req, { mutate: true, needCompany: true });
  if ("error" in auth) return auth.error;
  if (!can(auth.ctx.role, "write")) return json({ error: "Your role does not permit creating GST drafts." }, 403);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? "Invalid GST filing period." }, 400);
  try {
    const service = await getGstFilingService();
    const draft = await service.createDraft(auth.ctx.company.id, auth.ctx.user.id, parsed.data.period);
    return json({ draft }, 201);
  } catch (error) {
    const result = gstFilingApiError(error);
    return json({ error: result.message }, result.status);
  }
}
