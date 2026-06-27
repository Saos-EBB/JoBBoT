import { fetchPage, sleep } from '../lib/fetch-page.ts';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const FIXTURE_DIR = 'test/fixtures/karriere-at';
await mkdir(FIXTURE_DIR, { recursive: true });

// ── 1. robots.txt ────────────────────────────────────────────────────────────
console.log('\n=== robots.txt ===');
const robots = await fetchPage('https://www.karriere.at/robots.txt');
if (!robots.ok) { console.error('robots.txt nicht abrufbar:', robots.status); process.exit(1); }

const disallowed = robots.html.split('\n').filter(l => l.startsWith('Disallow:'));
const jobsDisallowed = disallowed.some(l => /^Disallow:\s*\/jobs($|\/)/i.test(l.trim()));
console.log('Relevante Disallow-Zeilen:');
disallowed.forEach(l => console.log(' ', l.trim()));

if (jobsDisallowed) {
  console.error('\n⛔ /jobs ist in robots.txt explizit disallowed — STOP.');
  process.exit(1);
}
console.log('\n✓ /jobs nicht explizit disallowed — dürfen weitermachen.');
await sleep(2000);

// ── 2. Suche — funktionierende URL ermitteln ─────────────────────────────────
console.log('\n=== Suche: Junior Developer in Linz ===');
const candidates = [
  'https://www.karriere.at/jobs/junior-developer/linz',
  'https://www.karriere.at/jobs?keywords=Junior%20Developer&locations=Linz',
  'https://www.karriere.at/jobs/junior-developer',
];

let searchUrl = '';
let searchHtml = '';

for (const url of candidates) {
  console.log(`Probiere: ${url}`);
  const r = await fetchPage(url);
  console.log(`  → Status ${r.status}, HTML-Länge ${r.html.length}`);
  if (r.ok && r.html.length > 5000) {
    searchUrl = url;
    searchHtml = r.html;
    console.log(`  ✓ Verwende diese URL.`);
    break;
  }
  await sleep(2000);
}

if (!searchUrl) { console.error('Keine funktionierende Such-URL gefunden.'); process.exit(1); }

await writeFile(join(FIXTURE_DIR, 'search.html'), searchHtml, 'utf8');
console.log(`\n✓ search.html gespeichert (${searchHtml.length} Bytes)`);
await sleep(2000);

// ── 3. Datenquellen prüfen ───────────────────────────────────────────────────
console.log('\n=== Datenquellen auf Suchergebnisseite ===');

// 3a. JSON-LD
const ldMatches = [...searchHtml.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
console.log(`\nJSON-LD Blöcke: ${ldMatches.length}`);
for (const [, raw] of ldMatches) {
  try {
    const obj = JSON.parse(raw) as { '@type'?: string; itemListElement?: unknown[] };
    console.log(`  @type: ${obj['@type']}, itemListElement count: ${Array.isArray(obj.itemListElement) ? obj.itemListElement.length : 'n/a'}`);
  } catch { console.log('  (parse-Fehler)'); }
}

// 3b. __NEXT_DATA__
const nextMatch = searchHtml.match(/<script id="__NEXT_DATA__"[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/i);
if (nextMatch) {
  console.log('\n__NEXT_DATA__ gefunden!');
  try {
    const nd = JSON.parse(nextMatch[1]) as Record<string, unknown>;
    const pp = (nd?.props as Record<string, unknown>)?.pageProps;
    console.log('  pageProps keys:', pp ? Object.keys(pp as object).join(', ') : 'n/a');
  } catch { console.log('  (parse-Fehler)'); }
} else {
  console.log('\n__NEXT_DATA__: nicht gefunden');
}

// 3c. API/XHR-Endpoints im HTML/JS
const apiHints = [...new Set([
  ...[...searchHtml.matchAll(/["'](\/api\/[^"'?]+)/g)].map(m => m[1]),
  ...[...searchHtml.matchAll(/["'](\/graphql[^"'?]*)/g)].map(m => m[1]),
  ...[...searchHtml.matchAll(/["'](https:\/\/[^"']*\/api\/[^"'?]+)/g)].map(m => m[1]),
])].slice(0, 10);
console.log('\nAPI-Endpunkte im HTML:', apiHints.length ? apiHints.join('\n  ') : 'keine');

// 3d. Wiederholende HTML-Karten
const articleCount = (searchHtml.match(/<article/gi) ?? []).length;
const liJobCount   = (searchHtml.match(/class="[^"]*job[^"]*"/gi) ?? []).length;
console.log(`\nHTML-Karten: <article>: ${articleCount}, class=*job*: ${liJobCount}`);

await sleep(2000);

// ── 4. Detail-Seite ──────────────────────────────────────────────────────────
console.log('\n=== Detail-Seite ===');

// Erste Job-URL aus der Suchergebnisseite extrahieren
const jobUrlMatch = searchHtml.match(/href="(https:\/\/www\.karriere\.at\/jobs\/[^"]+\/\d+)"/) ??
                    searchHtml.match(/href="(\/jobs\/[^"]+\/\d+)"/);

let detailUrl = '';
if (jobUrlMatch) {
  detailUrl = jobUrlMatch[1].startsWith('http') ? jobUrlMatch[1] : `https://www.karriere.at${jobUrlMatch[1]}`;
  console.log(`Detail-URL: ${detailUrl}`);
  const dr = await fetchPage(detailUrl);
  console.log(`Status: ${dr.status}, HTML-Länge: ${dr.html.length}`);
  if (dr.ok) {
    await writeFile(join(FIXTURE_DIR, 'detail.html'), dr.html, 'utf8');
    console.log(`✓ detail.html gespeichert (${dr.html.length} Bytes)`);

    const dldMatches = [...dr.html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    console.log(`\nJSON-LD auf Detail-Seite: ${dldMatches.length} Blöcke`);
    for (const [, raw] of dldMatches) {
      try {
        const obj = JSON.parse(raw) as { '@type'?: string; title?: string; hiringOrganization?: { name?: string }; datePosted?: string };
        console.log(`  @type: ${obj['@type']}`);
        if (obj['@type'] === 'JobPosting') {
          console.log(`  title: ${obj.title}`);
          console.log(`  hiringOrganization.name: ${obj.hiringOrganization?.name}`);
          console.log(`  datePosted: ${obj.datePosted}`);
        }
      } catch { console.log('  (parse-Fehler)'); }
    }
  }
} else {
  console.log('Keine Job-Detail-URL in den Suchergebnissen gefunden.');
}

console.log('\n=== RECON abgeschlossen ===');
console.log('Fixtures in:', FIXTURE_DIR);
