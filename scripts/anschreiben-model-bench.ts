import { readFile, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { buildAnschreibenPrompt, parseAnschreibenResponse, SYSTEM, readNdjsonContent } from '../lib/anschreiben.ts';
import { loadProfile, type ProfileData } from '../lib/profile.ts';
import { config } from '../config.ts';
import type { Job } from '../scrapers/interface.ts';

const execFileAsync = promisify(execFile);

// Fairer Vergleich: dieselben 3 fixen Jobs durch alle Modelle, direkt gegen Ollama
// (kein Storage-Zugriff, damit Jobs nicht durch Status-Wechsel aus sicher/ wandern).
// Retry nur der beiden Modelle, die beim ersten Lauf per OOM-Kill weggebrochen sind
// (mistral-small3.2 lud, während gemma3:12b noch resident war). Fix: nach jedem
// Modell explizit `ollama stop`, damit sich zwei große Modelle nie den RAM teilen.
const MODELS = ['mistral-small3.2:latest', 'qwen3:30b'];
const JOBS: Record<string, string> = {
  clean: 'data/jobs/sicher/junior-softwareentwickler-java-w-m-d_kern-engineering-careers_2026-06-25_1f8fd77c.json',
  offstack: 'data/jobs/unsicher/software-engineer-c_teamviewer_2026-06-17_8eb9f22d.json',
  brutal: 'data/jobs/sicher/sachbearbeiter-in-webentwicklung-und-it_land-oberoesterreich_2026-06-30_806fb930.json',
};
const RETRIES = 3;
const TIMEOUT_MODEL = 'qwen3:30b';
const TIMEOUT_MS = 10 * 60 * 1000;
const TEST_DIR = join(config.anschreibenDir, 'test', 'fair_compare');
const LOG_PATH = join(config.anschreibenDir, 'test', 'AnschreibenTestLog.md');

const sanitize = (tag: string) => tag.replace(/[/:.]/g, '_');
const ts = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

async function generateOnce(job: Job, profile: ProfileData, model: string): Promise<string> {
  const controller = model === TIMEOUT_MODEL ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : undefined;
  try {
    const res = await fetch(`${config.ollamaHost}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller?.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: buildAnschreibenPrompt(job, profile) },
        ],
        stream: true,
        // think:false greift nur bei qwen3-Modellen; bei gemma/mistral wirkungslos
        // (kein Fehler, kein Retry) — bewusst identisch für alle Modelle gesetzt.
        think: false,
        options: { num_ctx: 4096, temperature: 0.3 },
      }),
    });
    if (!res.ok) throw new Error(`ollama HTTP ${res.status}`);
    const raw = await readNdjsonContent(res);
    const result = parseAnschreibenResponse(raw);
    if (!result) throw new Error('Parse-Fehler (leer/Platzhalter/Floskel)');
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function main() {
  const profile = loadProfile();
  const jobs: Record<string, Job> = {};
  for (const [type, path] of Object.entries(JOBS)) {
    jobs[type] = JSON.parse(await readFile(path, 'utf8')) as Job;
  }

  await appendFile(
    LOG_PATH,
    `\n# FAIR-COMPARE RETRY (mistral-small3.2 + qwen3:30b, nach OOM-Fix mit \`ollama stop\` zwischen Modellen)\n\nStart: ${ts()}\n\n` +
      `| Modell | Job | Zeit | Status | halluziniert? | Lücke ehrlich? |\n|---|---|---|---|---|---|\n`,
  );

  const modelTotals: { model: string; seconds: number }[] = [];

  for (const model of MODELS) {
    const modelStart = Date.now();

    for (const [jobtype, job] of Object.entries(jobs)) {
      const t0 = Date.now();
      let attempt = 0;
      let lastErr = '';
      let text: string | null = null;

      while (attempt < RETRIES && text === null) {
        attempt++;
        try {
          text = await generateOnce(job, profile, model);
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') {
            lastErr = 'timeout>10min';
            break; // kein Retry bei Timeout — direkt SKIP, Lauf geht weiter
          }
          lastErr = err instanceof Error ? err.message : String(err);
        }
      }

      const seconds = ((Date.now() - t0) / 1000).toFixed(1);
      const dir = join(TEST_DIR, sanitize(model));

      if (text) {
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, `${jobtype}.md`), text, 'utf8');
        const status = attempt > 1 ? `OK RETRY(${attempt - 1})` : 'OK';
        await appendFile(LOG_PATH, `| ${model} | ${jobtype} | ${seconds}s | ${status} | | |\n`);
        console.log(`${model} / ${jobtype}: ${status} — ${seconds}s`);
      } else {
        await appendFile(LOG_PATH, `| ${model} | ${jobtype} | ${seconds}s | SKIP(${lastErr}) | | |\n`);
        console.log(`${model} / ${jobtype}: SKIP(${lastErr}) — ${seconds}s`);
      }
    }

    modelTotals.push({ model, seconds: (Date.now() - modelStart) / 1000 });

    // Modell explizit entladen, bevor das nächste (ggf. große) Modell lädt —
    // ohne das würde Ollama bis zum keep_alive-Timeout (Default 5min) im RAM
    // bleiben und sich mit dem nächsten Modell den Speicher teilen -> OOM.
    try {
      await execFileAsync('ollama', ['stop', model]);
    } catch (err) {
      console.warn(`ollama stop ${model} fehlgeschlagen:`, err instanceof Error ? err.message : err);
    }
  }

  let summary = '\n';
  for (const t of modelTotals) summary += `${t.model} — Gesamtzeit: ${t.seconds.toFixed(1)}s\n`;
  summary += `\nEnde: ${ts()}\n`;
  await appendFile(LOG_PATH, summary);

  console.log(`Fertig. Log: ${LOG_PATH}, Drafts: ${TEST_DIR}`);
}

await main();
