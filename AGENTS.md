# AGENTS.md

Onboarding checklist for any coding agent (Claude Code, Codex, Cursor, etc.)
picking up this repo cold. Read this first, then `CLAUDE.md` (architecture)
and `README.md` (full docs) for anything not covered here.

## 1. Prerequisites — check before doing anything

- Node >= 20: `node -v`
- Ollama installed and running: `curl -s $OLLAMA_HOST/api/tags` (default
  `OLLAMA_HOST=http://localhost:11434`) — or just run `npm run check`, it
  does exactly this plus verifies the configured models are pulled.
- `config/profile.json` exists. It's gitignored — if missing, copy it:
  `cp config/profile.example.json config/profile.json` and fill in real
  name/education/skills/projects. Without it, `npm run anschreiben` throws.
  The anti-hallucination rules in `lib/anschreiben.ts` only cite what's
  literally in this file — an empty/templated profile produces weak, generic
  letters, not fabricated ones. That's intentional, not a bug to fix.

## 2. Install

```bash
npm install
npx playwright install chromium   # only if you'll run AMS/DevJobs.at scrapers
```

Pull the models `config.ts` currently defaults to (check that file for the
authoritative current tags — they get retuned as better local models show
up; don't hardcode what's written here):

```bash
ollama pull <JOBBOT_MODEL_FILTER default from config.ts>
ollama pull <JOBBOT_MODEL_WRITER default from config.ts>
```

If `npm run check` reports a model as missing, you (the coding agent) can
run the `ollama pull` yourself — it's a local, reversible, non-destructive
download, no need to ask first.

## 3. Health checks (run before AND after making changes)

```bash
npm run check       # Ollama reachable + configured models present
npm run smoke       # storage/JsonStore end-to-end lifecycle
npm run typecheck
npm test
```

## 4. LLM inference settings — read this before calling Ollama, it will save you hours

This was benchmarked directly on this repo's dev machine (CPU-only, no usable
GPU under Ollama — an integrated GPU is present but unsupported). Full raw
data: `data/anschreiben/test/AnschreibenTestLog.md`.

- **Reasoning models default to hidden "thinking" tokens that are
  catastrophic on CPU.** A single cover-letter generation went from ~2
  minutes to 41+ minutes because of this. Always pass `think: false` in the
  `/api/chat` request body when calling a reasoning-capable model
  (qwen3.x family). Non-reasoning models (gemma3, mistral) silently ignore
  the flag — that's expected, not an error, don't retry on it.
- Recommended generation options for this repo's use case (filter/cover
  letter text): `num_ctx: 4096`, `temperature: 0.3`. Leave `top_k` /
  `presence_penalty` at Ollama defaults unless you're deliberately tuning
  one axis at a time.
- **Never let two models >8GB sit loaded simultaneously.** This machine has
  ~25GB usable RAM. Ollama's default `keep_alive` is 5 minutes, so a
  second large model loading while the first is still resident can trigger
  a kernel OOM-kill of the *Ollama server process itself* (not just the
  request) — this actually happened during benchmarking. If you're
  switching models in a script, call `ollama stop <model>` after you're
  done with it before loading the next (see `scripts/anschreiben-model-bench.ts`
  for the pattern).
- Benchmarked model behavior (4 models × 3 fixed jobs, `think:false` +
  `ctx4096` + `temp0.3` on all): qwen3.5:9b is fastest (~115s/job) but
  fabricated tech/skills not in the candidate's profile in 2/3 test jobs.
  gemma3:12b and mistral-small3.2 are 2-4x slower (~270-290s/job, up to
  474s worst case) but were more honest about naming skill gaps instead of
  inventing proximity. qwen3:30b (MoE, 18GB) timed out (>10min) on every
  single test job even with `think:false` — avoid it here, it's not usable
  interactively on this hardware regardless of the thinking-mode fix.

## 5. Pipeline order

```
scrape -> filter -> anschreiben -> (manual) review -> (manual) send
```

```bash
npm run scrape          # or scrape:karriere / :devjobs / :linkedin / :ams / :jobs for one source
npm run filter          # or filter:regex to force the offline regex strategy
npm run anschreiben
```

## 6. Rules that will break things if ignored

- `storage/` is the only code allowed to touch `data/jobs/*.json` directly.
  Everything else goes through the `Storage` interface (`storage/index.ts`).
- Job filenames are `title_company_date_id8.json` (built by `jobBasename()`
  in `lib/slugify.ts`) — **never** the raw job id (`${id}.json`). A script
  assuming the raw-id filename is a real, already-hit bug in this repo
  (`scripts/smoke-storage.ts`'s dedup check silently found 0 files for
  months before anyone noticed).
- Triaged jobs (`status: 'triaged'`) live in `data/jobs/matched/` or
  `data/jobs/offstack/`, keyed by `fit` (`brutal`-fit and every other status
  stay in the base `data/jobs/` dir). `JsonStore.save()` moves the file
  between these when `status`/`fit` change — don't assume a job's path is
  stable across an update.

## 7. Known gaps — don't assume finished

- Concrete scraper adapters exist for `ams`, `devjobs-at`, `karriere-at`,
  `jobs-at`, `linkedin` (`scrapers/*.ts`) — verify against that directory
  directly if `CLAUDE.md`'s description sounds more provisional than what
  you find; it may be out of date.
- Auto-send is not implemented. `reviewed` → `drafted` → `sent` are manual
  status transitions only — there is no code path that sends anything.
