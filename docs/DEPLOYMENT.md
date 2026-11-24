# FINVANTA Docker deployment

FINVANTA is built as a Next.js standalone Node.js image. PostgreSQL is external; this configuration does not create or reset a database. The application container exposes port `3000`, while Compose maps it to `localhost:3002` for local verification.

For an initial cloud sizing estimate, start the web service at 1 vCPU and 1-2 GiB RAM, then scale from observed memory/CPU metrics. This is a planning estimate, not a load-test result; enablement of the separate worker and chat services requires additional resources.

## Local production-mode container

The Compose file reads `.env.local` by default without copying it into the image. Keep that file private; `.gitignore` and `.dockerignore` exclude it. Start the existing application with:

```powershell
docker compose up --build -d
docker compose ps
Invoke-WebRequest http://localhost:3002/api/health
```

The health endpoint checks database connectivity with a read-only `SELECT 1`. Compose mounts the existing `storage/` directory to preserve legacy document uploads and a named volume for the Next.js cache. Uploaded S3 objects remain in the configured external bucket.

For a production server, create a private environment file from `.env.example`, fill it through a secure method, then set `FINVANTA_ENV_FILE` to that file before running Compose. Do not copy `.env.local` or production credentials into the build context, Dockerfile, GitHub, or an image. Container environment variables take precedence for `NODE_ENV`, `HOSTNAME`, and `PORT`.

```powershell
$env:FINVANTA_ENV_FILE = ".env.production"
docker compose up --build -d
```

For shutdown, use `docker compose down` (do not add `-v` if you want to retain the Next.js cache volume). The legacy `storage/` host directory is not deleted by Compose.

The optional BullMQ worker and Socket.IO chat services are in Compose profiles. They require a reachable external Redis service and the corresponding credentials in the selected environment file. **The worker schedules hourly orphan-upload cleanup and deletes S3 objects under `uploads/` that are older than one hour and have no matching document row. Verify and back up the bucket/database state before enabling it.** This worker was built but not started during verification.

```powershell
docker compose --profile workers up --build -d app worker
docker compose --profile chat up --build -d app chat
```

The chat service listens on port `4001` locally. In a cloud deployment, run it as a separate long-running public/private service and configure WebSocket routing and `CHAT_ORIGIN` to match the browser-facing app origin. Do not expose Redis publicly.

## Environment checklist

Required for the web application:

- `DATABASE_URL`: PostgreSQL application connection. Use the Neon pooled URL for web traffic where applicable.
- `APP_URL`: canonical HTTPS origin in production. Required for production OAuth and password-reset links.

Migration-only:

- `DATABASE_URL_UNPOOLED`: direct, non-pooled PostgreSQL URL for Drizzle migrations; never point production migrations at the pooled connection when the migration tool requires a direct session.

Optional integrations and limits (use the exact source names):

- Authentication/email: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `OAUTH_REDIRECT_BASE_URL`, `OAUTH_TOKEN_ENCRYPTION_KEY`, `RESEND_API_KEY`, `RESEND_FROM`, `EMAIL_FROM`.
- AI: `LLM_PROVIDER` (legacy `LLM_Provider` is also read), `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_MODELS`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODELS`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_MODEL`, `CLOUDFLARE_MODELS`, `CLOUDFLARE_AI_GATEWAY_ID`, `AI_MEDIA_ENABLED`, `AI_DAILY_TOKEN_LIMIT`.
- Market data: `FMP_API_KEY`, `TWELVE_DATA_API_KEY`, `FRED_API_KEY`, `INDIAN_MARKET_API_BASE_URL`, `PROVIDER_DAILY_LIMIT`.
- Uploads and scanning: `UPLOADS_S3_BUCKET`, `UPLOADS_S3_ENDPOINT`, `UPLOADS_S3_REGION`, `UPLOADS_S3_ACCESS_KEY_ID`, `UPLOADS_S3_SECRET_ACCESS_KEY`, `UPLOADS_S3_CREATE_BUCKET`, `UPLOADS_S3_SSE`, `UPLOADS_CLEANUP_SECRET`, `CLAMAV_HOST`, `CLAMAV_PORT`.
- Background jobs and chat: `REDIS_URL`, `JOBS_CONCURRENCY`, `CHAT_JWT_SECRET`, `CHAT_ORIGIN`, `CHAT_PORT`.
- GSP sandbox integration: `GST_ENV`, `GSP_ENV`, `GSP_PROVIDER`, `GSP_BASE_URL`, `GSP_CLIENT_ID`, `GSP_CLIENT_SECRET`, `GSP_MOCK_PORT`. `GSP_MOCK_FORCE_OUTCOME` is test-only and must not be configured in production.
- Runtime-managed: `NODE_ENV` is set to `production`; Next.js standalone also reads `HOSTNAME` and `PORT`.

