import { fetchPage, sleep } from '../lib/fetch-page.ts';
import type { ScrapedJob, ScraperAdapter, SourceQuery } from './interface.ts';

const BASE = 'https://www.karriere.at';
const DIAG_LIMIT = 3; // nur für Diagnose, später raus

const ms = (t: number) => `${Math.round(performance.now() - t)}ms`;

// ponytail: indexOf + trim reicht — script-block hat genau eine Zuweisung, kein Brace-Balancing nötig
function extractVueState(html: string): unknown {
  const idx = html.indexOf('window.VUE_INITIAL_STATE');
  if (idx === -1) return null;
  const end = html.indexOf('</script>', idx);
  if (end === -1) return null;
  const json = html.slice(idx, end).trim()
    .replace(/^window\.VUE_INITIAL_STATE\s*=\s*/, '')
    .replace(/;\s*$/, '');
  try { return JSON.parse(json); } catch { return null; }
}

export function parseSearchPage(html: string): ScrapedJob[] {
  try {
    const state = extractVueState(html) as Record<string, unknown> | null;
    const rawItems = (state?.jobsSearchList as any)?.activeItems?.items ?? [];
    return (rawItems as unknown[]).flatMap((item: unknown) => {
      const j = (item as any)?.jobsItem;
      if (!j?.title || !j?.link) return [];
      const url: string = j.link.startsWith('http') ? j.link : `${BASE}${j.link}`;
      return [{
        source: 'karriere.at',
        url,
        title: j.title as string,
        company: (j.company?.name as string) ?? '',
        location: (j.locations?.[0]?.name ?? j.company?.mainLocation) as string | undefined,
        description: (j.snippet as string | null) ?? '',
        salary: (j.salary as string | null) ?? null,
        postedAt: null,
      } satisfies ScrapedJob];
    });
  } catch {
    return [];
  }
}

export function parseDetailPage(html: string, baseJob: ScrapedJob): ScrapedJob {
  try {
    const blocks = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)];
    for (const [, raw] of blocks) {
      const ld = JSON.parse(raw.trim()) as { '@type'?: string; description?: string; datePosted?: string };
      if (ld['@type'] !== 'JobPosting') continue;
      return {
        ...baseJob,
        ...(ld.description ? { description: ld.description } : {}),
        ...(ld.datePosted ? { postedAt: ld.datePosted } : {}),
      };
    }
  } catch { /* fall through */ }
  return baseJob;
}

async function fetchSearchPage(keyword: string): Promise<string> {
  const slug = (s: string) => s.toLowerCase().replace(/\s+/g, '-');
  const r = await fetchPage(`${BASE}/jobs/${slug(keyword)}`);
  if (!r.ok) throw new Error(`karriere.at search ${r.status}: ${keyword}`);
  return r.html;
}

async function fetchDetailPage(url: string): Promise<string> {
  await sleep(2000);
  const r = await fetchPage(url);
  if (!r.ok) throw new Error(`karriere.at detail ${r.status}: ${url}`);
  return r.html;
}

export const karriereAtAdapter: ScraperAdapter = {
  name: 'karriere.at',
  async scrape(queries: SourceQuery[], onProgress?: (msg: string) => void) {
    const byUrl = new Map<string, ScrapedJob>();

    // DIAG: nur erstes Keyword — Schleife für Mess-Lauf begrenzt
    const diagQueries = queries.slice(0, 1); // nur für Diagnose, später raus
    for (const query of diagQueries) {
      const keyword = query.keyword ?? '';
      if (!keyword) continue;
      try {
        onProgress?.(`karriere.at — ${keyword} suchen...`);
        const tSearch = performance.now();
        const searchHtml = await fetchSearchPage(keyword);
        const jobs = parseSearchPage(searchHtml);
        console.log(`[timing] search-fetch [${keyword}]: ${ms(tSearch)} → ${jobs.length} Jobs`);
        for (const job of jobs) {
          if (!byUrl.has(job.url)) byUrl.set(job.url, job);
        }
      } catch (err) {
        console.warn(`[karriere.at] search fehlgeschlagen: ${keyword}`, err);
      }
    }

    const total = byUrl.size;
    let i = 0;
    const results: ScrapedJob[] = [];
    const jobs = [...byUrl.values()];
    const diagLimit = Math.min(total, DIAG_LIMIT); // nur für Diagnose, später raus
    for (let j = 0; j < diagLimit; j++) {
      const job = jobs[j];
      i++;
      onProgress?.(`karriere.at — Detail ${i}/${total}: ${job.title.slice(0, 40)}`);
      const tDetail = performance.now();
      try {
        // fetchDetailPage enthält den 2s sleep — timing zeigt delay+fetch zusammen
        results.push(parseDetailPage(await fetchDetailPage(job.url), job));
        console.log(`[timing] detail-fetch [${i}/${total}]: ${ms(tDetail)} (inkl. 2s delay)`);
      } catch (err) {
        console.warn(`[karriere.at] detail fehlgeschlagen: ${job.url}`, err);
        console.log(`[timing] detail-fetch [${i}/${total}] FEHLER: ${ms(tDetail)}`);
        results.push(job);
      }
    }
    return results;
  },
};
