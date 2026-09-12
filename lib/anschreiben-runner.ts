import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import type { Job } from '../scrapers/interface.ts';
import type { Storage } from '../storage/json-store.ts';
import type { ProfileData } from './profile.ts';
import { generateAnschreiben, type GenerateAnschreibenOptions } from './anschreiben.ts';
import { findEmail, FIRMENABC_USER_AGENT, type FindEmailJob } from './find-email.ts';
import { sleep } from './fetch-page.ts';
import { config } from '../config.ts';

// Seam für den Browser: runAnschreiben selbst weiß nichts von Playwright, nur dass es
// einen Finder mit find()/close() bekommt. Zwei Adapter rechtfertigen ihn — der echte
// (Chromium+firmenabc.at) hier unten, ein Fake in Tests, der ohne Browser antwortet.
export interface EmailFinder {
  find(job: FindEmailJob): Promise<string | null>;
  close(): Promise<void>;
}

async function createBrowserEmailFinder(): Promise<EmailFinder> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ userAgent: FIRMENABC_USER_AGENT });
  return {
    find: job => findEmail(job, page),
    close: () => browser.close(),
  };
}

// Ein fertig generiertes (oder fehlgeschlagenes) Anschreiben, fürs Lade-Grid im UI —
// siehe ui/app.tsx LoadGrid. Eine Zeile pro Item (nicht gebündelt in Batches wie beim
// Filter): jede Generierung dauert Minuten, ein Batch von 10 hieße lange Stille.
export interface AnschreibenGridItem {
  id: string;
  tooltip: string;
  state: 'done' | 'error';
}

export interface AnschreibenOutcome {
  generated: number;
  skipped: number;
  emailsFound: number;
  // Aufschlüsselung von `generated` nach Mail-Status am Ende des Laufs (job.email
  // kann sich innerhalb dieser Schleife durch findEmail() ändern) — die UI markiert
  // sonst blind beide Entwürfe-Ordner, egal ob dort überhaupt was Neues liegt.
  mailGenerated: number;
  nomailGenerated: number;
}

export interface RunAnschreibenOptions {
  jobs: Job[];
  storage: Storage;
  profile: ProfileData;
  model?: string;
  onProgress?: (i: number, total: number, title: string) => void;
  onItemDone?: (item: AnschreibenGridItem) => void;
  signal?: AbortSignal;
  // Testbare Seams: ohne Angabe der echte Browser bzw. das echte generateAnschreiben()
  // (Ollama) — Tests spritzen hier Fakes ein, um Schleife/Zähler/Abort ohne Browser
  // oder Ollama zu prüfen.
  emailFinder?: EmailFinder;
  generate?: (job: Job, storage: Storage, profile: ProfileData, options: GenerateAnschreibenOptions) => Promise<string | null>;
}

// Extrahiert aus scripts/run-anschreiben.ts, damit ui-server.ts denselben Lauf
// (ein Browser fürs Ganze statt pro Job, sequenziell mit 1s Pause zwischen Jobs)
// wiederverwenden kann statt ihn zu duplizieren.
export async function runAnschreiben(options: RunAnschreibenOptions): Promise<AnschreibenOutcome> {
  const {
    jobs, storage, profile, model = config.modelWriter, onProgress, onItemDone, signal,
    generate = generateAnschreiben,
  } = options;
  let generated = 0;
  let emailsFound = 0;
  let mailGenerated = 0;
  let processed = 0;

  const emailFinder = options.emailFinder ?? await createBrowserEmailFinder();

  try {
    for (let i = 0; i < jobs.length; i++) {
      // Vor jedem neuen Job prüfen statt nur den Fetch abzubrechen — sonst würde der
      // Stop-Klick den laufenden Job zwar sofort beenden, aber brav mit dem nächsten
      // weitermachen.
      if (signal?.aborted) break;
      const job = jobs[i];
      processed++;
      onProgress?.(i, jobs.length, job.title);
      const path = await generate(job, storage, profile, { model, signal });
      if (path) {
        generated++;
        let hasMail = job.email != null;

        if (!hasMail && !signal?.aborted) {
          const email = await emailFinder.find(job).catch(() => null);
          if (email) {
            await storage.update(job.id, { email });
            emailsFound++;
            hasMail = true;
          }
        }

        if (hasMail) mailGenerated++;

        // Grobe Länge statt exakter Tokenzahl (die kennt nur Ollama) — Wortzahl aus der
        // gerade gespeicherten Datei reicht für die Tooltip-Kurzinfo.
        const wordCount = (await readFile(path, 'utf8').catch(() => '')).trim().split(/\s+/).filter(Boolean).length;
        onItemDone?.({
          id: job.id,
          tooltip: `${job.title} — ${job.company} — ${model} — ~${wordCount} Wörter — gespeichert`,
          state: 'done',
        });
      } else {
        onItemDone?.({ id: job.id, tooltip: `${job.title} — ${job.company} — fehlgeschlagen`, state: 'error' });
      }

      if (i < jobs.length - 1 && !signal?.aborted) await sleep(1000);
    }
  } finally {
    await emailFinder.close();
  }

  return { generated, skipped: processed - generated, emailsFound, mailGenerated, nomailGenerated: generated - mailGenerated };
}
