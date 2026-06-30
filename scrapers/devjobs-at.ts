import { chromium, type Page } from 'playwright';
import type { ScrapedJob, ScraperAdapter, SourceQuery } from './interface.ts';

const BASE = 'https://www.devjobs.at';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const MAX_PAGES = 20;
const DIAG_LIMIT = 3; // nur für Diagnose, später raus

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const ms = (t: number) => `${Math.round(performance.now() - t)}ms`;

export function parseSearchResults(context: unknown): ScrapedJob[] {
  try {
    const loaderData = (context as any)?.state?.loaderData;
    const route = loaderData?.['routes/jobs/$canonical'];
    const items: unknown[] = route?.activeJobs ?? [];
    const results: ScrapedJob[] = [];
    for (const item of items) {
      try {
        const model = (item as any).model;
        const title: string = model.metaJobTitle?.title ?? '';
        const company: string = model.company?.title ?? '';
        const slug: string = model.slug ?? '';
        if (!title || !company || !slug) continue;
        const from: number = model.salaryYearRangeFrom ?? 0;
        const to: number = model.salaryYearRangeTo ?? 0;
        results.push({
          source: 'devjobs.at',
          url: `${BASE}/job/${slug}`,
          title,
          company,
          location: model.metaOsmLocations?.[0]?.title ?? 'Österreich',
          description: (model.responsibilitiesExcerpt as string | null) ?? '',
          postedAt: (model.sortedAt ?? model.createdAt) as string | null,
          salary: from && to ? `${from}–${to} €/Jahr` : null,
        });
      } catch { /* skip malformed item */ }
    }
    return results;
  } catch {
    return [];
  }
}

export function parseDetailResult(context: unknown, baseJob: ScrapedJob): ScrapedJob {
  try {
    const job = (context as any)?.state?.loaderData?.['routes/job/$jobSlug']?.job;
    if (!job) return baseJob;
    const html: string | undefined = job.jobDescriptionHtml?.html;
    const postedAt: string | undefined = job.sortedAt ?? job.createdAt;
    return {
      ...baseJob,
      ...(html ? { description: html } : {}),
      ...(postedAt ? { postedAt } : {}),
    };
  } catch {
    return baseJob;
  }
}

async function waitForState(page: Page, timeoutMs = 15_000): Promise<unknown> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await page.evaluate(
      () => (window as any).__reactRouterContext?.state ?? null
    );
    if (state != null) return page.evaluate(() => (window as any).__reactRouterContext);
    await new Promise<void>(r => setTimeout(r, 200));
  }
  throw new Error('devjobs.at: __reactRouterContext.state timeout');
}

export async function fetchRemixContext(url: string, label = 'fetch'): Promise<unknown> {
  const tTotal = performance.now();

  const tLaunch = performance.now();
  const browser = await chromium.launch({ headless: true });
  console.log(`[timing] browser-launch [${label}]: ${ms(tLaunch)}`);

  try {
    const tCtx = performance.now();
    const ctx = await browser.newContext({ userAgent: UA });
    const page = await ctx.newPage();
    console.log(`[timing] context-create [${label}]: ${ms(tCtx)}`);

    const tGoto = performance.now();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    console.log(`[timing] goto-networkidle [${label}]: ${ms(tGoto)}`);

    const tPoll = performance.now();
    let pollIters = 0;
    const start = Date.now();
    let rrc: unknown = null;
    while (Date.now() - start < 15_000) {
      pollIters++;
      const state = await page.evaluate(
        () => (window as any).__reactRouterContext?.state ?? null
      );
      if (state != null) {
        const tExtract = performance.now();
        rrc = await page.evaluate(() => (window as any).__reactRouterContext);
        console.log(`[timing] extract [${label}]: ${ms(tExtract)}`);
        break;
      }
      await new Promise<void>(r => setTimeout(r, 200));
    }
    if (rrc == null) throw new Error('devjobs.at: __reactRouterContext.state timeout');
    console.log(`[timing] poll-state [${label}]: ${ms(tPoll)} (${pollIters} iter)`);

    return rrc;
  } finally {
    const tClose = performance.now();
    await browser.close();
    console.log(`[timing] browser-close [${label}]: ${ms(tClose)}`);
    console.log(`[timing] total-fetch [${label}]: ${ms(tTotal)}`);
  }
}

export const devJobsAtAdapter: ScraperAdapter = {
  name: 'devjobs.at',
  async scrape(queries: SourceQuery[], onProgress?: (msg: string) => void) {
    const baseJobs: ScrapedJob[] = [];
    for (const query of queries) {
      const qstring = query.params ?? 'jobLevel=junior-job-level';
      const baseUrl = `${BASE}/jobs/search?${qstring}`;
      onProgress?.(`devjobs.at — Seite 1 laden...`);
      baseJobs.push(...parseSearchResults(await fetchRemixContext(baseUrl, 'search-p1')));
      // DIAG: nur Seite 1 — Pagination-Schleife für Mess-Lauf deaktiviert
    }
    const total = baseJobs.length;
    const results: ScrapedJob[] = [];
    const diagLimit = Math.min(total, DIAG_LIMIT); // nur für Diagnose, später raus
    for (let i = 0; i < diagLimit; i++) {
      const job = baseJobs[i];
      const tDelay = performance.now();
      await delay(2000);
      console.log(`[timing] delay [detail-${i + 1}]: ${ms(tDelay)}`);
      onProgress?.(`devjobs.at — Detail ${i + 1}/${total}: ${job.title.slice(0, 40)}`);
      const tJob = performance.now();
      try {
        results.push(parseDetailResult(await fetchRemixContext(job.url, `detail-${i + 1}`), job));
      } catch (err) {
        console.warn(`[devjobs.at] detail fehlgeschlagen: ${job.url}`, err);
        results.push(job);
      }
      console.log(`[timing] job-total [${i + 1}/${total}]: ${ms(tJob)}`);
    }
    return results;
  },
};
