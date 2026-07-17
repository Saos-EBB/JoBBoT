import { chromium } from 'playwright';
import type { Job } from '../scrapers/interface.ts';
import type { Storage } from '../storage/index.ts';
import type { ProfileData } from './profile.ts';
import { generateAnschreiben } from './anschreiben.ts';
import { findEmail, FIRMENABC_USER_AGENT } from './find-email.ts';
import { sleep } from './fetch-page.ts';
import { config } from '../config.ts';

export interface AnschreibenOutcome {
  generated: number;
  skipped: number;
  emailsFound: number;
}

export interface RunAnschreibenOptions {
  jobs: Job[];
  storage: Storage;
  profile: ProfileData;
  model?: string;
  onProgress?: (i: number, total: number, title: string) => void;
}

// Extrahiert aus scripts/run-anschreiben.ts, damit ui-server.ts denselben Lauf
// (ein Browser fürs Ganze statt pro Job, sequenziell mit 1s Pause zwischen Jobs)
// wiederverwenden kann statt ihn zu duplizieren.
export async function runAnschreiben(options: RunAnschreibenOptions): Promise<AnschreibenOutcome> {
  const { jobs, storage, profile, model = config.modelWriter, onProgress } = options;
  let generated = 0;
  let emailsFound = 0;

  const browser = await chromium.launch({ headless: true });
  const emailPage = await browser.newPage({ userAgent: FIRMENABC_USER_AGENT });

  try {
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      onProgress?.(i, jobs.length, job.title);
      const path = await generateAnschreiben(job, storage, profile, undefined, undefined, model);
      if (path) generated++;

      if (path && !job.email) {
        const email = await findEmail(job, emailPage).catch(() => null);
        if (email) {
          await storage.update(job.id, { email });
          emailsFound++;
        }
      }

      if (i < jobs.length - 1) await sleep(1000);
    }
  } finally {
    await browser.close();
  }

  return { generated, skipped: jobs.length - generated, emailsFound };
}
