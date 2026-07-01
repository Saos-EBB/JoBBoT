import { sleep } from '../lib/fetch-page.ts';
import { slugify } from '../lib/slugify.ts';
import type { ScrapedJob, ScraperAdapter, SourceQuery } from './interface.ts';

const BASE = 'https://www.jobs.at';
const UA = 'Mozilla/5.0 (compatible; JobBot/0.1; +local)';

export function parseSearchPage(html: string): Partial<ScrapedJob>[] {
  if (!html) return [];
  const cards = html.split(/<li\s*\n?\s*data-job="/).slice(1);
  const seen = new Set<string>();
  const results: Partial<ScrapedJob>[] = [];

  for (const card of cards) {
    const idMatch = card.match(/^(\d+)"/);
    const titleMatch = card.match(/data-c-title="([^"]+)"/);
    if (!idMatch || !titleMatch) continue;

    const url = `${BASE}/i/${idMatch[1]}`;
    if (seen.has(url)) continue;
    seen.add(url);

    const companyMatch = card.match(/data-gtm-element-detail="([^"]+)"/);

    // eine Karte kann mehrere Orts-Links haben ("Lieboch, Österreich") — alle einsammeln
    const locBlock = card.match(/data-job-location[^>]*>([\s\S]*?)<\/ul>/);
    const locations = locBlock
      ? [...locBlock[1].matchAll(/js-locationLink[^>]*>([^<]+)<\/a>/g)].map(m => m[1].trim())
      : [];

    results.push({
      source: 'jobs.at',
      url,
      title: titleMatch[1],
      company: companyMatch?.[1],
      location: locations.length ? locations.join(', ') : undefined,
    });
  }
  return results;
}

interface JsonLdJobPosting {
  '@type'?: string;
  title?: string;
  datePosted?: string;
  description?: string;
  hiringOrganization?: { name?: string };
  jobLocation?: { address?: { addressLocality?: string; addressRegion?: string } };
  identifier?: { value?: number | string };
}

export function parseDetailPage(html: string, base: Partial<ScrapedJob>): ScrapedJob {
  const fallback: ScrapedJob = {
    source: 'jobs.at',
    url: base.url ?? '',
    title: base.title ?? '',
    company: base.company ?? '',
    location: base.location,
    description: '',
  };
  if (!html) return fallback;

  const blocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, raw] of blocks) {
    let ld: JsonLdJobPosting;
    try {
      ld = JSON.parse(raw.trim()) as JsonLdJobPosting;
    } catch {
      continue;
    }
    if (ld['@type'] !== 'JobPosting') continue;

    const address = ld.jobLocation?.address;
    const location = [address?.addressLocality, address?.addressRegion].filter(Boolean).join(', ') || 'Österreich';
    const id = ld.identifier?.value;

    return {
      source: 'jobs.at',
      url: id != null ? `${BASE}/i/${id}` : (base.url ?? ''),
      title: ld.title ?? base.title ?? '',
      company: ld.hiringOrganization?.name ?? base.company ?? '',
      location,
      description: ld.description ?? '',
      postedAt: ld.datePosted ?? null,
    };
  }

  // Kein JSON-LD gefunden — in der Praxis der häufigere Fall, nicht die Ausnahme (nur
  // ein Teil der Inserate hat strukturierte Daten). Tier-(d)-Fallback: Beschreibung aus
  // dem plain-HTML-Artikel holen statt sie leer zu lassen.
  const descMatch = html.match(/<article class="c-job-detail-text"[^>]*>([\s\S]*?)<\/article>/);
  if (descMatch) {
    return { ...fallback, description: descMatch[1].trim() };
  }
  return fallback;
}

// STEP 2a: ?q=<keyword> wird beim 302-Redirect verworfen (verifiziert — java/frontend
// lieferten identische Ergebnisse, Cookies egal). Funktionierender Weg: pfadbasiert
// /j/{keyword-slug}, kein Session-Handling nötig.
async function fetchJobsAt(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': UA, 'Accept-Language': 'de-AT,de;q=0.9' },
    });
    if (!res.ok) throw new Error(`jobs.at ${res.status}: ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSearchPage(keyword: string): Promise<string> {
  return fetchJobsAt(`${BASE}/j/${slugify(keyword)}`);
}

async function fetchDetailPage(url: string): Promise<string> {
  await sleep(2000);
  return fetchJobsAt(url);
}

export const jobsAtAdapter: ScraperAdapter = {
  name: 'jobs.at',
  async scrape(queries: SourceQuery[], keep?: (job: ScrapedJob) => boolean, onProgress?: (current: number, total: number) => void) {
    const byUrl = new Map<string, ScrapedJob>();

    for (let qi = 0; qi < queries.length; qi++) {
      const query = queries[qi];
      const keyword = query.keyword ?? '';
      if (!keyword) continue;

      try {
        onProgress?.(qi + 1, queries.length);
        const cards = parseSearchPage(await fetchSearchPage(keyword));

        // STEP 2b: Ort ist in der Karte vorhanden → Gate hier, vor dem Detail-Fetch (wie devjobs.at)
        const candidates = keep
          ? cards.filter(c => keep({ ...c, description: c.description ?? '' } as ScrapedJob))
          : cards;
        console.log(`jobs.at '${keyword}': ${cards.length} Karten, ${candidates.length} nach Gate`);

        for (let di = 0; di < candidates.length; di++) {
          const card = candidates[di];
          if (!card.url || byUrl.has(card.url)) continue;
          onProgress?.(di + 1, candidates.length);
          try {
            const job = parseDetailPage(await fetchDetailPage(card.url), card);
            byUrl.set(card.url, job);
          } catch (err) {
            console.warn(`[jobs.at] detail fehlgeschlagen: ${card.url}`, err);
            byUrl.set(card.url, {
              source: 'jobs.at',
              url: card.url,
              title: card.title ?? '',
              company: card.company ?? '',
              location: card.location,
              description: '',
            });
          }
        }
      } catch (err) {
        console.warn(`[jobs.at] search fehlgeschlagen: ${keyword}`, err);
      }
    }

    return [...byUrl.values()];
  },
};
