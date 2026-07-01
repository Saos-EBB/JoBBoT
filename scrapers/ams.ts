import { chromium, type Page } from 'playwright';
import type { ScrapedJob, ScraperAdapter, SourceQuery } from './interface.ts';

const BASE = 'https://jobs.ams.at/public/emps';
const MAX_PAGES = 10;
const JOB_OFFER_TYPES = ['SB_WKO', 'IJ', 'BA', 'BZ', 'TN'];

export interface AmsSearchResult {
  id: number;
  lastUpdatedAt?: string;
  title: string;
  summary?: string;
  company?: {
    name?: string;
    address?: { municipality?: string; federalState?: string };
  };
}

export interface AmsSearchResponse {
  results?: AmsSearchResult[];
  totalPages?: number;
}

export function parseAmsResult(r: AmsSearchResult): ScrapedJob {
  return {
    source: 'ams',
    url: `${BASE}/jobs/${r.id}`,
    title: r.title,
    company: r.company?.name ?? '',
    location: r.company?.address?.municipality || r.company?.address?.federalState || 'Österreich',
    description: r.summary ?? '',
    postedAt: r.lastUpdatedAt ?? null,
  };
}

// AMS needs an internal locationId (not the free-text city name) to filter by location —
// resolved via the same autocomplete endpoint the site's own search box uses. That call has
// to run inside the page (not a bare fetch), otherwise the API returns 401 UNAUTHORIZED.
// Only towns/municipalities resolve here, not federal states (e.g. "Oberösterreich" finds
// nothing useful) — use a city + vicinity radius instead.
async function resolveLocationId(page: Page, locationText: string): Promise<string | null> {
  await page.goto(`${BASE}/jobs`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  const suggestion: { locationId: string } | null = await page.evaluate(async (text) => {
    const res = await fetch(`/public/emps/api/suggestions/location?text=${encodeURIComponent(text)}&pageSize=1`);
    if (!res.ok) return null;
    const data = await res.json();
    return data[0] ?? null;
  }, locationText);
  return suggestion?.locationId ?? null;
}

function buildSearchUrl(keyword: string, page: number, locationParam: string): string {
  const types = JOB_OFFER_TYPES.map(t => `JOB_OFFER_TYPE=${t}`).join('&');
  return `${BASE}/jobs?sortField=_SCORE&sortOrder=desc&query=${encodeURIComponent(keyword)}&page=${page}${locationParam}&${types}`;
}

async function fetchSearchPage(page: Page, keyword: string, pageNum: number, locationParam: string): Promise<AmsSearchResponse> {
  const url = buildSearchUrl(keyword, pageNum, locationParam);
  const [response] = await Promise.all([
    page.waitForResponse(res => res.url().includes('/api/search') && res.status() === 200, { timeout: 20_000 }),
    page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 }),
  ]);
  return response.json();
}

export const amsAdapter: ScraperAdapter = {
  name: 'ams',
  async scrape(queries: SourceQuery[], keep?: (job: ScrapedJob) => boolean, onProgress?: (current: number, total: number) => void) {
    const byUrl = new Map<string, ScrapedJob>();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      for (const query of queries) {
        const keyword = query.keyword ?? '';
        if (!keyword) continue;

        let locationParam = '';
        if (query.location) {
          const locationId = await resolveLocationId(page, query.location);
          if (locationId) {
            locationParam = `&location=${encodeURIComponent(query.location)}&locationId=${locationId}&vicinity=${query.vicinity ?? '20'}`;
          } else {
            console.warn(`[ams] Ort "${query.location}" nicht gefunden, Filter ignoriert`);
          }
        }

        try {
          onProgress?.(1, 1);
          const first = await fetchSearchPage(page, keyword, 1, locationParam);
          for (const r of first.results ?? []) {
            const job = parseAmsResult(r);
            if (!byUrl.has(job.url)) byUrl.set(job.url, job);
          }
          const totalPages = Math.min(first.totalPages ?? 1, MAX_PAGES);
          for (let p = 2; p <= totalPages; p++) {
            onProgress?.(p, totalPages);
            const res = await fetchSearchPage(page, keyword, p, locationParam);
            for (const r of res.results ?? []) {
              const job = parseAmsResult(r);
              if (!byUrl.has(job.url)) byUrl.set(job.url, job);
            }
          }
        } catch (err) {
          console.warn(`[ams] search fehlgeschlagen: ${keyword}`, err);
        }
      }
    } finally {
      await browser.close();
    }

    const allJobs = [...byUrl.values()];
    const candidates = keep ? allJobs.filter(keep) : allJobs;
    console.log(`[ams] ${allJobs.length} Treffer, ${candidates.length} nach Location-Gate`);
    return candidates;
  },
};
