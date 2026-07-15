import type { Page } from 'playwright';

const OBFUSCATIONS: Array<[RegExp, string]> = [
  [/\s*\(at\)\s*|\s*\[at\]\s*/gi, '@'],
  [/\s+at\s+/gi, '@'],
  [/\s*\(dot\)\s*|\s*\[dot\]\s*/gi, '.'],
  [/\s+dot\s+/gi, '.'],
];

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

export function extractFromDescription(description: string): string | null {
  let text = description;
  for (const [pattern, replacement] of OBFUSCATIONS) text = text.replace(pattern, replacement);
  return text.match(EMAIL_RE)?.[0] ?? null;
}

// ponytail: strip common AT-legal-form suffixes + non-alphanumerics, nothing fancier —
// good enough to tell "CELUM GmbH" apart from "Handshake Handels GesmbH"
const LEGAL_FORM_RE = /\b(gmbh|ag|kg|e\.?u\.?|co|group|holding|beteiligungs|engineering)\b/g;

export function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/ges\.?\s*m\.?\s*b\.?\s*h\.?/g, 'gmbh')
    .replace(LEGAL_FORM_RE, '')
    .replace(/[^a-z0-9]/g, '');
}

export function isMatch(scraped: string, candidate: string): boolean {
  const a = normalize(scraped);
  const b = normalize(candidate);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

const FIRMENABC_DETAIL_RE = /firmenabc\.at\/[a-z0-9-]+_[A-Za-z0-9]+$/;
const MAX_CANDIDATES = 15;

// firmenabc.at's search needs real form interaction (cookie banner + submit) —
// a hand-built ?sword=... URL returns 0 results (missing TYPO3 session state).
export async function findViaFirmenabc(page: Page, company: string): Promise<string | null> {
  await page.goto('https://www.firmenabc.at/', { waitUntil: 'domcontentloaded', timeout: 20_000 });
  const necessaryBtn = page.locator('#CybotCookiebotDialogBodyLevelButtonNecessary');
  if (await necessaryBtn.first().isVisible().catch(() => false)) {
    await necessaryBtn.first().click().catch(() => {});
  }
  await page.fill('#whatSearchField', company);
  await page.locator('#whatSearchField').press('Enter');
  await page.waitForTimeout(2500);

  const candidates = await page.locator('a').evaluateAll((as, re) =>
    as.filter(a => new RegExp(re).test((a as HTMLAnchorElement).href))
      .map(a => ({ href: (a as HTMLAnchorElement).href, text: a.textContent?.trim() ?? '' })),
  FIRMENABC_DETAIL_RE.source);

  const seen = new Set<string>();
  const uniq = candidates.filter(c => !seen.has(c.href) && seen.add(c.href)).slice(0, MAX_CANDIDATES);
  const match = uniq.find(c => isMatch(company, c.text));
  if (!match) return null;

  await page.goto(match.href, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForTimeout(1500);
  const mailto = await page.locator('a[href^="mailto:"]').evaluateAll(
    as => as.map(a => (a as HTMLAnchorElement).href.replace('mailto:', '')),
  );
  return mailto[0] ?? null;
}

export interface FindEmailJob {
  company: string;
  description: string;
}

// Description regex first (free, no browser), firmenabc.at fallback second (needs a
// Playwright page — caller passes one shared instance across a whole batch run).
export async function findEmail(job: FindEmailJob, page: Page): Promise<string | null> {
  const fromDescription = extractFromDescription(job.description);
  if (fromDescription) return fromDescription;
  return findViaFirmenabc(page, job.company);
}

export const FIRMENABC_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
