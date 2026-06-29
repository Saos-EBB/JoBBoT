export function slugify(text: string): string {
  let s = text.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length > 40) s = s.slice(0, 40).replace(/-+$/, '');
  return s;
}

export function jobBasename(job: {
  title: string;
  company: string;
  postedAt?: string | null;
  scrapedAt: string;
  id: string;
}): string {
  const dateStr = (job.postedAt ?? job.scrapedAt).slice(0, 10);
  return `${slugify(job.title)}_${slugify(job.company)}_${dateStr}_${job.id.slice(0, 8)}`;
}
