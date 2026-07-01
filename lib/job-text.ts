import type { Job } from '../scrapers/interface.ts';

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
};

export function stripHtml(html: string): string {
  const noTags = html.replace(/<[^>]*>/g, ' ');
  const decoded = noTags.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&apos;|&nbsp;/g, m => ENTITIES[m]);
  return decoded.replace(/\s+/g, ' ').trim();
}

const REQUIREMENT_HEADINGS = [
  'anforderung', 'qualifikation', 'was du mitbringst', 'dein profil',
  'wen wir suchen', 'das bringst du mit', 'requirements', 'your profile',
  'deine skills', 'voraussetzung',
];

export function extractRequirements(description: string): string {
  const lower = description.toLowerCase();
  let cut = -1;
  for (const heading of REQUIREMENT_HEADINGS) {
    const idx = lower.indexOf(heading);
    if (idx !== -1 && (cut === -1 || idx < cut)) cut = idx;
  }
  const start = cut === -1 ? 0 : cut;
  return description.slice(start, start + 800);
}

export function buildStageInput(job: Job): string {
  const requirements = extractRequirements(stripHtml(job.description));
  return `Titel: ${job.title}
Firma: ${job.company}
Ort: ${job.location ?? ''}
Anforderungen:
${requirements}`;
}
