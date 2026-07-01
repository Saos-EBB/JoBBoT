import { chromium, type Page } from 'playwright';
import type { ScrapedJob, ScraperAdapter, SourceQuery } from './interface.ts';

const BASE = 'https://www.devjobs.at';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const MAX_PAGES = 20;

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
