# FINVANTA — Financial Intelligence & Management Ecosystem

One platform. Every financial workflow. One intelligent AI assistant.

Next.js 16 (App Router) · TypeScript · Tailwind v4 · PostgreSQL + Drizzle · Recharts · Decimal.js.

## What is implemented (phases 1–10, honest status)

| Area | Status |
|---|---|
| Auth: email/password (scrypt), DB sessions, TOTP MFA, password reset, RBAC (owner/admin/accountant/analyst/viewer), org isolation, audit log, CSRF same-origin checks, rate limits; Google/GitHub OAuth with PKCE | ✅ code; provider credentials required (password-reset email requires `RESEND_API_KEY` + `RESEND_FROM`) |
| Accounting: CoA, double-entry vouchers (8 types), auto numbering, reversals, TB/P&L/BS/CF (reconciled), day/cash/bank books, cost centres, fixed assets + depreciation, weighted-avg inventory with low-stock warnings and invoice-linked movements, period closing, multi-company, multi-currency voucher entry | ✅ |
| GST/TDS/Income tax: GST split, ITC set-off, GSTR-3B/GSTR-1 drafts, 2B reconciliation, e-invoice/e-way draft payloads, TDS engine, challan reconciliation, tax calculators, compliance calendar; monthly mock-only GST draft/review/OTP workflow with append-only audit | ✅ mock submission only — **no GSTN filing**; ClearTax disabled |
| AR/AP: GST invoices, approval workflow, inventory-linked sales and purchase lines (stock moves on approval), receipts/payments, ageing, credit limits, reminders (drafted, not sent), invoice PDF; separate quotations, pro-forma invoices, sales orders and delivery challans that convert to approval-pending invoices | ✅ |
| Data imports: company-scoped CSV/XLSX imports for parties, inventory catalog and invoices; complete-file validation and audit logging; imported invoices remain pending approval | ✅ |
| Banking: CSV/XLSX import, rule categorisation, duplicate detection, auto-reconcile, post-from-bank | ✅ (no bank connectivity; PDF statements unsupported without OCR) |
| Document intelligence: upload validation, text-layer PDF/XLSX/CSV extraction, classification, field extraction, validation, duplicate detection, human-confirmed posting | ✅ (OCR for scans/images: **not configured**) |
| Statement analysis: 30 ratios with formulas, common-size, horizontal, YoY/QoQ, Altman Z/Z″, Piotroski | ✅ (segment analysis needs segment data) |
| Modelling: DCF + sensitivity + scenarios + validation + Excel export with live formulas, WACC, DDM, LBO, comps, three-statement (balance-checked), break-even | ✅ |
| FP&A, Credit, MIS/BI (interactive period-filtered dashboards with hover tooltips, pivots, KPI builder, cleaning and exports; branded multi-sheet Excel MIS pack) | ✅ (scheduled *delivery* needs cron/email) |
| Markets/Charting/Portfolios: provider layer (FMP, Twelve Data, Indian Market API) with cache/retry/limits/failure log, NSE/BSE search/details/comparison, screener on a **fictional demo universe**, watchlists, alerts (on-demand), 11 indicators, drawing tools, multi-chart, templates, FIFO P&L, XIRR, risk metrics, rebalancing, paper trading | ✅ (provider data may be delayed; demo data always labelled; **no live trading**) |
| Operations Hub: company-scoped document, invoice, bank reconciliation and AI approval queues linking to existing FINVANTA workflows; human approval remains required | ✅ |
| AI: 10 agents, streaming, tool-calling over ledger/calculators/documents, citations, approval-gated journal drafts, conversation folders/search/export, usage tracking, rate limits; floating widget + full workspace | ✅ Gemini (`GEMINI_API_KEY`) or OpenAI; otherwise deterministic **engine mode** |
| Responsive dashboard shell, accessible carousel, generic sortable/filterable table, and global toast service | ✅ |
| Background jobs: BullMQ email/report/image processors, retry/idempotency policy, dead-letter queue, health endpoint, hourly cleanup | ✅ code; Redis/provider/storage integration not verified |
| GraphQL blog API: schema-first Yoga, generated resolver types, cursor pagination, DataLoaders, authorization and query limits | ✅ code; migration/database integration not verified |
| Realtime chat backend: Socket.IO, Redis adapter, tenant-scoped rooms, persistence, history, presence and rate limiting | ✅ code; Redis/migration configuration and two-instance integration remain unverified |
| Unique: health score, red flags, earnings quality, working-capital intel, stress test, survival calculator, anomaly/Benford, heatmap, CFO briefing, consolidated view, personal finance, learning centre, report builder | ✅ |

