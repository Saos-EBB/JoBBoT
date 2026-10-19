# AGENTS.md

Onboarding checklist for any coding agent (Claude Code, Codex, Cursor, etc.)
picking up this repo cold. Read this first, then `CLAUDE.md` (architecture)
and `README.md` (full docs) for anything not covered here.

## 1. Prerequisites — check before doing anything

- Node >= 20: `node -v`
- llama.cpp `llama-server` (router mode) at `~/.local/opt/llama.cpp/current/`,
  GGUF models in `~/.local/share/llama-models` (see `config/llama-models.ini`
  for preset names and files). You don't start it by hand: `ensureReady()`
  launches `scripts/llama-server.sh` on demand (log: `data/llama-server.log`).
  `npm run check` verifies the server answers and the configured presets exist.
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

Models are preset names from `config/llama-models.ini` (defaults in `config.ts`:
`JOBBOT_LLAMACPP_MODEL`, `JOBBOT_LLAMACPP_NIMBLE_MODEL`). If `npm run check`
reports a preset as missing, the GGUF file it points to isn't in
`~/.local/share/llama-models` — download the file named in the preset (verify
its sha256) rather than renaming presets. Ask before multi-GB downloads.

## 3. Health checks (run before AND after making changes)

```bash
npm run check       # llama-server reachable + configured presets present
npm run smoke       # storage/JsonStore end-to-end lifecycle
npm run typecheck
npm test
```

## 4. LLM inference settings — read this before calling the LLM, it will save you hours

Benchmarked on this repo's dev machine (Ryzen with Vega iGPU, 30 GB RAM shared
with the iGPU). History in `docs/build-log.md`.

- **Use `gemma4-26b-cpu` (the writer default).** gemma-4-26B is MoE: ~9.5 tok/s
  steady on CPU, ~4x faster than the dense Mistral Small 3.2 baseline (~2 tok/s)
  and more honest about skill gaps. The Vulkan/iGPU preset (`gemma4-26b`) is
  not faster overall and had throughput drops.
- **Never two big models in memory.** The router runs with `--models-max 1`.
  iGPU presets allocate ~14 GB of system RAM as GTT, which does *not* show up
  in process RSS — with a browser and dev servers open that filled RAM once.
  Unload between models (`LlmProvider.unload`).
- Pass `think: false` for reasoning-capable models (mapped to
  `chat_template_kwargs.enable_thinking`); hidden thinking is catastrophic on
  CPU. Temperatures live in `config/settings.json` (`inference`); context size
  and threads live in the preset, not per request.
- Prompt changes: banning phrases makes gemma swap in new stock phrases. One
  concrete "NICHT: … / SO: …" example pair works far better than word lists.

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
- Triaged jobs (`status: 'triaged'`) live in `data/jobs/matched/`,
  `data/jobs/offstack/`, or `data/jobs/brutal/`, keyed by `fit` (every other
  status stays in the base `data/jobs/` dir). `JsonStore.save()` moves the
  file between these when `status`/`fit` change — don't assume a job's path
  is stable across an update.

## 7. Known gaps — don't assume finished

- Concrete scraper adapters exist for `ams`, `devjobs-at`, `karriere-at`,
  `jobs-at`, `linkedin` (`scrapers/*.ts`) — verify against that directory
  directly if `CLAUDE.md`'s description sounds more provisional than what
  you find; it may be out of date.
- Auto-send is not implemented. `reviewed` → `drafted` → `sent` are manual
  status transitions only — there is no code path that sends anything.
