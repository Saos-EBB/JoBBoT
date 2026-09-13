import { sleep } from '../lib/fetch-page.ts';
import { searchSlug } from '../lib/slugify.ts';
import { usableQueries } from '../lib/query-schema.ts';
import { normalizeDescription } from '../lib/normalize-description.ts';
import { createBatcher } from '../lib/grid-batch.ts';
import { finalizeResults } from '../lib/finalize-results.ts';
import type { ScrapedJob, ScraperAdapter, SourceQuery } from './interface.ts';

const BASE = 'https://www.jobs.at';
const UA = 'Mozilla/5.0 (compatible; JobBot/0.1; +local)';
const GRID_BATCH_SIZE = 10;

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
      description: normalizeDescription(ld.description ?? ''),
      postedAt: ld.datePosted ?? null,
    };
  }

  // Kein JSON-LD gefunden — in der Praxis der häufigere Fall, nicht die Ausnahme (nur
  // ein Teil der Inserate hat strukturierte Daten). Tier-(d)-Fallback: Beschreibung aus
  // dem plain-HTML-Artikel holen statt sie leer zu lassen.
  const descMatch = html.match(/<article class="c-job-detail-text"[^>]*>([\s\S]*?)<\/article>/);
  if (descMatch) {
    return { ...fallback, description: normalizeDescription(descMatch[1].trim()) };
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
  return fetchJobsAt(`${BASE}/j/${searchSlug(keyword)}`);
}

async function fetchDetailPage(url: string): Promise<string> {
  await sleep(2000);
  return fetchJobsAt(url);
}

export const jobsAtAdapter: ScraperAdapter = {
  name: 'jobs.at',
  kind: 'fetch',
  querySchema: [
    { key: 'keyword', label: 'Suchbegriff', required: true, format: 'slug', placeholder: 'java-entwickler' },
  ],
  async scrape(
    queries: SourceQuery[],
    keep?: (job: ScrapedJob) => boolean,
    onProgress?: (current: number, total: number) => void,
    onUnitDone?: (items: ScrapedJob[]) => void,
  ) {
    // Zweiphasig wie karriere-at.ts: erst alle Suchseiten einsammeln, dann einmal
    // dedup/gate/log (finalizeResults — dedup VOR Gate, vorher war's hier vertauscht),
    // erst danach Detail-Fetches. Der URL-Dedup übernimmt zugleich, was vorher `byUrl`
    // während des Detail-Fetches leistete: eine bereits gesehene URL taucht in den
    // `candidates` gar nicht zweimal auf.
    const found: Partial<ScrapedJob>[] = [];
    const usable = usableQueries(jobsAtAdapter, queries);
    for (let qi = 0; qi < usable.length; qi++) {
      const keyword = usable[qi].keyword;
      try {
        onProgress?.(qi + 1, usable.length);
        found.push(...parseSearchPage(await fetchSearchPage(keyword)));
      } catch (err) {
        console.warn(`[jobs.at] search fehlgeschlagen: ${keyword}`, err);
      }
    }

    const candidates = finalizeResults(
      'jobs.at',
      found.map(c => ({ ...c, description: c.description ?? '' }) as ScrapedJob),
      keep,
    );

    const total = candidates.length;
    const results: ScrapedJob[] = [];
    const batcher = createBatcher(GRID_BATCH_SIZE, onUnitDone);
    for (let i = 0; i < total; i++) {
      const card = candidates[i];
      onProgress?.(i + 1, total);
      let job = card;
      try {
        job = parseDetailPage(await fetchDetailPage(card.url), card);
      } catch (err) {
        console.warn(`[jobs.at] detail fehlgeschlagen: ${card.url}`, err);
      }
      results.push(job);
      batcher.push(job);
    }
    batcher.flush();
    return results;
  },
};