Not built / pending: employee-productivity dashboards, official NSE/BSE exchange feeds, RBI/MOSPI connectors, OCR, payment processing, Neon-specific setup (any Postgres works). The Indian Market API integration is a third-party Yahoo Finance aggregator, not an official exchange feed.

## Environment

See [Docker deployment instructions](./docs/DEPLOYMENT.md) for standalone image builds, Compose, production environment configuration, hosting options, and rollback guidance.

`DATABASE_URL` is required. Add `GEMINI_API_KEY` or `OPENAI_API_KEY` for the AI assistant. Cloudflare AI is supported through `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and `CLOUDFLARE_MODEL`. `LLM_PROVIDER` can explicitly select `cloudflare`, `gemini`, `openai`, or `openrouter`; if unset, FINVANTA uses the legacy Cloudflare/Gemini/OpenAI preference order. For OpenRouter, `OPENAI_API_KEY` is used with the OpenRouter-compatible API; the base URL defaults to `https://openrouter.ai/api/v1`. When `OPENAI_MODELS` is empty, the model picker loads OpenRouter's current text/tool-capable catalog, including models from OpenAI, Google, Anthropic, and others; each option shows its listed per-token price. The default remains `openrouter/free`. You can set `OPENAI_MODELS` to a comma-separated allowlist. OpenRouter model availability and pricing can change, and free availability is not guaranteed. Configure `CLOUDFLARE_AI_GATEWAY_ID` for a Workers AI model whose ID starts with `@cf/`; the token needs the account's Workers AI Read permission. `CLOUDFLARE_MODELS` optionally provides a comma-separated model list. Provider status means configuration was detected, not that credentials or model access were live-verified. `GEMINI_MODEL` selects the preferred Gemini model, while `GEMINI_MODELS` can override Gemini model discovery. If a model is unavailable or rate-limited, FINVANTA tries alternatives from that provider before output starts; it does not switch providers mid-request. `OPENAI_BASE_URL` overrides the OpenAI-compatible endpoint.

For live global market quotes/history, add either `FMP_API_KEY` or `TWELVE_DATA_API_KEY`; FMP also enables live news. `INDIAN_MARKET_API_BASE_URL` configures the server-side NSE/BSE stock API (no API key); its requests are authenticated with the FINVANTA session, cached in `market_cache`, and never expose the upstream URL to the browser. `FRED_API_KEY` enables cached U.S. macro indicators (real GDP growth, CPI inflation, unemployment, and federal funds rate) on the Markets dashboard. For password-reset email, configure both `RESEND_API_KEY` and `RESEND_FROM`; configure `APP_URL` to the canonical HTTPS origin in production. Without Resend, no reset token or link is issued, and the response remains generic to avoid account enumeration. `AI_DAILY_TOKEN_LIMIT` and `PROVIDER_DAILY_LIMIT` are optional usage limits.

The streaming `/api/uploads` endpoint accepts repeated `files` multipart fields (up to five, 10 MB each). It requires a private S3-compatible bucket (`UPLOADS_S3_*`) and a reachable ClamAV daemon (`CLAMAV_HOST`, `CLAMAV_PORT`); it fails closed if either is unavailable. In development, point the S3 endpoint at MinIO and set its credentials in `.env.local`; `UPLOADS_S3_CREATE_BUCKET=true` creates the configured bucket if it does not exist. Successful results include five-minute signed download URLs. `GET /api/uploads/{id}` issues a fresh URL for an authorized company member. A scheduled caller can run `POST /api/uploads/cleanup?cursor=...` repeatedly; configure `UPLOADS_CLEANUP_SECRET` for bearer-token access, otherwise an administrator session is required. The pre-existing Document Intelligence form still uses its legacy local `storage/` path.

The standalone chat process uses `REDIS_URL`, `CHAT_JWT_SECRET` (at least 32 characters), and `CHAT_ORIGIN`; run it with `npm run chat:server` after applying the Drizzle migrations. The authenticated app session exchanges for a two-minute chat JWT at `POST /api/chat/token`; the main REST API continues to use its existing session-cookie auth. Rooms and members are company-organisation scoped through `/api/chat/rooms`.

