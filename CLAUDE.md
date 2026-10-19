# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # health check (LLM backend + storage)
npm test             # run all tests (node:test, no framework)
npm run test:watch   # watch mode
npm run typecheck    # tsc --noEmit
npm run check        # verify the active LLM backend is up and models are present
npm run recon:karriere  # fetch karriere.at fixtures into test/fixtures/
```

Run a single test file:
```bash
node --import tsx --test --test-reporter spec test/storage.test.ts
```

## Architecture

This is a job-application automation bot with a working end-to-end pipeline, driven either via CLI scripts or the local web UI (`npm run ui`):
1. **Scrape** — fetch job listings from 5 portals (karriere.at, devjobs.at, LinkedIn, AMS, jobs.at)
2. **Filter** — regex or LLM decides if a job is worth applying to (`fit: matched | offstack | brutal`)
3. **Generate** — LLM writes a cover letter (local llama.cpp, real inference)
4. **Review / Send** — human-in-the-loop via the UI, then Gmail draft and reply/follow-up tracking

### Key data flow

`ScrapedJob` → `toJob()` (adds `id`, `status: 'new'`, timestamps) → `JsonStore` (one JSON file per job in `data/jobs/`)

Job status lifecycle: `new → triaged → generated → freigegeben → postausgang → gesendet`, with `geloescht`, `fehler` and `offline` as side states (see the vocabulary comment on `JobStatus` in `scrapers/interface.ts`). The filter verdict itself lives in the separate `fit` field, not in `status`.

### LLM setup

Inference runs locally on llama.cpp (Ollama was removed in Oct 2026). The backend sits behind a neutral interface in `lib/llm/`:
- `lib/llm/types.ts` — `LlmProvider` (`chat`, `ensureReady`, `check`, `resolveModels`, `missingHint`, optional `unload`) and a backend-neutral `ChatRequest` (`json`, `think`, `temperature`, `host`)
- `lib/llm/index.ts` — `getProvider()` picks the backend via `JOBBOT_LLM_PROVIDER` (default and only entry: `llamacpp`); unknown names throw. New backend = one file in `lib/llm/` + one registry entry.
- `lib/llm/llamacpp.ts` — the llama.cpp backend: `llama-server` in router mode, started by `scripts/llama-server.sh` (autostart via `ensureReady`, log `data/llama-server.log`). Model names are preset names from `config/llama-models.ini` (e.g. `gemma4-26b` = Vulkan/iGPU, `gemma4-26b-cpu`); writer default is `gemma4-26b-cpu` (steady ~9.5 tok/s, the iGPU preset had throughput drops); threads/context/GPU offload live in the preset, not per request. GGUFs in `~/.local/share/llama-models`, binary at `~/.local/opt/llama.cpp/current/`. Env: `LLAMACPP_HOST` (default `http://127.0.0.1:8089`), `JOBBOT_LLAMACPP_MODEL` (writer), `JOBBOT_LLAMACPP_NIMBLE_MODEL` (JEV filter; also the provider's `filter` model in `resolveModels()`/`check`).
- `lib/llm/openai-compat.ts` — shared client for OpenAI-compatible `/v1/chat/completions` (SSE streaming); `lib/llm/local-server.ts` — shared "start local server if down" logic

Callers (`lib/filter-nimble.ts`, `lib/anschreiben.ts`, runners, `run.ts`, `scripts/check-llm.ts`) only use `getProvider()`. The `host` option threaded through filter/anschreiben overrides the provider's default base URL (tests point it at mock servers).

Filter: `filterMode` in `config/settings.json` — `regex` (default, no LLM) or `nimble` (`lib/filter-nimble.ts`: Bespoke Nimble 9B classifier, one call per criterion with one-letter codes, each call gets only its own text excerpt behind one shared schema (primed once per run so llama-server has a checkpoint at the prefix end); the role question answers support / other wanted area / no against `nimble.supportJobs` + `nimble.wantedJobs` in `config/settings.json` (support is never rejected for experience, at most offstack), no Lehre/coding gate, junior signal is a keyword check without a call, preset `JOBBOT_LLAMACPP_NIMBLE_MODEL`, default `nimble-9b-vulkan` (iGPU, ~7 s/job; `nimble-9b` = CPU, ~50 s/job); the UI button for this mode is labelled "JEV"). The verdict type `FilterJudgment` and its mapping to matched/uncertain/filtered_out live in `lib/filter-judgment.ts` (the old Gemma JSON filter, mode `llm`, was removed in Oct 2026). Nimble is a hybrid/recurrent model: prefix caching only works via context checkpoints, hence `checkpoint-min-step = 0` and small batches in its presets. Inference knobs (`think`, `writerTemperature`) also live in `config/settings.json`; context size and threads live in the llama.cpp preset.



### Storage

`JsonStore` (`storage/json-store.ts`) writes one `{id}.json` per job, using a write-to-temp-then-rename pattern for atomicity. `id` is a 16-char hex SHA-256 of normalized `[title, company]`.

### Scrapers

Five `ScraperAdapter` implementations in `scrapers/` (`karriere-at.ts`, `devjobs-at.ts`, `linkedin.ts`, `ams.ts`, `jobs-at.ts`), enabled/configured per portal via `config/sources.json`. `scripts/recon-karriere.ts` is a one-off reconnaissance script that saves raw HTML fixtures to `test/fixtures/karriere-at/`.

### Mail

`mail/gmail.ts` sends/drafts via Gmail (nodemailer) and fetches replies via IMAP (imapflow); `mail/transport.ts` defines the `MailTransport` seam, with a dry-run transport for tests and offline use (`MAIL_DRY_RUN`). `lib/gmail-sync.ts` backfills `sentAt`/`replyReceivedAt` read-only, moves outbox jobs to `gesendet` once their draft shows up in Gmail's Sent folder, and classifies reply texts into `job.replyKind` (`absage | zusage | datenschutz | plattform | eingang | antwort`) via JEV (`lib/reply-kind-jev.ts`, the default `classifyReply` of `runGmailSync`/`fetchAndFillReplies`; one call per mail, verdicts cached in gitignored `data/reply-kinds.json`; no verdict, e.g. llama-server down → kind stays open and counts as `ohneArt`, retried next sync). The old regex (`classifyReply` in `lib/reply-kind.ts`) is unused but kept as `regexReplyClassifier` — tests inject it so they never start the real model. Shared JEV client: `lib/nimble-client.ts`. `lib/nachweis.ts` + `GET /nachweis` render a printable application record (AMS).

### UI

`scripts/ui-server.ts` is a plain Node HTTP server (no framework) exposing a JSON API under `/api/*` (jobs, scrape, filter, anschreiben, gmail-sync, calendar, attachments, CC, config) plus SSE streams for long-running runs; `ui/app.tsx` is the React frontend, built via `scripts/build-ui.ts` (esbuild).

### Tests

Use Node's built-in `node:test` + `node:assert/strict` — no Jest, no Vitest. Test helpers (`test/helpers.ts`) provide `tmpDir()`, `rmTmp()`, and `mockChat()`/`mockChatSequence()` (in-process HTTP server answering like `llama-server` on `/v1/chat/completions`, SSE when `stream:true`). Each test gets its own temp directory cleaned up with `t.after()`.

## Agent skills

### Issue tracker

GitHub Issues on `Saos-EBB/jobsuche-apply-bot` via the `gh` CLI; external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Defaults used as-is (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root (neither exists yet — created lazily by `/domain-modeling`). See `docs/agents/domain.md`.
