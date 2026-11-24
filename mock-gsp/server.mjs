import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: ".env.local" });

const HOST = "127.0.0.1";
const MAX_BODY_BYTES = 1_000_000;
const tokenStore = new Map();
const draftStore = new Map();

const lineItemSchema = z.object({
  description: z.string().trim().min(1).max(240),
  taxableValue: z.number().finite().nonnegative(),
  taxRate: z.number().finite().min(0).max(100),
  igst: z.number().finite().nonnegative().default(0),
  cgst: z.number().finite().nonnegative().default(0),
  sgst: z.number().finite().nonnegative().default(0),
}).strict();

const draftSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "period must use YYYY-MM format"),
  gstin: z.string().regex(/^[0-9A-Z]{15}$/i, "GSTIN must be 15 alphanumeric characters").transform((value) => value.toUpperCase()),
  lineItems: z.array(lineItemSchema).min(1).max(1000),
}).strict();

const submitSchema = z.object({
  forceOutcome: z.enum(["success", "error", "timeout"]).optional(),
}).strict();

function send(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Mock-GSP": "true",
  });
  response.end(JSON.stringify({ ...body, mock: true }));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Request body exceeds the mock server limit.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.status = 400;
    throw error;
  }
}

function authenticate(request, response) {
  const token = request.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
  const expiresAt = token ? tokenStore.get(token) : undefined;
  if (!expiresAt || expiresAt <= Date.now()) {
    if (token) tokenStore.delete(token);
    send(response, 401, { error: { code: "MOCK_AUTH_REQUIRED", message: "A valid mock bearer token is required." } });
    return false;
  }
  return true;
}

function draftResponse(draft) {
  const { draftId, status, draft: payload, arn, filedAt } = draft;
  return { draftId, status, draft: payload, ...(arn ? { arn } : {}), ...(filedAt ? { filedAt } : {}), mock: true };
}

function chooseOutcome(forceOutcome) {
  if (forceOutcome) return forceOutcome;
  const value = randomInt(100);
  return value < 80 ? "success" : value < 90 ? "error" : "timeout";
}