Background jobs use BullMQ on the same `REDIS_URL`. Set `RESEND_API_KEY` and `RESEND_FROM` (or `EMAIL_FROM`) for email delivery; set `JOBS_CONCURRENCY` to an integer from 1 to 32. Start the worker with `npm run jobs:worker`. Server modules can enqueue validated email, report, and image-processing jobs through `src/services/jobs/queue.ts`; jobs use stable idempotency keys, optional priority 1–10, three exponential-backoff attempts, and a dead-letter queue. The worker also schedules hourly orphan-upload cleanup. `GET /api/jobs/status` is admin-only; `GET /api/jobs/status?jobId=...` returns an authorized job's state and result. Main-queue jobs are retained for up to 30 days; terminal failures are also preserved in the dead-letter queue. Report/image jobs require the upload S3 storage to be configured; report/email output also needs the relevant provider configuration.

The schema-first GraphQL blog API is available at `POST /api/graphql` (development GraphiQL is available at the same path). `npm run graphql:codegen` regenerates `src/generated/graphql.ts` from `src/server/graphql/schema.ts`. Reads and mutations require a FINVANTA session; only the author or an admin can update/delete a post. Post deletes and their comments are soft-deleted together. Connections use stable opaque cursors, and stale/invalid cursors return `INVALID_CURSOR`. Nested authors, posts, and comments use request-scoped DataLoaders; page sizes and comment batches are bounded. Query depth is capped at 8 and estimated complexity at 5,000. Apply the checked-in migrations before using this API.

Google/GitHub OAuth requires `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `OAUTH_TOKEN_ENCRYPTION_KEY` (32 random bytes, hex or base64). Configure `OAUTH_REDIRECT_BASE_URL` or `APP_URL` (required in production) and register `/api/auth/oauth/google/callback` and `/api/auth/oauth/github/callback` with the providers. OAuth creates FINVANTA's own HttpOnly session and a starter workspace for new users. Provider accounts can be explicitly connected from Settings; automatic linking to an existing account requires the same verified email. Unverified provider emails require an already-authenticated explicit link, and accounts with MFA enabled still require password + authenticator sign-in. Provider access/refresh tokens and temporary PKCE verifiers are encrypted with AES-256-GCM. `getOAuthAccessToken` refreshes expired provider credentials server-side. No live provider credentials were available for end-to-end testing.

The evaluation of the external Free Claude Code proxy, its provider quotas and local-only compatibility is documented in [docs/AI_PROVIDER_EVALUATION.md](./docs/AI_PROVIDER_EVALUATION.md).

## Architecture

- `src/engines/*` — pure, unit-tested calculation services (Decimal-safe accounting & tax; documented formulas; every calc can emit input/formula/result/assumptions/source/timestamp).
- `src/services/*` — ledger queries, posting chokepoint (`postVoucher`), invoicing, reports, market providers, document extraction, AI orchestration (`services/ai`).
- `src/actions/*` — server actions (zod-validated, permission-checked, audit-logged).
- `src/app/(app)/*` — module pages; `src/app/api/*` — streaming AI, exports (CSV/XLSX/PDF/JSON), downloads.
- `src/db/schema.ts` — 58 tables, `numeric(20,2)` money, FKs, indexes, soft deletes. Apply checked-in migrations with `npx drizzle-kit migrate`.

Use **Data Imports** from the Accounting & Compliance navigation to download CSV templates or import CSV/XLSX. Imports are atomic and company-scoped; invoice rows are grouped by kind and invoice number, calculated with the deterministic GST engine, and created as pending approval. They do not post ledger entries or stock movements. Starting inventory balances must be recorded separately as stock movements.

## Testing

`npx vitest run` — calculator, AI-review validation, OTP state, local mock GSP endpoints, and end-to-end OTP-gated mock submission tests, plus accounting, tax, market, security, and UI-supporting service tests.

Still not automated: browser-level Playwright E2E and API integration tests against a seeded PostgreSQL database. The GST workflow tests use a local mock GSP and fake in-memory filing storage; they do not prove a live database migration or government filing.

## Security & operations notes

Org/company scoping on every query; HttpOnly session cookies; Security headers; the streaming upload API validates content signatures, checks DOCX package entries, scans with ClamAV, stores private S3 objects, scopes metadata to the active company, and returns short-lived signed URLs. The legacy Document Intelligence form stores files outside `public/` (`storage/`, scoped download route). In-memory rate limiting is per instance (use Redis for scale-out). Back up PostgreSQL and any legacy `storage/` data together; test restores. Rotate any API key exposed outside server env.
