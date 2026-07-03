import { createStorage } from '../storage/index.ts';
import { toJob } from '../lib/normalize.ts';
import { readdir } from 'node:fs/promises';
import { config } from '../config.ts';
import type { ScrapedJob } from '../scrapers/interface.ts';
import { JsonStore } from '../storage/json-store.ts';

const store = createStorage();

const fake: ScrapedJob = {
  source: 'smoke-test',
  url: 'https://example.com/jobs/1',
  title: 'Senior Smoke Tester',
  company: '__test__',
  description: 'Smoke test job, will be deleted.',
};

const job = toJob(fake);
const id = job.id;

// 1. save
await store.save(job);

// 2. exists
if (!await store.exists(id)) throw new Error('exists() returned false after save');

// 3. dedup: save again, still only 1 file
await store.save(job);
const files = (await readdir(config.dataDir)).filter(f => f.endsWith(`_${id.slice(0, 8)}.json`));
if (files.length !== 1) throw new Error(`Dedup fail: ${files.length} files for same id`);

// 4. get
const fetched = await store.get(id);
if (fetched?.id !== id) throw new Error('get() returned wrong job');

// 5. updateStatus
const updated = await store.updateStatus(id, 'matched');
if (updated.status !== 'matched') throw new Error('updateStatus() failed');
if (updated.updatedAt === job.updatedAt) throw new Error('updatedAt not changed');

// 6. list filter
const matched = await store.list({ status: 'matched' });
if (!matched.some(j => j.id === id)) throw new Error('list(matched) missing job');

// cleanup
await (store as JsonStore).delete(id);
if (await store.exists(id)) throw new Error('cleanup failed');

console.log('✓ Storage smoke OK');
