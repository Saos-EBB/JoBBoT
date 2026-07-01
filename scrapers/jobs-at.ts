import type { ScrapedJob } from './interface.ts';

const BASE = 'https://www.jobs.at';

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
  return fallback;
}
