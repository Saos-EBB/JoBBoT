# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # health check (Ollama + storage)
npm test             # run all tests (node:test, no framework)
npm run test:watch   # watch mode
npm run typecheck    # tsc --noEmit
npm run check        # verify Ollama is up and models are present
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
3. **Generate** — LLM writes a cover letter (Ollama, real inference)
4. **Review / Send** — human-in-the-loop via the UI, then Gmail send/draft and reply/follow-up tracking

### Key data flow

`ScrapedJob` → `toJob()` (adds `id`, `status: 'new'`, timestamps) → `JsonStore` (one JSON file per job in `data/jobs/`)

Job status lifecycle: `new → triaged → generated → freigegeben → postausgang → gesendet`, with `geloescht`, `fehler` and `offline` as side states (see the vocabulary comment on `JobStatus` in `scrapers/interface.ts`). The filter verdict itself lives in the separate `fit` field, not in `status`.

### LLM setup

Two local Ollama models, configured via `config.ts`:
- `JOBBOT_MODEL_FILTER` (default `mistral-small3.2:latest`) — used when `filterMode: "llm"` in `config/settings.json` (default mode is `regex`, no Ollama needed)
- `JOBBOT_MODEL_WRITER` (default `mistral-small3.2:latest`) — cover letter generation
- `OLLAMA_HOST` (default `http://localhost:11434`)

`lib/ollama.ts` does model presence checks. Real inference is wired up in `lib/filter-llm.ts` (filter judgment) and `lib/anschreiben.ts` (cover letter text).

### Storage

`JsonStore` (`storage/json-store.ts`) writes one `{id}.json` per job, using a write-to-temp-then-rename pattern for atomicity. `id` is a 16-char hex SHA-256 of normalized `[title, company]`.

### Scrapers

Five `ScraperAdapter` implementations in `scrapers/` (`karriere-at.ts`, `devjobs-at.ts`, `linkedin.ts`, `ams.ts`, `jobs-at.ts`), enabled/configured per portal via `config/sources.json`. `scripts/recon-karriere.ts` is a one-off reconnaissance script that saves raw HTML fixtures to `test/fixtures/karriere-at/`.

### Mail

`mail/gmail.ts` sends/drafts via Gmail (nodemailer) and fetches replies via IMAP (imapflow); `mail/transport.ts` defines the `MailTransport` seam, with a dry-run transport for tests and offline use (`MAIL_DRY_RUN`).

### UI

`scripts/ui-server.ts` is a plain Node HTTP server (no framework) exposing a JSON API under `/api/*` (jobs, scrape, filter, anschreiben, gmail-sync, calendar, attachments, CC, config) plus SSE streams for long-running runs; `ui/app.tsx` is the React frontend, built via `scripts/build-ui.ts` (esbuild).

### Tests

Use Node's built-in `node:test` + `node:assert/strict` — no Jest, no Vitest. Test helpers (`test/helpers.ts`) provide `tmpDir()`, `rmTmp()`, and `mockOllama()` (in-process HTTP server). Each test gets its own temp directory cleaned up with `t.after()`.

## Agent skills

### Issue tracker

GitHub Issues on `Saos-EBB/jobsuche-apply-bot` via the `gh` CLI; external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Defaults used as-is (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root (neither exists yet — created lazily by `/domain-modeling`). See `docs/agents/domain.md`.
