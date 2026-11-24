# GSP mock and ClearTax switchover

## Local mock

The local GSP server is a development aid only. It binds to `127.0.0.1`, keeps data in memory, and every response contains `"mock": true`. It requires `GST_ENV=sandbox` and refuses to start when `NODE_ENV`, `GST_ENV`, or `GSP_ENV` is production. A mock `FILED` state and ARN are fabricated; they are not GSTN submissions or acknowledgments.

The app now has a company-scoped, OTP-gated development workflow: approved source invoices are calculated deterministically; the configured LLM may only review a sanitized draft; a human approver must request and verify a six-digit code; and only then can the server call the mock GSP. The submit API independently checks the persisted approval and its ten-minute expiry. The browser never receives an OTP and cannot choose `forceOutcome`.

OTP delivery is intentionally a development console stub, not SMS: the server prints the code with the label `[DEV OTP — remove before production]`. Do not deploy this sender. No SMS provider or registered Indian DLT template is configured. The GSP mock remains memory-only and does not enforce the app's OTP gate itself.

Purchase tax is shown from approved purchase invoices, but claimed ITC remains zero because ITC eligibility and GSTR-2B matching are not available in the source data. HSN-rate mapping is also not configured. These checks are disclosed in the review screen; no late fee or interest amount is estimated.

Run the app and mock in separate terminals:

1. Configure `.env.local` (the standalone mock server reads this file):

   ```dotenv
   GST_ENV=sandbox
   GSP_PROVIDER=mock
   GSP_ENV=sandbox
   GSP_BASE_URL=http://127.0.0.1:4000
   GSP_MOCK_PORT=4000
   GSP_CLIENT_ID=local-test-client
   GSP_CLIENT_SECRET=local-test-secret
   ```

2. Terminal 1: `npm run mock:gsp`
3. Terminal 2: `npm run dev`

Apply the schema and append-only audit triggers with `npx drizzle-kit migrate` before using the workflow. The tax workspace shows `GST ENV: SANDBOX` and a persistent `MOCK GSP — no real filing is happening` banner. The legal disclaimer and AI-review warning are shown in the filing flow.

The mock exposes `GET /health`, `POST /auth/token`, `POST /returns/draft`, `GET /returns/:draftId`, `GET /returns/:draftId/status`, and `POST /returns/:draftId/submit`. Submit accepts `forceOutcome: "success" | "error" | "timeout"` for deterministic local tests. Without it, outcomes are randomly distributed 80% success, 10% validation error, and 10% timeout. A timeout waits eight seconds and returns HTTP 504. No automatic retry is performed.

## ClearTax status and switch checklist

ClearTax's public [GST GSP documentation](https://docs.cleartax.in/cleartax-docs/gst-gsp-api/gst-gsp-api-reference.md) currently documents the sandbox host `https://api-sandbox.clear.in` and environment/onboarding details, but not the endpoint and payload contract required by this app's `authenticate`, `createDraft`, `submitReturn`, and `getStatus` methods. Consequently, `GSP_PROVIDER=cleartax` is deliberately fail-closed in this build. Do not switch to ClearTax or attempt a real submission until the applicable ClearTax API contract is available and the adapter is implemented and reviewed.

When ClearTax credentials and API documentation arrive, the intended configuration is:

```dotenv
GSP_PROVIDER=cleartax
GSP_ENV=sandbox
GSP_BASE_URL=https://api-sandbox.clear.in
GSP_CLIENT_ID=<server-side ClearTax client ID>
GSP_CLIENT_SECRET=<server-side ClearTax client secret>
```

These settings alone are not currently sufficient to enable ClearTax calls. Keep the credentials server-side and never add them to browser code or commit them.

Before any production discussion:

- Confirm the ClearTax-documented health/auth endpoint and verify sandbox connectivity.
- Create one draft with a ClearTax-provided sandbox GSTIN and verify the returned shape.
- Exercise a documented validation failure; `forceOutcome` is mock-only and must never be sent to ClearTax.
- Configure and verify a dedicated SMS OTP provider and the required Indian DLT template before considering any real filing.
- Complete one successful sandbox filing through the human approval/OTP workflow and verify the sandbox response with ClearTax.
- Re-test the failed-submit and timeout paths. Do not automatically retry an ambiguous submit.
- Keep `GSP_ENV=sandbox`. Production remains disabled until the user separately confirms a successful sandbox filing and explicitly authorizes production work.

ClearTax sandbox GSTINs are restricted to the test numbers they provide; do not assume a real GSTIN will work in the sandbox. Confirm the valid test GSTINs with ClearTax.
