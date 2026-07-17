# JoBBoT

<img src="docs/images/tschobbo.jpeg" alt="TschoBBo, the JoBBoT mascot" width="480">

*[Deutsch](README.md)*

Local job scraper with an LLM cover-letter generator. Runs fully offline/
local (Ollama), no cloud dependency. Pipeline: **Scrape → Filter → Cover
letter → Review** (review/sending are currently manual).

This is **TschoBBo**, JoBBoT's mascot. The extra arms are the point: he's the
one grabbing listings, filtering them, typing the cover letter, and filing
the application, all at once — the goal is for the pipeline to feel less like
dead script output and more like something is actually working for you.

## Setup

```bash
npm install
npx playwright install chromium   # only needed for AMS/DevJobs.at (browser scrapers)
ollama pull mistral-small3.2:latest   # filter and cover-letter model
cp config/profile.example.json config/profile.json   # fill in your own data
```

`config/profile.json` is gitignored — it holds name, education, skills,
projects and links that flow into every generated cover letter.

## Configuration (`config/`)

| File | Purpose |
|---|---|
| `profile.json` | Applicant profile used for cover-letter generation (copy from `profile.example.json`) |
| `sources.json` | Which portals are active (karriere.at, devjobs.at, LinkedIn, AMS, jobs.at) + search queries per portal |
| `location.json` | Whitelist of cities/regions (Upper Austria) + remote keywords |
| `experience-rules.json` | Keyword/phrase lists for the regex filter (years of experience, junior signals, exclusion/negation words) |
| `settings.json` | `filterMode` (`regex` or `llm`) and fallback `filterModel` |

### Tuning the config files

- **`sources.json`**: toggle portals and adjust search queries per portal
  if you're getting too few/too many hits.
- **`location.json`**: add cities/regions to the whitelist, extend remote
  keywords if good jobs are getting filtered out.
- **`experience-rules.json`**: sharpen the keyword lists (years of
  experience, junior signals, exclusion words) when `data/filter-log.md`
  shows the regex filter misclassifying (too strict → rejected, too loose →
  uncertain).
- **`settings.json`**: set `filterMode` to `llm` to use the Ollama filter
  instead of regex (needs Ollama running + `filterModel` set).

## Model selection

Several local Ollama models were benchmarked for cover-letter generation
(full raw data: `data/anschreiben/test/`), so others can skip re-running
the comparison:

| Model | Result |
|---|---|
| `qwen2.5:7b` | Quality unsatisfactory — dropped |
| `qwen3.5:9b` | Fastest (~115s/job), but hallucinated skills not in the profile in several test jobs |
| `qwen3:30b` | Too big for this CPU-only setup — every test job timed out (>10min) |
| `gemma3:12b` | Decent quality, but the only model that needed repeated retries; RAM usage grew continuously with no plateau over a test run (~15→23GB) — a real OOM risk on longer batches |
| `mistral-small3.2:latest` | Best quality (most honest about missing skills, no invented parallels), most stable RAM usage, no retries — **current choice** for both filter and cover letters |

The temperature and duration numbers in the "Performance" section below
refer to `mistral-small3.2`, the model actually used in production.

## Performance

Tested on a Lenovo T14 (AMD Ryzen 7 PRO 5850U), 6 CPU cores, no GPU support
under Ollama. CPU temperature under
load: peak ~81°C, ~70°C on average. One cover letter takes ~3-4 min,
depending on how well the job matches the profile (see the `clean`/
`offstack`/`brutal` test fixtures in `scripts/anschreiben-model-bench.ts` —
clean = good fit, offstack = tech stack diverges, brutal = big mismatch,
needs more text honestly naming the gaps).

## Commands

```bash
npm run check   # Ollama reachable + models installed?
npm run smoke    # end-to-end storage test (JsonStore lifecycle)
npm run dev      # health summary + current job count in storage
npm run typecheck
```

### Pipeline

