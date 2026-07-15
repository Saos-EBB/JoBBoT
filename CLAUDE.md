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

This is a job-application automation bot, currently in early build-out (scraping recon phase). The intended pipeline:
1. **Scrape** — fetch job listings from portals
2. **Filter** — LLM decides if a job is worth applying to
3. **Generate** — LLM writes a cover letter
4. **Review / Send** — human-in-the-loop before anything goes out

### Key data flow

`ScrapedJob` → `toJob()` (adds `id`, `status: 'new'`, timestamps) → `JsonStore` (one JSON file per job in `data/jobs/`)

Job status lifecycle: `new → filtered_out | matched → generated → reviewed → drafted → sent`

### LLM setup

Two local Ollama models, configured via `config.ts`:
- `JOBBOT_MODEL_FILTER` (default `mistral-small3.2:latest`) — cheap filter pass
- `JOBBOT_MODEL_WRITER` (default `mistral-small3.2:latest`) — cover letter generation
- `OLLAMA_HOST` (default `http://localhost:11434`)

`lib/ollama.ts` does model presence checks; actual inference is not yet wired up.

### Storage

`JsonStore` (`storage/json-store.ts`) writes one `{id}.json` per job, using a write-to-temp-then-rename pattern for atomicity. `id` is a 16-char hex SHA-256 of normalized `[title, company]`.

### Scrapers

Only the interface is defined (`scrapers/interface.ts`). Concrete `ScraperAdapter` implementations are not yet written. `scripts/recon-karriere.ts` is a one-off reconnaissance script that saves raw HTML fixtures to `test/fixtures/karriere-at/`.

### Tests

Use Node's built-in `node:test` + `node:assert/strict` — no Jest, no Vitest. Test helpers (`test/helpers.ts`) provide `tmpDir()`, `rmTmp()`, and `mockOllama()` (in-process HTTP server). Each test gets its own temp directory cleaned up with `t.after()`.

## Agent skills

### Issue tracker

GitHub Issues on `Saos-EBB/jobsuche-apply-bot` via the `gh` CLI; external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Defaults used as-is (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root (neither exists yet — created lazily by `/domain-modeling`). See `docs/agents/domain.md`.
