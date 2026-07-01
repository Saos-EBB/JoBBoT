import { fetchPage, sleep } from '../lib/fetch-page.ts';
import type { ScrapedJob, ScraperAdapter, SourceQuery } from './interface.ts';

const SEARCH_BASE = 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search';
const PAGES = [0, 25, 50];

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
}

export function parseSearchResults(html: string): ScrapedJob[] {
  if (!html) return [];
  const cards = html.split('<li>').slice(1);
  const results: ScrapedJob[] = [];
  for (const card of cards) {
    const urlMatch = card.match(/class="base-card__full-link[^"]*"[^>]*href="([^"]+)"/);
    const titleMatch = card.match(/<h3 class="base-search-card__title">\s*([\s\S]*?)\s*<\/h3>/);
    const companyMatch = card.match(/<h4 class="base-search-card__subtitle">[\s\S]*?>\s*([^<]+?)\s*<\/a>/);
    const locationMatch = card.match(/<span class="job-search-card__location">\s*([^<]+?)\s*<\/span>/);
    const dateMatch = card.match(/<time class="job-search-card__listdate"[^>]*datetime="([^"]+)"/);
    if (!urlMatch || !titleMatch || !companyMatch) continue;
    results.push({
      source: 'linkedin',
      url: decodeEntities(urlMatch[1]).split('?')[0],
      title: decodeEntities(titleMatch[1].trim()),
      company: decodeEntities(companyMatch[1].trim()),
      location: locationMatch ? decodeEntities(locationMatch[1].trim()) : undefined,
      description: '',
      postedAt: dateMatch ? dateMatch[1] : null,
    });
  }
  return results;
}

export function parseDetailPage(html: string, baseJob: ScrapedJob): ScrapedJob {
  if (!html) return baseJob;
  const match = html.match(/show-more-less-html__markup[^>]*>([\s\S]*?)<button/);
  if (!match) return baseJob;
  return { ...baseJob, description: match[1].trim() };
}

async function fetchSearchPage(keyword: string, location: string, start: number): Promise<string> {
  const url = `${SEARCH_BASE}?keywords=${encodeURIComponent(keyword)}&location=${encodeURIComponent(location)}&start=${start}`;
  const r = await fetchPage(url);
  if (!r.ok) throw new Error(`linkedin search ${r.status}: ${keyword}`);
  return r.html;
}

async function fetchDetailPage(url: string): Promise<string> {
  await sleep(2000);
  const r = await fetchPage(url);
  if (!r.ok) throw new Error(`linkedin detail ${r.status}: ${url}`);
  return r.html;
}

export const linkedinAdapter: ScraperAdapter = {
  name: 'linkedin',
  async scrape(queries: SourceQuery[], keep?: (job: ScrapedJob) => boolean, onProgress?: (current: number, total: number) => void) {
    const byUrl = new Map<string, ScrapedJob>();
    for (const query of queries) {
      const keyword = query.keyword ?? '';
      const location = query.location ?? 'Österreich';
      if (!keyword) continue;
      for (let pi = 0; pi < PAGES.length; pi++) {
        const start = PAGES[pi];
        try {
          onProgress?.(pi + 1, PAGES.length);
          const html = await fetchSearchPage(keyword, location, start);
          for (const job of parseSearchResults(html)) {
            if (!byUrl.has(job.url)) byUrl.set(job.url, job);
          }
        } catch (err) {
          console.warn(`[linkedin] search fehlgeschlagen: ${keyword}@${start}`, err);
        }
        await sleep(1000);
      }
    }
    const allJobs = [...byUrl.values()];
    const candidates = keep ? allJobs.filter(keep) : allJobs;
    console.log(`[linkedin] ${allJobs.length} Treffer, ${candidates.length} nach Location-Gate`);
    const total = candidates.length;
    const results: ScrapedJob[] = [];
    for (let i = 0; i < total; i++) {
      const job = candidates[i];
      onProgress?.(i + 1, total);
      try {
        results.push(parseDetailPage(await fetchDetailPage(job.url), job));
      } catch (err) {
        console.warn(`[linkedin] detail fehlgeschlagen: ${job.url}`, err);
        results.push(job);
      }
    }
    return results;
  },
};
