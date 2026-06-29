import { mkdir, readdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Job, JobStatus } from '../scrapers/interface.ts';
import type { Storage } from './index.ts';
import { jobBasename } from '../lib/slugify.ts';
import { config } from '../config.ts';

export class JsonStore implements Storage {
  constructor(private dir: string = config.dataDir) {}

  private getFilename(job: Job): string {
    return `${jobBasename(job)}.json`;
  }

  private async findFile(id: string): Promise<string | null> {
    try {
      const files = await readdir(this.dir);
      const match = files.find(f => f.endsWith(`_${id.slice(0, 8)}.json`));
      return match ? join(this.dir, match) : null;
    } catch {
      return null;
    }
  }

  async exists(id: string): Promise<boolean> {
    return (await this.findFile(id)) !== null;
  }

  async save(job: Job): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const target = join(this.dir, this.getFilename(job));
    const tmp = join(this.dir, `.tmp-${randomBytes(6).toString('hex')}.json`);
    await writeFile(tmp, JSON.stringify(job, null, 2), 'utf8');
    await rename(tmp, target);
  }

  async get(id: string): Promise<Job | null> {
    const path = await this.findFile(id);
    if (!path) return null;
    try {
      return JSON.parse(await readFile(path, 'utf8')) as Job;
    } catch {
      return null;
    }
  }

  async list(filter?: { status?: JobStatus }): Promise<Job[]> {
    await mkdir(this.dir, { recursive: true });
    // ponytail: !startsWith('.') skips .tmp-* and .gitkeep, avoiding corrupt-file warnings
    const files = (await readdir(this.dir)).filter(f => f.endsWith('.json') && !f.startsWith('.'));
    const jobs: Job[] = [];
    for (const f of files) {
      try {
        const job = JSON.parse(await readFile(join(this.dir, f), 'utf8')) as Job;
        if (!filter?.status || job.status === filter.status) jobs.push(job);
      } catch {
        console.warn(`[storage] skipping corrupt file: ${f}`);
      }
    }
    return jobs;
  }

  async update(id: string, patch: Partial<Job>): Promise<Job> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`Job not found: ${id}`);
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    await this.save(updated);
    return updated;
  }

  async updateStatus(id: string, status: JobStatus): Promise<Job> {
    return this.update(id, { status });
  }

  async delete(id: string): Promise<void> {
    const path = await this.findFile(id);
    if (path) try { await unlink(path); } catch { /* already gone */ }
  }
}
