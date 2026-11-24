import { z } from "zod";

export const GspStatusSchema = z.enum(["DRAFT", "PENDING_APPROVAL", "FILED", "REJECTED"]);
export type GspStatus = z.infer<typeof GspStatusSchema>;

export const GspDraftRequestSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM for the return period."),
  gstin: z.string().regex(/^[0-9A-Z]{15}$/i, "GSTIN must be 15 alphanumeric characters."),
  lineItems: z.array(z.object({
    description: z.string().trim().min(1).max(240),
    taxableValue: z.number().finite().nonnegative(),
    taxRate: z.number().finite().min(0).max(100),
    igst: z.number().finite().nonnegative().optional(),
    cgst: z.number().finite().nonnegative().optional(),
    sgst: z.number().finite().nonnegative().optional(),
  }).strict()).min(1).max(1000),
}).strict();
export type GspDraftRequest = z.infer<typeof GspDraftRequestSchema>;

export const GspAuthTokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().positive(),
  mock: z.literal(true),
}).strict();
export type GspAuthToken = z.infer<typeof GspAuthTokenSchema>;

export const GspDraftResponseSchema = z.object({
  draftId: z.string().uuid(),
  status: GspStatusSchema,
  draft: GspDraftRequestSchema,
  arn: z.string().optional(),
  filedAt: z.string().datetime().optional(),
  mock: z.literal(true),
}).strict();
export type GspDraftResponse = z.infer<typeof GspDraftResponseSchema>;

export const GspStatusResponseSchema = z.object({
  draftId: z.string().uuid(),
  status: GspStatusSchema,
  arn: z.string().optional(),
  filedAt: z.string().datetime().optional(),
  mock: z.literal(true),
}).strict();
export type GspStatusResponse = z.infer<typeof GspStatusResponseSchema>;

export const GspSubmitResponseSchema = z.object({
  draftId: z.string().uuid(),
  status: z.literal("FILED"),
  arn: z.string().regex(/^MOCKARN\d{12}$/),
  filedAt: z.string().datetime(),
  mock: z.literal(true),
}).strict();
export type GspSubmitResponse = z.infer<typeof GspSubmitResponseSchema>;

export type GspClient = {
  readonly provider: "mock" | "cleartax";
  authenticate(): Promise<GspAuthToken>;
  createDraft(draft: GspDraftRequest): Promise<GspDraftResponse>;
  getStatus(draftId: string): Promise<GspStatusResponse>;
  submitReturn(draftId: string): Promise<GspSubmitResponse>;
};