Keep all private credentials server-side. Never add private values to a `NEXT_PUBLIC_` variable. Production OAuth provider callback URLs must be registered as:

```text
https://<your-domain>/api/auth/oauth/google/callback
https://<your-domain>/api/auth/oauth/github/callback
```

The app's `/api/health` check includes the database but does not check Redis, email, OCR, object storage, or external market-data providers. Configure the platform's HTTPS/custom-domain feature or a TLS reverse proxy, then set `APP_URL` to that public origin. Do not assume database backups include S3 objects or legacy files in `storage/`; back up and restore those separately.

## Database release and rollback

Six Drizzle SQL migrations are checked into `drizzle/`. No migrations are run automatically by the application container. Review migration SQL, take a database backup, and test changes against a separate Neon branch before applying them. Run `npx drizzle-kit migrate` from a trusted release environment with the direct `DATABASE_URL_UNPOOLED` configured. No migration or database write is part of `docker compose up`.

To roll back an application release, deploy the previous image/tag and verify `/api/health`. Do not roll back by dropping tables or resetting the database; schema changes require a separately reviewed forward-compatible migration plan. Restore database data and file/object backups using their provider recovery procedures.

## Hosting options

| Option | Best fit | Cost/operations notes |
|---|---|---|
| Render | Simplest GitHub-connected Docker web service | Managed deploys, TLS, custom domains, health checks, and rollbacks reduce operations. Compute is billed by instance plan and persistent disk separately; check the current calculator for exact monthly cost. Free services are not a production persistence choice. Keep PostgreSQL external (Neon). |
| Railway | Fast setup for a Docker service and optional Redis | Free is $0 with a $1 monthly resource allowance and strict service limits described below. Paid Hobby is separate (currently $5/month with $5 usage credit); do not upgrade for the zero-spend deployment. |
| Google Cloud Run | Container-first, autoscaling web service | Request-based billing has a monthly free tier (180,000 vCPU-seconds, 360,000 GiB-seconds, and 2 million requests in the listed baseline region); paid rates and egress vary by region. Good for bursty traffic, but long-lived workers and Socket.IO need separately configured services. |
| VPS (DigitalOcean example) | Lowest fixed-price entry and maximum control | Example Basic VM pricing is $12/month for 1 vCPU / 2 GiB RAM or $24/month for 2 vCPU / 4 GiB (verify current rates). The smaller size may be tight with workers; you own TLS, firewall, OS patching, backups, monitoring, and availability. Keep Neon external and use a persistent disk for legacy uploads. |

For a first public deployment, **Render is the most practical default** when ease of operation is the priority, although Railway may be cheaper at low/moderate steady usage. Railway is similarly quick; Cloud Run is a good fit when traffic is bursty; a VPS is the lowest fixed-cost option only if you accept host operations. These are hosting compute costs only; Neon, Redis, object storage, email, OCR/AI/market APIs, and bandwidth may add charges. Check current region-specific pricing and limits before creating a paid service.

## Railway Free zero-spend constraints

