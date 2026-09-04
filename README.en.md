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
| `sources.json` | Which portals are active (karriere.at, devjobs.at, LinkedIn, AMS, jobs.at) + search queries per portal — **also editable from the UI**, see [Settings page "Search"](#settings-page-search) |
| `location.json` | Whitelist of cities/regions (Upper Austria) + remote keywords — **also editable from the UI** |
| `experience-rules.json` | Keyword/phrase lists for the regex filter (years of experience, junior signals, exclusion/negation words) |
| `settings.json` | `filterMode` (`regex` or `llm`) and fallback `filterModel` |

### Tuning the config files

`sources.json` and `location.json` can be edited in the browser as of v0.5 via
the **Search** settings page — no editor, no JSON knowledge, works on a phone.
The other three files are still edited by hand.

Every config file is re-read on each use (`loadSources()`,
`loadLocationConfig()` in `lib/scrape-setup.ts`) — no server restart needed
after a change.

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
npm run filter:all                # re-triage ALL jobs, not just 'new' (--scope=all)
npm run filter -- --scope=all     # equivalent, directly via flag (new | all, default new)

npm run duplicates   # report: jobs whose normalized title+company (lowercased,
                      # gender markers, legal-form suffixes stripped) collide. Deletes nothing.

npm run anschreiben                       # generate cover letters for all triaged jobs (fit != brutal)
npm run anschreiben -- --data=save        # only data/jobs/matched/  (fit "matched")
npm run anschreiben -- --data=unsave      # only data/jobs/offstack/ (fit "offstack")
npm run anschreiben -- --limit=5          # only the first N jobs of the selection
npm run anschreiben -- --source=<model>   # override the Ollama model for this run

npm run ui                  # job browser + Gmail integration, http://localhost:3000
npm run ui -- --port=3001   # force a different port (otherwise UI_PORT env or 3000)
```

Flags go after `--` (npm convention, otherwise npm parses them itself) and
can be combined, e.g. `npm run anschreiben -- --data=save --limit=3`.

`npm run scrape` writes new jobs to `data/jobs/`. `npm run filter` sets
status `triaged` + `fit` (see lifecycle below) and writes a report to
`data/filter-log.md`; with `--scope=all` it re-triages every existing job
instead of only those with status `new` — useful after tweaking the filter
rules, so the database doesn't sit on stale judgments. A re-triage only
re-decides the **verdict** (`fit`); it sets the status exclusively for jobs
still in triage (`new`/`triaged`) — a job with a finished cover letter or a
sent application stays where it is. `npm run duplicates`
finds jobs whose title+company collide once normalized (lowercased, gender
markers like `(m/w/d)`, legal-form suffixes like `GmbH` stripped) — a plain
report, nothing gets deleted automatically. `npm run anschreiben` places
finished letters under
`data/anschreiben/title_company_id8.md`, also tries to find an
application email address (regex on the listing, then a firmenabc.at
fallback), and logs every run (model, `--data` filter, count, emails found)
to `data/anschreiben/AnschreibenLog.md`.

The filename deliberately carries **no date** — and lookup goes by the `id8`
prefix anyway, see [Storage](#storage).

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

## UI & Server

`npm run ui` starts `scripts/ui-server.ts` — a plain `node:http` server (no
framework) that does two things at once:

- **Static frontend**: `ui/app.tsx` (React) is bundled with `npm run
  build:ui` (esbuild) into `ui/dist/app.js` and served at `/app.js`. Rebuild
  after every change to `ui/app.tsx` — there's no hot reload.
- **JSON API** the SPA talks to via `fetch`: `/api/jobs`, `/api/jobs/:id`
  (change status/fit), `/api/jobs/:id/brief` (edit the cover letter),
  `/api/jobs/:id/draft` / `/api/jobs/:id/send` (Gmail), `/api/attachment`
  (résumé upload), `/api/duplicates` (duplicate report, GET, synchronous),
  `/api/duplicates/merge` (merge a duplicate group), `/api/calendar`
  (calendar events, GET, synchronous), `/api/mail/replies/fetch` (scan the
  Gmail inbox for replies), `/api/gmail-sync` (backfill `sentAt`/
  `replyReceivedAt`, read-only towards Gmail), `/api/jobs/:id/followup`
  (follow-up as draft or send), `/api/config/schema` (search fields per
  portal), `/api/config/sources` and `/api/config/location` (GET/PUT) plus
  `/api/config/:name/restore`, and `/api/scrape/*` / `/api/filter/*`
  (see below).

The interface has three width bands:

- **below 1024px** the sidebar becomes a drawer (burger in a top bar, overlay,
  Esc). The starting folder there is the first non-empty one, or the scraper —
  otherwise you land on an empty folder with no way out.
- **1024–2000px**: three columns, continuous via `clamp()` rather than in steps.
- **from 2000px** the cover letter and the posting sit side by side instead of
  behind tabs.

The most recently selected folder is remembered in `localStorage` and survives
a reload. Before, every F5 landed hard on "With mail → Drafts"; anyone sitting
in "Without mail → Drafts" ended up in the identically named but empty
neighbouring folder — it looked as if the drafts had vanished.

### Scrape/Filter from the UI

The sidebar has its own "Pipeline" group with entries **Scrape**, **Filter**,
**Duplicates**, **Cover letters**, and **Follow-ups** that trigger the matching `npm run
<x>` script from the browser instead of the terminal. Scrape/Filter/Cover
letters follow the same pattern:

1. `POST /api/scrape` (source selection) or `POST /api/filter` (`regex`/
   `llm` mode + `new`/`all` scope, see above) starts the run **in the
   background** inside the server process and responds immediately with a
   `runId` — no waiting on a long HTTP response.
2. The SPA polls `GET /api/scrape/status` / `/api/filter/status` every
   ~1.5s, regardless of which view is open — that's what keeps the progress
   bar under the sidebar entry visible even while browsing the job list.
3. If a run of the same kind is already active, a second `POST` gets a
   `409` instead of starting a second run.
4. On completion the UI shows a toast with a one-line summary (e.g. "14
   new, 6 deduped") and automatically refetches the job list.

The server keeps run state only in process memory (no restart recovery) —
fine for a local single-user tool.

**Duplicates** follows a simpler, different pattern: `GET /api/duplicates`
is a synchronous read with no background run/polling — it returns the
duplicate groups directly in the response. The UI calls it when the view
opens; a "Check again" button triggers a refetch. Per group (or all at once)
a "Merge" button consolidates them: the newest listing survives but takes on
the oldest duplicate's `scrapedAt`; the remaining files get deleted. If the
surviving job has no cover letter yet but one of the removed twins does, that
letter comes along — otherwise it would be left behind as a file no job can
find any more.

### Bulk selection in the job list

Every row has a checkbox, in every folder. Once something is selected, a bar
appears with **Move** (Jobs / Rejected / Deleted), **Verdict** (Match /
Offstack / Brutal), **Delete**, and **Cover letters (n)**.

Two things that aren't obvious:

- The number on the cover-letter button is smaller than the selection when it
  contains unfiltered or brutal-rated jobs — the run can't process those. They
  stay selectable because they *are* meant for deleting and moving.
- "Move → Jobs" carries a brutal verdict along to `offstack`. *Jobs* and
  *Rejected* are both `status: triaged` and differ **only** in `fit` (see
  `lib/folders.ts`); without changing the verdict the job would fall straight
  back, which looks like "nothing happened".

Sent applications aren't selectable — they're read-only everywhere else in the
UI, and a bulk action shouldn't undercut that through the back door.

### Settings page "Search"

The **Search** entry (next to Attachment and CC) makes `sources.json` and
`location.json` editable in the browser. Two sections, because they are two
different things that could both be called "location":

- **Search area** — goes to the portal. Only LinkedIn and AMS have one; the
  other three search Austria-wide and are filtered afterwards.
- **Radius** — `location.json`, applied **after** scraping via `isInRange()`,
  for all five sources.

The shape of a portal block follows the field count, not the portal name: one
field becomes a chip cloud, several become labelled rows. How the page knows:
every `ScraperAdapter` carries a **`querySchema`** as of v0.5 — a required
field, so a portal without a schema doesn't compile. `GET /api/config/schema`
serves it to the browser.

The same schema is checked in three places: in the form while typing, on the
server before writing, and in the adapters while reading. All three call
`checkQuery()` from `lib/query-schema.ts` — the rules exist exactly once. A
query with a typo in the *key* (`keywords` instead of `keyword`) used to be
skipped silently; now the adapter reports it, and the page offers "Repair" when
the intent is unambiguous.

The collapsible raw JSON is a **view**, not a second editor — read-only with a
copy button, so there is no second source of truth.

On save the previous version moves to `<file>.bak`, and "Restore last version"
brings it back. One step deep; anything older comes from git, since both files
are versioned.

**One warning is built in**: "Österreich" as a region. `COUNTRY_ONLY`
(`lib/location-terms.ts`) is compared **exactly** in `isInRange()`, a region by
substring — entering it there would keep every job ending in "…, Österreich"
and effectively switch the radius filter off. The most obvious input there is,
and the only one that silently inverts the whole behaviour. Warned, not
forbidden.

### Follow-ups

The **Follow-ups** entry lists applications with no reply for at least
`FOLLOW_UP_DAYS` (3, see `lib/followup.ts`) — longest waiting first, with a due
count on the sidebar. Select individually or all, then **As draft** (Gmail
draft) or **Send** as a bulk action.

The clock runs from the **last contact**, not from `sentAt`: after a follow-up
the same job is due again three days later, repeating until a reply arrives. A
created draft counts as handled — otherwise the same job would get a second one
on the next visit. The history lives on the job as `followUps: [{ at, via }]`,
which is where "2× followed up" in the row comes from.

The subject deliberately stays the one from the application (`Bewerbung als X
bei Y`): that keeps the follow-up in the same Gmail thread, and
`lib/mail-match.ts` reconstructs exactly this subject to attribute incoming
replies to a job. A separate follow-up subject would make a reply to it miss
the subject match. The body is new and short, not the cover letter a second time.

### Calendar

The sidebar tab "Calendar" shows when applications went out (`sentAt`), when
follow-ups were sent (`followUps`), and when replies came back
(`replyReceivedAt`) — day = square, week = row, month = block, newest month
first. Three colours, legend in the header; a day carrying several kinds is
split accordingly. Every follow-up is its own entry, not just the last one —
the calendar should show how often you chased. Clicking a day opens a popup with that day's
entries and jumps from there to the job detail view.

The month row runs without gaps from `HISTORY_START` (`lib/calendar.ts`,
currently `2026-07-01`) to today — the same span the Gmail sync scans. Months
without activity still get a block, so that months far apart don't fake
adjacency; they start collapsed. Every month header is a toggle, and the
summary next to it ("2 sent · 1 reply") tells you even while collapsed whether
expanding is worth it.

Replies aren't detected
automatically: a "Fetch replies" button in the "Sent" folder (history) scans
the Gmail inbox via `POST /api/mail/replies/fetch` (email+subject matching,
no message ID) and sets `replyReceivedAt` on hits — jobs with a reply then
show a "Reply received" badge, with a "Only with reply" filter in the
history.

### Gmail sync (backfill)

The "Gmail sync" button at the top right of the Calendar tab backfills data
missing from the job JSON (`POST /api/gmail-sync`): the Sent folder supplies
`sentAt`, the inbox `replyReceivedAt`. Meant for applications that went out
before these fields existed, or by hand past the bot — live sends write their
own `sentAt` anyway.

Scanning starts at `HISTORY_START` (`lib/calendar.ts`, currently `2026-07-01`)
— the same starting point the calendar displays from.

**Which mails count:** only those labelled `Bewerbung` or `Beworben` in Gmail
(`BEWERBUNGS_LABELS` in `mail/gmail.ts`). The label is the most reliable
source: `job.email` is lost on a re-scrape and the subject changes when a
listing is re-read — your marking stays. Without a label nothing happens, and
private mail never ends up in the calendar.

**Matching to a job** runs on two equivalent keys: the reconstructed subject
(`Bewerbung als … bei …`, recomputable from title+company at any time) and the
recipient address. If either hits, the job gets its `sentAt`.

**Mails without a job** — because the listing was deleted, re-read, or written
by hand — don't disappear; they land in `data/mail-events.json` and show up in
the calendar as their own entry marked "nur Mail" (not clickable, there is no
detail view for them). Title and company come from the subject; if that doesn't
match the pattern, the recipient domain serves as the label. The file is a
snapshot of the mailbox, not a history: every run rewrites it completely, and
it is gitignored because it contains recipient addresses.

The message after a run names each stage separately — read, labelled, linked,
mail-only — because a bare "0 backfilled" would leave open whether the mailbox
was empty, the label is missing, or the matching found nothing.

Three properties you can rely on:

- **Read-only towards Gmail.** Both folders are opened with `readOnly: true`;
  the sync sends, deletes, and moves nothing, and doesn't mark anything as
  read either. The Sent folder is found via the IMAP flag `\Sent`, not via the
  (localized) folder name.
- **Fills gaps only.** An existing `sentAt`/`replyReceivedAt` is never
  overwritten, so a heuristic hit can't destroy a real value. Repeated runs
  are therefore harmless.
- **Changes no status.** Only the two date fields are ever written.

The matching is a heuristic, not an exact mapping: the message ID was never
stored when the mail was originally sent. Matching goes by the exact recipient
address; the reconstructed subject (`Bewerbung als … bei …`) only serves as a
tiebreaker when several jobs share the same company address. If it stays
ambiguous, nothing is set — unmatched jobs simply stay undated.

## Tests

```bash
npm test           # node:test + node:assert/strict, no extra package
npm run test:watch # watch mode
```

All tests run against temp directories and a local mock server — no real
Ollama, no real `data/jobs/`.

## Storage

One JSON file per job under `data/jobs/title_company_date_id8.json`
(triaged jobs additionally land in `data/jobs/matched/`,
`data/jobs/offstack/`, or `data/jobs/brutal/`, depending on fit). No global
collection JSON, dedup via
file existence. The job `id` is a deterministic 16-character SHA-256 hash
of title + company (the first 8 characters end up in the filename) — the
same job is never added twice on a re-scrape.

The whole system only talks to storage through the `Storage` interface
(`storage/index.ts`) — swappable for SQLite without code changes outside
`storage/`.

### How a file finds its job

Both job JSONs and cover letters are looked up **by the `id8` prefix at the
end of the filename**, never by the full name. The readable part in front is
decoration:

```
data/jobs/title_company_date_id8.json     JsonStore.findFile()
data/anschreiben/title_company_id8.md     findAnschreiben()  (lib/anschreiben-datei.ts)
```

The reason is experience, not taste. Cover letters used to be looked up by the
full name including the **date** — and the date is not part of the identity,
it is a value that changes:

- a **re-scrape** of the same posting yields a new `postedAt`
- a **duplicate merge** sets `keep.scrapedAt` to that of the oldest twin

In both cases the already-written letter was invisible to its own job — on a
merge even to the job the merge keeps. On 2026-09-04 that affected 46 of 101
files. So the resolution now lives in one place (`lib/anschreiben-datei.ts`)
instead of four, a write cleans up a file sitting under an old name, and a
merge carries over the cover letter of a removed twin.

### One-off scripts

Repairs to existing data, not part of the pipeline. All run as a **dry run**
without arguments and take a backup under `data/backup-*/` (gitignored)
before writing with `--apply`:

```bash
npx tsx scripts/repair-status.ts          # restore status from cover-letter files + mail-log
npx tsx scripts/repair-anschreiben.ts     # match letters to their jobs, drop orphans
npx tsx scripts/migrate-descriptions.ts   # normalize descriptions retroactively
```

## Job lifecycle

```
new → triaged → generated → freigegeben → postausgang → gesendet
                                    (+ geloescht/fehler as side paths)

new/triaged ⇄ offline   (offline archive, see below — both directions automatic)
```

Status names are German in the data model (`freigegeben` = reviewed,
`postausgang` = drafted/outbox, `gesendet` = sent, `geloescht` = deleted,
`fehler` = error). `scrape` creates `new`. `filter` sets status `triaged` —
the actual verdict lives in a separate `fit` field (`matched`/`offstack`/
`brutal`, still manually overridable in the UI), not in the status anymore.
`anschreiben` sets `generated`. `freigegeben` is set manually in the UI —
only then does the UI unlock draft/send. `postausgang` (Gmail draft created,
send not yet confirmed) and `gesendet` are set by the UI itself, only on an
actually successful Gmail call (no status change on failure — those land on
`fehler` instead). `geloescht` is reachable from most states (a trash bin,
not a file delete). There is still no auto-send without the explicit
"confirm sent" click.

**The pipeline only moves forward.** A re-triage (`--scope=all`) re-decides the
`fit` verdict but only sets the status for jobs still in triage. It used to do
so unconditionally — every such run threw `generated`/`postausgang`/`gesendet`
back to the start, and the affected applications reappeared in the "Jobs"
folder as if no cover letter had ever been written or application sent. On
2026-09-04 that affected 21 sent applications and 33 jobs with a finished
cover letter; `scripts/repair-status.ts` restored them from the cover-letter
files and `data/mail-log.md`.

`gesendet` isn't the end: `followUps` collects every follow-up as
`{ at, via }` (see [Follow-ups](#follow-ups)). The status does **not** change —
the application was sent and stays sent; a follow-up isn't a new state but
another contact. Same for `replyReceivedAt`: a reply is additional information,
not a status change.

## Offline archive

While scraping, the run checks whether stored postings are still online. If one
is provably gone, the job moves to status `offline` and shows up in the UI
under **History → Offline**. If the same posting later reappears in the search
results, the same run brings it back automatically.

**Two stages.** "Not found in this run" only picks the *candidates* (that costs
nothing, the results are already at hand); archiving happens only once a single
fetch of the job URL *confirms* it.

The cheap stage alone is not enough: search queries are freely editable in the
settings page — after changing "Linz" to "Wels" half the library would be
missing. Add pagination caps: a posting scraped weeks ago is long off page 1
and still online. A silently archived live job is a missed job; one archived a
run too late costs nothing.

**What gets archived — and what doesn't:**

| Guard | Rule |
| --- | --- |
| Status | only `new` and `triaged`. From `generated` onwards the job carries your own work (cover letter, approval, send) — the portal pulling the posting doesn't end the application in flight. |
| Source | only sources that ran **and** succeeded in **this** run. A network failure or a deselected source archives nothing. |
| Signal | only a **verified** offline signal. `unbekannt` (rate limit, timeout, server error) leaves the job alone. |
| Volume | at most 25 re-checks per run, 1 s apart, oldest posting first. The rest waits for the next run. |

**Verified offline markers** (`lib/offline-check.ts`, measured 2026-09-04).
Anything missing here gets no guessed pattern:

| Source | Marker |
| --- | --- |
| karriere.at | HTTP 404 **or** 200 with a redirect away from `/jobs/<nr>` — an expired posting answers with 200 on a search page there, so the status code alone doesn't separate dead from alive. |
| jobs.at, linkedin, devjobs.at, ams | 404/410 only. No offline sample was available for these (devjobs.at answered the first test fetch with 429), so there is no additional marker. |

**Bringing a job back** needs no stored "previous" field: only `new` and
`triaged` are archived, and those two differ exactly by the `fit` field —
without `fit` back to `new`, with `fit` back to `triaged`. Only the status is
touched; `email`/`fit`/`scrapedAt` survive unchanged.

**Known limitation:** if two files exist for one ID (legacy data from before
the current `hash.ts`), the status change hits only one of them. That's the
existing duplicate topic — `npm run duplicates` reports it.

## Environment variables

| Variable | Default |
|---|---|
| `OLLAMA_HOST` | `http://localhost:11434` |
| `JOBBOT_MODEL_FILTER` | `mistral-small3.2:latest` |
| `JOBBOT_MODEL_WRITER` | `mistral-small3.2:latest` |
| `GMAIL_USER` | — (see [Gmail integration](#gmail-integration)) |
| `GMAIL_APP_PASSWORD` | — (see [Gmail integration](#gmail-integration)) |
| `UI_PORT` | `3000` (overridden by `npm run ui -- --port=<n>`, which wins over `UI_PORT`) |
