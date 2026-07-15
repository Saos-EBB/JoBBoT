# JoBBoT

*[Deutsch](README.md)*

Local job scraper with an LLM cover-letter generator. Runs fully offline/
local (Ollama), no cloud dependency. Pipeline: **Scrape → Filter → Cover
letter → Review** (review/sending are currently manual).

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

## Performance

Tested on 6 CPU cores, no GPU support under Ollama. CPU temperature under
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
```

Flags go after `--` (npm convention, otherwise npm parses them itself) and
can be combined, e.g. `npm run anschreiben -- --data=save --limit=3`.

`npm run scrape` writes new jobs to `data/jobs/`. `npm run filter` sets each
job's status (see lifecycle below) and writes a report to
`data/filter-log.md`. `npm run anschreiben` places finished letters under
`data/anschreiben/title_company_date_id8.md` and logs every run (model,
`--data` filter, count) to `data/anschreiben/AnschreibenLog.md`.

`scripts/anschreiben-model-bench.ts` is not a pipeline step — it's a dev
tool for comparing several Ollama models on the same test jobs.

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
`anschreiben` sets `generated`. Review, drafting and sending are currently
manual steps — there is no auto-send (yet).

## Environment variables

| Variable | Default |
|---|---|
| `OLLAMA_HOST` | `http://localhost:11434` |
| `JOBBOT_MODEL_FILTER` | `mistral-small3.2:latest` |
| `JOBBOT_MODEL_WRITER` | `mistral-small3.2:latest` |