Railway Free is $0 with no credit card, a $1 monthly resource allowance, one project, and up to three services (each limited to 0.5 GB RAM and one replica). A Railway-provided `.up.railway.app` domain is available. When the allowance runs out, services stop until the next billing cycle; they do not continue on a paid overage. Keep the workspace on Free and do not add a payment method or upgrade. See [Railway Free plan details](https://docs.railway.com/pricing/free-plan).

The three service slots map to the existing `app`, `worker`, and `chat` processes. Redis must be external; the free Railway Redis service would take a fourth slot. Upstash Redis Free currently lists one database with 250 MB, 500,000 commands/month, and 10 GB/month bandwidth. Do not add a payment card or switch it to Pay as You Go. This is a low-volume option, not an SLA-backed production database; check the current [Upstash pricing and limits](https://upstash.com/pricing/redis).

Railway Buckets are private and S3-compatible, but their storage is metered at $0.015/GB-month and uses the same $1 Free allowance; service egress to a bucket is also metered. The Free plan allows up to 10 GB-month. A bucket does not take a service slot, but no bucket was created and no files were moved. Railway does not provide automatic bucket backups; see [bucket billing](https://docs.railway.com/storage-buckets/billing).

ClamAV is open source, but its documented recommended server memory is 3 GiB; Railway Free limits each service to 0.5 GB. Do not expose a public ClamAV TCP port or treat an unverified public scanning API as suitable for confidential financial files. Until a secure scanner and storage are configured and the upload routes are integrated with them, the legacy Documents upload form, S3 upload API, and AI file-attachment API must remain unavailable. The legacy form writes to local disk without antivirus scanning; the Documents UI now displays an unavailable notice and its server action rejects submissions. AI attachments are disabled in the UI and the endpoint returns HTTP 503.

The worker and chat images build, but neither was started. The worker polls BullMQ and schedules hourly cleanup that deletes old orphaned S3 objects; polling can keep a Free service awake and spend the allowance, and cleanup can delete bucket objects. Do not start it until Redis, bucket contents, and cleanup behavior are reviewed. The Socket.IO process also needs Redis and may stay awake with active connections. No Socket.IO client dependency or in-app connection was found, so end-to-end chat integration is unverified. Keep both services in the Compose configuration; the Free allowance cannot guarantee continuous worker/chat availability. The web service is the only service currently safe to deploy before those prerequisites are met.

For cost monitoring, remain on the Free plan with no card, inspect Railway's workspace **Usage** page, and watch each service's CPU, memory, and egress metrics. The CLI provides `railway usage` and `railway metrics`. Keep one replica, disable unnecessary polling/telemetry, set `JOBS_CONCURRENCY=1` if the worker is later approved, and expect the public app and services to stop when the monthly allowance is exhausted. Railway's hard compute limit has a $10 minimum when configured; it is not a $0 guard. No Railway project was linked or deployed as part of this validation.

## GitHub-connected deployment

This checkout has no `.git` metadata, GitHub remote, or hosting credentials, so no repository connection or deployment can be completed or verified here. After the project is in your intended GitHub repository:

1. Connect the repository in the hosting provider and select Dockerfile deployment using the root `Dockerfile`.
2. Set the service's internal port and `PORT` environment variable to `3000` where required (Render's default is `10000`) and health-check path to `/api/health`. Cloud Run may inject its own `PORT`; the container honors it.
3. Add the required environment variables through the provider's secret/environment settings, not repository files. Set `APP_URL` to the HTTPS custom domain.
4. Configure the domain and HTTPS in the provider; register the exact OAuth callback URLs above.
5. Deploy and wait for the provider's healthy/successful deployment status before sharing a public URL.
6. Review deployment logs without printing environment values, monitor health and provider/database status, and keep a previous image/version available for rollback.

The main Compose service starts the Next.js web application. BullMQ processing and Socket.IO realtime chat are separate long-running services enabled with Compose profiles or hosted as separate services, with private Redis connectivity and the required environment variables. The rate-limit helper is in-memory and per-instance; do not scale web replicas expecting a shared rate-limit counter without replacing it with a distributed backend. Scanned-document OCR, live GST filing, bank connectivity, and live trading are not implemented integrations.

Pricing sources (rates change; check region and current plan details before creating paid resources): [Render pricing](https://render.com/pricing), [Railway pricing](https://railway.com/pricing), [Cloud Run pricing](https://cloud.google.com/run/pricing), and [DigitalOcean Droplet pricing](https://www.digitalocean.com/pricing/droplets). ClamAV memory guidance: [ClamAV documentation](https://docs.clamav.net/manual/Installing.html).
