import { createStorage } from '../storage/index.ts';
import { loadSources } from '../lib/sources.ts';
import { createAggregateProgress } from '../lib/progress.ts';
import { runScrape } from '../lib/scrape-runner.ts';
import { buildScrapeSetup } from '../lib/scrape-setup.ts';

const { registry, keep } = buildScrapeSetup();

const sourceArg = process.argv.find(a => a.startsWith('--source='))?.split('=')[1];
const ALIASES: Record<string, string> = { karriere: 'karriere.at', devjobs: 'devjobs.at', linkedin: 'linkedin', ams: 'ams', jobs: 'jobs.at' };

let selectedKeys: string[];
if (sourceArg) {
  const key = ALIASES[sourceArg] ?? sourceArg;
  if (!registry[key]) {
    console.error(`Unbekannte Quelle: "${sourceArg}". Gültig: ${Object.keys(ALIASES).join(', ')}`);
    process.exit(1);
  }
  selectedKeys = [key];
} else {
  selectedKeys = Object.keys(registry);
}

const sources = loadSources();
const storage = createStorage();

const activeNames = selectedKeys.filter(name => {
  if (!sources[name]?.enabled) { console.log(`[${name}] deaktiviert — übersprungen`); return false; }
  return true;
});

if (activeNames.length === 0) {
  console.log('Keine aktive Quelle.');
  process.exit(0);
}

const prog = createAggregateProgress(activeNames);
const outcomes = await runScrape({
  names: activeNames,
  registry,
  queriesFor: name => sources[name].queries,
  keep,
  storage,
  onProgress: (name, current, total) => prog.report(name, current, total),
});
prog.stop();

let newTotal = 0, skipTotal = 0;
for (const o of outcomes) {
  if (!o.ok) { console.log(`✗ ${o.name}: Fehler — ${o.error}`); continue; }
  console.log(`✓ ${o.name}: ${o.newCount} neu, ${o.skipCount} dedup`);
  newTotal += o.newCount; skipTotal += o.skipCount;
}

console.log(`\nGesamt: ${newTotal} neu, ${skipTotal} dedup.`);
