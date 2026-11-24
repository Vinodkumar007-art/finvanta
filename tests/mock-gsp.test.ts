import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createGspClient } from "@/services/gsp/client";

vi.mock("server-only", () => ({}));

const serverPath = fileURLToPath(new URL("../mock-gsp/server.mjs", import.meta.url));
const gstin = "27AABCU9603R1ZM";
const draftInput = {
  period: "2026-10",
  gstin,
  lineItems: [{ description: "Taxable supply", taxableValue: 1000, taxRate: 18, igst: 180 }],
};

let child: ChildProcessWithoutNullStreams;
let baseUrl: string;
let accessToken: string;

function startMockServer(env: Partial<NodeJS.ProcessEnv> = {}) {
  const server = spawn(process.execPath, [serverPath], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "development", GST_ENV: "sandbox", GSP_ENV: "sandbox", GSP_MOCK_PORT: "0", ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  server.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  const ready = new Promise<string>((resolve, reject) => {
    let stdout = "";
    const timer = setTimeout(() => reject(new Error(`Mock GSP did not start. ${stderr}`)), 10_000);
    server.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const match = stdout.match(/MOCK_GSP_LISTENING (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    server.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Mock GSP exited before listening (${code}). ${stderr}`));
    });
  });
  return { server, ready };
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, init);
  return { response, body: await response.json() as Record<string, unknown> };
}

async function createDraft() {
  const response = await fetch(`${baseUrl}/returns/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(draftInput),
  });
  const body = await response.json() as { draftId: string };
  if (!response.ok) throw new Error(`Draft creation failed (${response.status}).`);
  return body.draftId;
}

beforeAll(async () => {
  const started = startMockServer();
  child = started.server;
  baseUrl = await started.ready;
  const auth = await request("/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: "test-client", clientSecret: "test-secret" }),
  });
  expect(auth.response.status).toBe(200);
  expect(auth.body.mock).toBe(true);
  accessToken = String(auth.body.access_token);
}, 15_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  if (!child || child.exitCode !== null) return;
  child.kill();
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
});

describe("local mock GSP server", () => {
  it("returns an unmistakably mocked health response", async () => {
    const { response, body } = await request("/health");
    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok", mock: true });
  });

  it("rejects empty credentials and unauthenticated filing calls", async () => {
    const auth = await request("/auth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: " ", clientSecret: "" }),
    });
    const submit = await request("/returns/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draftInput),
    });
    expect(auth.response.status).toBe(400);
    expect(auth.body.mock).toBe(true);
    expect(submit.response.status).toBe(401);
    expect(submit.body.mock).toBe(true);
  });

  it("validates and stores a draft, then returns its status", async () => {
    const invalid = await request("/returns/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ ...draftInput, period: "2026-13" }),
    });
    expect(invalid.response.status).toBe(400);
    expect(invalid.body.mock).toBe(true);

    const draftId = await createDraft();
    const stored = await request(`/returns/${draftId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const status = await request(`/returns/${draftId}/status`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(stored.body).toMatchObject({ draftId, status: "DRAFT", draft: draftInput, mock: true });
    expect(status.body).toMatchObject({ draftId, status: "DRAFT", mock: true });
  });

  it("uses the shared app client against the local mock", async () => {
    vi.stubEnv("GSP_PROVIDER", "mock");
    vi.stubEnv("GST_ENV", "sandbox");
    vi.stubEnv("GSP_ENV", "sandbox");
    vi.stubEnv("GSP_BASE_URL", baseUrl);
    vi.stubEnv("GSP_CLIENT_ID", "test-client");
    vi.stubEnv("GSP_CLIENT_SECRET", "test-secret");
    const client = createGspClient();
    await expect(client.authenticate()).resolves.toMatchObject({ mock: true });

    const draft = await client.createDraft(draftInput);
    const status = await client.getStatus(draft.draftId);
    expect(draft).toMatchObject({ status: "DRAFT", mock: true, draft: draftInput });
    expect(status).toMatchObject({ draftId: draft.draftId, status: "DRAFT", mock: true });
  });

  it("forces success and validation-error outcomes deterministically", async () => {
    const successDraftId = await createDraft();
    const success = await request(`/returns/${successDraftId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ forceOutcome: "success" }),
    });
    expect(success.response.status).toBe(200);
    expect(success.body).toMatchObject({ draftId: successDraftId, status: "FILED", mock: true });
    expect(success.body.arn).toMatch(/^MOCKARN\d{12}$/);

    const filedStatus = await request(`/returns/${successDraftId}/status`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(filedStatus.body).toMatchObject({ draftId: successDraftId, status: "FILED", mock: true });

    const errorDraftId = await createDraft();
    const failure = await request(`/returns/${errorDraftId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ forceOutcome: "error" }),
    });
    expect(failure.response.status).toBe(422);
    expect(failure.body).toMatchObject({
      draftId: errorDraftId,
      status: "REJECTED",
      mock: true,
      errors: [{ code: "MOCK_RET_1001" }],
    });
  });

  it("chooses a random submit outcome when forceOutcome is omitted", async () => {
    const draftId = await createDraft();
    const response = await fetch(`${baseUrl}/returns/${draftId}/submit`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json() as { mock: boolean; status: string };
    expect([200, 422, 504]).toContain(response.status);
    expect(body.mock).toBe(true);
    expect(["FILED", "REJECTED", "PENDING_APPROVAL"]).toContain(body.status);
  }, 15_000);

  it("fails closed instead of starting in production", async () => {
    const blocked = startMockServer({ NODE_ENV: "production" });
    const server = blocked.server;
    await expect(blocked.ready).rejects.toThrow("Mock GSP refuses to start");
    expect(server.exitCode).toBe(1);

    const productionEnv = startMockServer({ GSP_ENV: "production" });
    await expect(productionEnv.ready).rejects.toThrow("Mock GSP refuses to start");
    expect(productionEnv.server.exitCode).toBe(1);

    const gstProductionEnv = startMockServer({ GST_ENV: "production" });
    await expect(gstProductionEnv.ready).rejects.toThrow("Mock GSP refuses to start");
    expect(gstProductionEnv.server.exitCode).toBe(1);
  });

  it("returns a mocked 504 after the simulated timeout", async () => {
    const draftId = await createDraft();
    const result = await request(`/returns/${draftId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ forceOutcome: "timeout" }),
    });
    expect(result.response.status).toBe(504);
    expect(result.body).toMatchObject({
      draftId,
      status: "PENDING_APPROVAL",
      mock: true,
      error: { code: "MOCK_GSP_TIMEOUT" },
    });
  }, 15_000);
});
