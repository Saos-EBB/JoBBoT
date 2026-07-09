import { readdir, readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { normalizeDescription } from '../lib/normalize-description.ts';
import type { Job } from '../scrapers/interface.ts';

const JOBS_DIR = 'data/jobs';

async function findJobFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findJobFiles(full));
    } else if (entry.name.endsWith('.json')) {
      files.push(full);
    }
  }
  return files;
}

async function backup(files: string[]): Promise<string> {
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const backupRoot = join('data', `backup-${ts}`);
  for (const f of files) {
    const dest = join(backupRoot, relative('data', f));
    await mkdir(dirname(dest), { recursive: true });
    await cp(f, dest);
  }
  return backupRoot;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const files = await findJobFiles(JOBS_DIR);
  console.log(`${files.length} Job-Dateien gefunden unter ${JOBS_DIR}/`);

  if (!dryRun) {
    console.log('Backup wird erstellt...');
    const backupDir = await backup(files);
    console.log(`Backup fertig: ${backupDir}/ (${files.length} Dateien)\n`);
  }

  let changed = 0;
  let broken = 0;
  let exampleShown = false;

  for (const f of files) {
    const raw = await readFile(f, 'utf8');
    let job: Job;
    try {
      job = JSON.parse(raw) as Job;
    } catch {
      broken++;
      console.warn(`  übersprungen (kaputtes JSON): ${f}`);
      continue;
    }
    if (!job.description) continue;
    const normalized = normalizeDescription(job.description);
    if (normalized === job.description) continue;

    changed++;
    if (!exampleShown) {
      exampleShown = true;
      console.log(`--- Beispiel-Diff: ${f} ---`);
      console.log('VORHER: ', JSON.stringify(job.description.slice(0, 200)));
      console.log('NACHHER:', JSON.stringify(normalized.slice(0, 200)));
      console.log();
    }
    if (!dryRun) {
      job.description = normalized;
      await writeFile(f, JSON.stringify(job, null, 2), 'utf8');
    }
  }

  console.log(
    `${dryRun ? '[DRY RUN] ' : ''}${changed}/${files.length} Dateien ${dryRun ? 'würden geändert' : 'geändert'}` +
    (broken ? `, ${broken} übersprungen (kaputtes JSON)` : ''),
  );
}

main();
