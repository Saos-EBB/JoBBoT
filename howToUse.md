# How to Use JoBBoT

Step-by-step guide to get JoBBoT running on your own machine. For the full
feature reference see [README.en.md](README.en.md); this file is just the
"what do I actually type" path.

## 1. Prerequisites

- **Node.js ≥ 21.7** (needed for `--env-file-if-exists`, used by `npm run ui`).
  Check with `node -v`.
- **npm** (comes with Node).
- **[llama.cpp](https://github.com/ggml-org/llama.cpp)** (`llama-server`) and
  one GGUF model — this is what generates cover letters and (optionally) does
  LLM-based filtering.
  Everything runs on your own machine, no cloud API keys needed for the core
  pipeline.
- **Linux/macOS/Windows** — tested on Linux; desktop notifications
  (`notify-send`) are Linux-only and silently no-op elsewhere.
- A **Gmail account** — only if you want the bot to draft/send emails for you.
  Optional; everything else works without it.

## 2. Get the code and install dependencies

```bash
git clone <your-fork-or-repo-url>
cd JoBBoT
npm install
```

Install the headless browser used by two of the five scrapers (AMS,
DevJobs.at — the other three use plain HTTP):

```bash
npx playwright install chromium
```

## 3. Install llama.cpp and download the model

Get a prebuilt `llama-server` from the
[llama.cpp releases](https://github.com/ggml-org/llama.cpp/releases) (the
Vulkan build also runs CPU-only), unpack it and point a `current` symlink at it:

```bash
mkdir -p ~/.local/opt/llama.cpp && cd ~/.local/opt/llama.cpp
# unpack the release archive here, then:
ln -sfn <unpacked-dir> current      # current/llama-server must exist
```

Download the default model (Gemma 4 26B, ~14.4 GB) into the models folder:

```bash
mkdir -p ~/.local/share/llama-models && cd ~/.local/share/llama-models
curl -L -C - -O https://huggingface.co/google/gemma-4-26B-A4B-it-qat-q4_0-gguf/resolve/main/gemma-4-26B_q4_0-it.gguf
```

For JEV — the classifier behind `filterMode: "nimble"` and the reply kinds of
the Gmail sync (rejection, offer, …) — you also need Bespoke Nimble 9B (Q8_0,
~9.5 GB, Apache-2.0). It's published in the Ollama registry; no Ollama install
needed, `curl` fetches the GGUF directly. The digest is read from the manifest,
so the command keeps working when the model gets updated:

```bash
cd ~/.local/share/llama-models
D=$(curl -sL -H "Accept: application/vnd.docker.distribution.manifest.v2+json" \
  https://registry.ollama.ai/v2/library/nimble/manifests/latest \
  | grep -o '"mediaType":"application/vnd.ollama.image.model","digest":"[^"]*' | cut -d'"' -f8)
curl -L -C - -o Bespoke-Nimble-9B-Q8_0.gguf https://registry.ollama.ai/v2/library/nimble/blobs/$D
echo "${D#sha256:}  Bespoke-Nimble-9B-Q8_0.gguf" | sha256sum -c
```

The file name must stay `Bespoke-Nimble-9B-Q8_0.gguf` — the presets
`nimble-9b` (CPU) and `nimble-9b-vulkan` (iGPU, default) in
`config/llama-models.ini` point to it. Without Nimble, keep `filterMode` on
`"regex"`; the Gmail sync still runs, replies just stay without a kind.

You don't start the server yourself: JoBBoT runs `scripts/llama-server.sh` the
first time it needs the model (log: `data/llama-server.log`). Model names are
the preset names in `config/llama-models.ini` — the default `gemma4-26b-cpu`
runs on the CPU; to use another model, add a preset there and set
`JOBBOT_LLAMACPP_MODEL` (see [Environment variables](#7-environment-variables)).
Paths are overridable via `LLAMA_BIN` and `LLAMA_MODELS_DIR`.

## 4. Set up your applicant profile

This is the data that gets woven into every generated cover letter (name,
education, skills, projects, links, a short "about me"). It's gitignored, so
it never ends up in version control:

```bash
cp config/profile.example.json config/profile.json
```

Open `config/profile.json` and fill in your own details.

## 5. Review the rest of the config (optional, but worth a look)

| File | What it controls |
|---|---|
| `config/sources.json` | which of the 5 portals (karriere.at, devjobs.at, LinkedIn, AMS, jobs.at) are active, and the search keywords per portal. Also editable from the UI's **Search** settings page once it's running. |
| `config/location.json` | whitelist of cities/regions your jobs must match (default: Upper Austria) + remote-work keywords. Also editable from the UI. |
| `config/experience-rules.json` | keyword lists that drive the regex filter (years-of-experience phrases, junior signals, exclusion words). Hand-edited only. |
| `config/settings.json` | `filterMode`: `"regex"` (default, fully offline, no LLM needed for filtering) or `"nimble"` (JEV: the local Bespoke Nimble 9B classifier judges role, experience and junior signal — ~7 s/job). |

You can safely skip this step for a first run — the defaults work, they'll
just search Upper Austria with generic keywords. Come back and tune these
once you see what the scraper/filter actually turns up.

## 6. (Optional) Set up Gmail sending

Only needed if you want JoBBoT to create Gmail drafts or send emails
directly from the UI. Skip this section if you'd rather copy-paste cover
letters into your own email client by hand.

1. Turn on **2-Step Verification** on your Google account, if it isn't on
   already.
2. Generate an **App Password**: go to
   `myaccount.google.com/apppasswords` directly (Google has hidden this link
   from the normal Security menu — searching for "app password" inside your
   Google Account also finds it).
3. Create a `.env` file in the project root (copy `.env.example`):
   ```
   GMAIL_USER=your-address@gmail.com
   GMAIL_APP_PASSWORD=the-16-character-app-password
   ```
   This file is gitignored — it never gets committed.

If you skip this, the UI still works fine for scraping/filtering/writing —
only the "Create draft" / "Send" buttons will fail with a clear error.

## 7. Environment variables

All optional — sane defaults are baked in. Only set these if you need to
override something.

| Variable | Default | Purpose |
|---|---|---|
| `LLAMACPP_HOST` | `http://127.0.0.1:8089` | Where `llama-server` is listening |
| `JOBBOT_LLAMACPP_MODEL` | `gemma4-26b-cpu` | Preset used for cover-letter generation |
| `JOBBOT_LLAMACPP_NIMBLE_MODEL` | `nimble-9b-vulkan` | Preset used for JEV filtering (`filterMode: "nimble"`) |
| `LLAMA_BIN`, `LLAMA_MODELS_DIR` | `~/.local/opt/llama.cpp/current/llama-server`, `~/.local/share/llama-models` | Where the server binary and GGUF files live |
| `GMAIL_USER` | — | Your Gmail address (see step 6) |
| `GMAIL_APP_PASSWORD` | — | Gmail app password (see step 6) |
| `UI_PORT` | `3000` | Port for `npm run ui` (overridden by `--port=<n>`, which wins) |

Set them either in `.env` (auto-loaded by `npm run ui`) or by exporting them
in your shell before running a script.

## 8. Health check before your first real run

```bash
npm run check   # does llama-server answer, and do the configured presets exist?
npm run dev     # same check, plus a summary of what's currently in storage
npm run smoke   # exercises the storage layer end-to-end (no network calls)
```

`npm run check` should print a green checkmark with both model names before
you proceed. If it complains about a missing model, the GGUF file named in
that preset isn't in your models folder yet.

## 9. Run the pipeline

You can drive everything from the terminal, or skip straight to [step 10](#10-or-just-use-the-ui)
and do it all from the browser instead — the UI runs the exact same scripts
in the background. From the terminal:

```bash
# 1. Scrape job listings from all enabled portals into data/jobs/
npm run scrape
# ...or just one portal while testing:
npm run scrape:karriere   # karriere | devjobs | linkedin | ams | jobs

# 2. Filter: classify every 'new' job as matched / offstack / brutal
npm run filter
# force the offline regex strategy regardless of settings.json:
npm run filter:regex

# 3. Generate cover letters for everything that's triaged and not 'brutal'
npm run anschreiben
```

Flags go after `--`, e.g. `npm run anschreiben -- --limit=5` to only process
the first 5 jobs while you're trying things out. See
[README.en.md](README.en.md#pipeline) for the full flag reference
(`--source=`, `--data=`, `--scope=`, etc.).

Output lands in:
- `data/jobs/` — every scraped job, one JSON file each (sorted into
  `matched/` / `offstack/` / `brutal/` subfolders after filtering)
- `data/anschreiben/` — generated cover letters (`.md` files)
- `data/filter-log.md` — a running log of every filter run

## 10. Or just use the UI

This is the recommended way to actually work with JoBBoT day to day — review
jobs, edit generated letters, and send/draft mail, all in the browser.

First build the frontend bundle (only needed once, and again after any UI
code change — there's no hot reload):

```bash
npm run build:ui
```

Then start the server:

```bash
npm run ui
```

Open **http://localhost:3000**. From there:

- The **Pipeline** section in the sidebar lets you trigger Scrape / Filter /
  Cover letters / Follow-ups directly from the browser, with a live progress
  bar and a desktop notification (Linux, via `notify-send`) when a run
  finishes.
- Review each generated job, edit the cover letter text and the email
  preview (To/Subject/Body), then move it to **Reviewed** (`freigegeben`) —
  only then do the "Create draft" / "Send" buttons unlock.
- The **Calendar** tab shows sent applications, follow-ups, and replies over
  time; **Follow-ups** lists applications waiting too long for a reply.

Use `npm run ui -- --port=3001` if port 3000 is taken.

## 11. Job status lifecycle, in short

```
new → triaged → generated → freigegeben → postausgang → gesendet
```

`scrape` creates `new`. `filter` sets `triaged` (the actual verdict —
matched/offstack/brutal — lives in a separate `fit` field). `anschreiben`
sets `generated`. Everything after that (`freigegeben` = reviewed,
`postausgang` = drafted, `gesendet` = sent) is set manually or via a
confirmed action in the UI — **there is no auto-send**, ever.

## 12. Running the tests (optional, for development)

```bash
npm test           # node:test + node:assert/strict, no extra framework
npm run test:watch # watch mode
npm run typecheck  # tsc --noEmit
```

Tests never touch a real LLM server or your real `data/jobs/` — they run
against temp directories and an in-process mock HTTP server.

## Troubleshooting

- **`npm run check` fails / times out** — `llama-server` didn't come up. Look
  at `data/llama-server.log` (wrong binary path, missing GGUF, not enough RAM).
- **`npm run ui` shows a blank page or 404s on `/app.js`** — you skipped
  `npm run build:ui`, or changed `ui/app.tsx` without rebuilding.
- **`npm run ui` complains about `--env-file-if-exists`** — your Node version
  is below 21.7; upgrade Node.
- **AMS or DevJobs.at scraping fails** — make sure you ran
  `npx playwright install chromium` (step 2).
- **Draft/Send buttons error out** — `.env` is missing or the Gmail app
  password is wrong/revoked; see step 6.