function makeHandler() {
  return async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${HOST}`);
    const path = url.pathname;
    const method = request.method ?? "GET";

    if (method === "GET" && path === "/health") {
      return send(response, 200, { status: "ok", mock: true });
    }

    if (method === "POST" && path === "/auth/token") {
      let body;
      try {
        body = await readJson(request);
      } catch (error) {
        return send(response, error.status ?? 400, { error: { code: "MOCK_INVALID_JSON", message: error.message } });
      }
      if (typeof body?.clientId !== "string" || !body.clientId.trim()
        || typeof body?.clientSecret !== "string" || !body.clientSecret.trim()) {
        return send(response, 400, { error: { code: "MOCK_CREDENTIALS_REQUIRED", message: "clientId and clientSecret must be non-empty strings." } });
      }
      const accessToken = `mock_${randomBytes(24).toString("hex")}`;
      const expiresIn = 3600;
      tokenStore.set(accessToken, Date.now() + expiresIn * 1000);
      return send(response, 200, { access_token: accessToken, token_type: "Bearer", expires_in: expiresIn, mock: true });
    }

    const draftMatch = path.match(/^\/returns\/([^/]+)(?:\/(submit|status))?$/);
    if (method === "POST" && path === "/returns/draft") {
      if (!authenticate(request, response)) return;
      let body;
      try {
        body = await readJson(request);
      } catch (error) {
        return send(response, error.status ?? 400, { error: { code: "MOCK_INVALID_JSON", message: error.message } });
      }
      const parsed = draftSchema.safeParse(body);
      if (!parsed.success) {
        return send(response, 400, {
          error: {
            code: "MOCK_INVALID_DRAFT",
            message: "Draft payload failed validation.",
            details: parsed.error.issues.map(({ path: issuePath, message }) => ({ path: issuePath.join("."), message })),
          },
        });
      }
      const draft = { draftId: randomUUID(), status: "DRAFT", draft: parsed.data };
      draftStore.set(draft.draftId, draft);
      return send(response, 201, draftResponse(draft));
    }

    if (!draftMatch) return send(response, 404, { error: { code: "MOCK_NOT_FOUND", message: "Mock GSP endpoint not found." } });
    if (!authenticate(request, response)) return;
    const [, draftId, action] = draftMatch;
    const draft = draftStore.get(draftId);
    if (!draft) return send(response, 404, { error: { code: "MOCK_DRAFT_NOT_FOUND", message: "Draft was not found." } });

    if (method === "GET" && !action) return send(response, 200, draftResponse(draft));
    if (method === "GET" && action === "status") {
      return send(response, 200, {
        draftId,
        status: draft.status,
        ...(draft.arn ? { arn: draft.arn } : {}),
        ...(draft.filedAt ? { filedAt: draft.filedAt } : {}),
        mock: true,
      });
    }

    if (method === "POST" && action === "submit") {
      let body;
      try {
        body = await readJson(request);
      } catch (error) {
        return send(response, error.status ?? 400, { error: { code: "MOCK_INVALID_JSON", message: error.message } });
      }
      const parsed = submitSchema.safeParse(body);
      if (!parsed.success) {
        return send(response, 400, { error: { code: "MOCK_INVALID_OUTCOME", message: "forceOutcome must be success, error, or timeout." } });
      }
      if (draft.status === "FILED") {
        return send(response, 409, { error: { code: "MOCK_ALREADY_FILED", message: "This mock draft has already been filed." } });
      }

      draft.status = "PENDING_APPROVAL";
      const outcome = chooseOutcome(parsed.data.forceOutcome);
      if (outcome === "timeout") {
        await new Promise((resolve) => setTimeout(resolve, 8000));
        return send(response, 504, {
          draftId,
          status: draft.status,
          error: { code: "MOCK_GSP_TIMEOUT", message: "Simulated mock GSP timeout; no filing result is available." },
        });
      }
      if (outcome === "error") {
        draft.status = "REJECTED";
        return send(response, 422, {
          draftId,
          status: draft.status,
          errors: [{ code: "MOCK_RET_1001", message: "Simulated validation failure: GSTIN mismatch." }],
        });
      }

      draft.status = "FILED";
      draft.arn = `MOCKARN${randomInt(0, 1_000_000_000_000).toString().padStart(12, "0")}`;
      draft.filedAt = new Date().toISOString();
      return send(response, 200, {
        draftId,
        status: draft.status,
        arn: draft.arn,
        filedAt: draft.filedAt,
        mock: true,
      });
    }

    return send(response, 405, { error: { code: "MOCK_METHOD_NOT_ALLOWED", message: "Method is not supported for this endpoint." } });
  };
}

function createMockGspServer() {
  return createServer(makeHandler());
}

function assertMockGspAllowed(env = process.env) {
  if (env.NODE_ENV === "production" || env.GSP_ENV === "production" || env.GST_ENV === "production") {
    throw new Error("Mock GSP refuses to start when NODE_ENV, GST_ENV, or GSP_ENV is production.");
  }
  if (env.GSP_ENV && env.GSP_ENV !== "sandbox") {
    throw new Error("Mock GSP requires GSP_ENV=sandbox.");
  }
  if (env.GST_ENV !== "sandbox") {
    throw new Error("Mock GSP requires GST_ENV=sandbox.");
  }
}

const isEntryPoint = process.argv[1] && new URL(import.meta.url).href === new URL(`file://${process.argv[1]}`).href;
if (isEntryPoint) {
  try {
    assertMockGspAllowed();
    const port = Number(process.env.GSP_MOCK_PORT ?? 4000);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("GSP_MOCK_PORT must be an integer from 0 to 65535.");
    const server = createMockGspServer();
    server.listen(port, HOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Mock GSP failed to bind a TCP port.");
      console.log(`MOCK_GSP_LISTENING http://${HOST}:${address.port}`);
      console.warn("MOCK GSP — no real filing is happening.");
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Mock GSP failed to start.");
    process.exitCode = 1;
  }
}
