import { chromium, type Page } from 'playwright';
import type { ScrapedJob, ScraperAdapter, SourceQuery } from './interface.ts';

const BASE = 'https://www.devjobs.at';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const MAX_PAGES = 20;
// State-Poll-Fenster nach domcontentloaded: die Remix-Hydration kann auf langsamer
// Hardware (oder unter Scheduler-Last neben anderen Adaptern) länger brauchen als
// die ursprünglichen 15s. Leicht änderbar, falls das nochmal nicht reicht.
const STATE_TIMEOUT_MS = 45_000;
// Bekannte Remix-Context-Globals, älteste zuerst. Der Key ist schon mal umbenannt
// worden — die Poll-Schleife scannt zusätzlich generisch nach jedem window["__*"]
// mit .state.loaderData, übersteht also auch einen erneuten Rename.
const KNOWN_STATE_KEYS = ['__reactRouterContext', '__remixContext'];

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

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

// Findet den ersten window["__*"]-Global mit .state.loaderData — bekannte Keys
// zuerst (schnellerer Treffer im Normalfall), dann generischer Scan als Fallback.
async function findStateKey(page: Page, knownKeys: string[]): Promise<string | null> {
  return page.evaluate((keys: string[]) => {
    const hasLoaderData = (v: unknown): boolean =>
      typeof v === 'object' && v !== null && (v as any).state?.loaderData != null;
    for (const k of keys) {
      if (hasLoaderData((window as any)[k])) return k;
    }
    for (const k of Object.keys(window)) {
      if (!k.startsWith('__')) continue;
      if (hasLoaderData((window as any)[k])) return k;
    }
    return null;
  }, knownKeys);
}

// Diagnose-Dump statt blindem Timeout-Fehler: zeigt beim nächsten Fail sofort, ob
// sich der Context-Key erneut geändert hat (→ Key in KNOWN_STATE_KEYS ergänzen)
// oder ob es reines Timing war (→ STATE_TIMEOUT_MS weiter hoch).
async function diagnoseTimeout(page: Page): Promise<void> {
  try {
    const title = await page.title();
    const globals = await page.evaluate(() => Object.keys(window).filter(k => k.startsWith('__')));
    const reactRouterExists = await page.evaluate(() => (window as any).__reactRouterContext !== undefined);
    const reactRouterHasState = await page.evaluate(() => (window as any).__reactRouterContext?.state !== undefined);
    console.warn(
      `[devjobs.at] State-Timeout Diagnose: title="${title}", __-Globals=${JSON.stringify(globals)}, ` +
      `__reactRouterContext vorhanden=${reactRouterExists}, .state vorhanden=${reactRouterHasState}`
    );
  } catch (err) {
    console.warn('[devjobs.at] Diagnose-Dump fehlgeschlagen', err);
  }
}

async function waitForState(page: Page, timeoutMs = STATE_TIMEOUT_MS): Promise<unknown> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const key = await findStateKey(page, KNOWN_STATE_KEYS);
    if (key) return page.evaluate((k: string) => (window as any)[k], key);
    await new Promise<void>(r => setTimeout(r, 200));
  }
  await diagnoseTimeout(page);
  throw new Error('devjobs.at: kein Kontext mit .state.loaderData gefunden (Timeout)');
}

export async function fetchRemixContext(url: string): Promise<unknown> {
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ userAgent: UA });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    return await waitForState(page);
  } finally {
    await browser.close();
  }
}

export const devJobsAtAdapter: ScraperAdapter = {
  name: 'devjobs.at',
  kind: 'browser',
  async scrape(queries: SourceQuery[], keep?: (job: ScrapedJob) => boolean, onProgress?: (current: number, total: number) => void) {
    const baseJobs: ScrapedJob[] = [];
    for (const query of queries) {
      const qstring = query.params ?? 'jobLevel=junior-job-level';
      const baseUrl = `${BASE}/jobs/search?${qstring}`;
      onProgress?.(1, 1);
      const firstCtx = await fetchRemixContext(baseUrl);
      const totalPages = Math.min(
        (firstCtx as any)?.state?.loaderData?.['routes/jobs/$canonical']?.totalPages ?? 1,
        MAX_PAGES
      );
      baseJobs.push(...parseSearchResults(firstCtx));
      for (let page = 2; page <= totalPages; page++) {
        await delay(2000);
        onProgress?.(page, totalPages);
        baseJobs.push(...parseSearchResults(await fetchRemixContext(`${baseUrl}&page=${page}`)));
      }
    }
    const candidates = keep ? baseJobs.filter(keep) : baseJobs;
    console.log(`[devjobs.at] ${baseJobs.length} Treffer, ${candidates.length} nach Location-Gate`);
    const total = candidates.length;
    const results: ScrapedJob[] = [];
    for (let i = 0; i < total; i++) {
      const job = candidates[i];
      await delay(2000);
      onProgress?.(i + 1, total);
      try {
        results.push(parseDetailResult(await fetchRemixContext(job.url), job));
      } catch (err) {
        console.warn(`[devjobs.at] detail fehlgeschlagen: ${job.url}`, err);
        results.push(job);
      }
    }
    return results;
  },
};
