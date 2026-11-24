# Free Claude Code provider evaluation

Reviewed 2026-11-23 against the upstream repository's public README, package metadata and license.

## Result

Do not embed Free Claude Code or treat it as a guaranteed free model API for FINVANTA. It is a separately installed local proxy and coding-agent launcher that routes requests to upstream providers. Its README lists free, paid, subscription and local providers, and explicitly says free-tier availability and limits are controlled by providers and may change. The advertised monthly free-token total is an aggregate claim, not a lifetime entitlement or a quota promised to this application.

The documented direct API supports Anthropic Messages, OpenAI Chat Completions/Responses and Gemini-compatible text/model requests. Voice-note transcription is described for its Discord and Telegram integrations. The reviewed documentation does not establish a general-purpose video-generation API or a stable per-language capability guarantee; those depend on the selected upstream provider/model.

## Compatibility and operational constraints

- The documented local API is OpenAI-compatible at `http://127.0.0.1:8082/v1`; proxy authentication is optional in the upstream product and should be enabled if the service is reachable beyond the local machine.
- FINVANTA already supports an OpenAI-compatible `OPENAI_BASE_URL` and `OPENAI_API_KEY`. For local development only, those settings can point to an FCC instance on the same host, after an operator configures and tests the desired upstream provider. Do not expose a developer's loopback service as a production endpoint.
- FCC is a separate Python application. Its current package metadata pins the interpreter to Python `==3.14.10`; it is not a drop-in provider SDK for this Node.js/Next.js application.
- The repository is licensed `AGPL-3.0-only`. Copying, modifying, embedding, or operating a modified network-service version requires a license-compliance review; this evaluation adds no FCC code or dependency.

## Recommendation

Keep FINVANTA's existing Gemini/OpenAI/Cloudflare provider integrations as the supported application providers. FCC can be an optional local development proxy through the existing OpenAI-compatible settings, but it does not substantiate “free for life,” provide a dependable hosted API for this app, or establish video generation for all product areas. Do not route production customer data through it without reviewing the chosen upstream provider's terms, privacy, quotas and security.

## Sources

- [Free Claude Code README](https://github.com/Alishahryar1/free-claude-code) — provider catalog, free-tier caveat, direct API, voice integration and installation requirements.
- [Free Claude Code `pyproject.toml`](https://github.com/Alishahryar1/free-claude-code/blob/main/pyproject.toml) — `AGPL-3.0-only` package metadata and Python version requirement.
- [Free Claude Code license](https://github.com/Alishahryar1/free-claude-code/blob/main/LICENSE) — AGPL-3.0 terms.