```bash
npm run scrape                       # all sources enabled in sources.json
npm run scrape:karriere              # single source: karriere | devjobs | linkedin | ams | jobs
npm run scrape -- --source=karriere  # equivalent, directly via flag

npm run filter                    # filter all 'new' jobs (mode from settings.json)
npm run filter:regex              # force the regex strategy (offline, no Ollama needed)
npm run filter -- --source=llm    # force the mode directly via flag (llm | regex)

npm run anschreiben                       # generate cover letters for all matched/uncertain jobs
npm run anschreiben -- --data=save        # only data/jobs/sicher/   (status "matched")
npm run anschreiben -- --data=unsave      # only data/jobs/unsicher/ (status "uncertain")
npm run anschreiben -- --limit=5          # only the first N jobs of the selection
npm run anschreiben -- --source=<model>   # override the Ollama model for this run

npm run ui   # job browser + Gmail integration, http://localhost:3000
```

Flags go after `--` (npm convention, otherwise npm parses them itself) and
can be combined, e.g. `npm run anschreiben -- --data=save --limit=3`.

`npm run scrape` writes new jobs to `data/jobs/`. `npm run filter` sets each
job's status (see lifecycle below) and writes a report to
`data/filter-log.md`. `npm run anschreiben` places finished letters under
`data/anschreiben/title_company_date_id8.md`, also tries to find an
application email address (regex on the listing, then a firmenabc.at
fallback), and logs every run (model, `--data` filter, count, emails found)
to `data/anschreiben/AnschreibenLog.md`.

`scripts/anschreiben-model-bench.ts` is not a pipeline step — it's a dev
tool for comparing several Ollama models on the same test jobs.

### Gmail integration

`npm run ui` shows an editable email preview (To/Subject/Body) for each job
once its status is `reviewed`, with two actions: **Create draft** (lands as
a real, editable draft in Gmail) or **Send directly** (with a confirmation
dialog). Both go through a Gmail App Password, not OAuth:

1. Turn on 2-Step Verification on your Google account (if not already on).
2. Generate an App Password: `myaccount.google.com/apppasswords` (no longer
   linked from the normal Security menu — Google hid the link; go there
   directly or search for it inside your Google Account).
3. Create `.env` (see `.env.example`, gitignored):
   ```
   GMAIL_USER=your-address@gmail.com
   GMAIL_APP_PASSWORD=the-16-character-app-password
   ```
4. `npm run ui` — loads `.env` automatically (`--env-file-if-exists`, needs
   Node ≥21.7).

If `.env` is missing, the UI still runs — only draft/send fail with a clear
error message instead of the page not loading at all.

## Tests

```bash
npm test           # node:test + node:assert/strict, no extra package
npm run test:watch # watch mode
```

All tests run against temp directories and a local mock server — no real
Ollama, no real `data/jobs/`.

## Storage

One JSON file per job under `data/jobs/title_company_date_id8.json`
(matched/uncertain additionally land in `data/jobs/sicher/` and
`data/jobs/unsicher/` respectively). No global collection JSON, dedup via
file existence. The job `id` is a deterministic 16-character SHA-256 hash
of title + company (the first 8 characters end up in the filename) — the
same job is never added twice on a re-scrape.

The whole system only talks to storage through the `Storage` interface
(`storage/index.ts`) — swappable for SQLite without code changes outside
`storage/`.

## Job lifecycle

```
new → filtered_out | matched → generated → reviewed → drafted → sent
```

`scrape` creates `new`, `filter` sets `filtered_out`/`matched`/`uncertain`,
`anschreiben` sets `generated`. `reviewed` is set manually in the UI (status
dropdown) — only then does the UI unlock draft/send. `drafted`/`sent` are
set by the UI itself, only on an actually successful Gmail call (no status
change on failure). There is still no auto-send without that explicit click.

## Environment variables

| Variable | Default |
|---|---|
| `OLLAMA_HOST` | `http://localhost:11434` |
| `JOBBOT_MODEL_FILTER` | `mistral-small3.2:latest` |
| `JOBBOT_MODEL_WRITER` | `mistral-small3.2:latest` |
| `GMAIL_USER` | — (see [Gmail integration](#gmail-integration)) |
| `GMAIL_APP_PASSWORD` | — (see [Gmail integration](#gmail-integration)) |
| `UI_PORT` | `3000` |
