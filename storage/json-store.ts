import { mkdir, readdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Job, JobStatus } from '../scrapers/interface.ts';
import type { Storage } from './index.ts';
import { jobBasename } from '../lib/slugify.ts';
import { config } from '../config.ts';

// Sortierte Unterordner für die beiden Filter-Ergebnisse. Alle anderen Status
// (new, filtered_out, generated, reviewed, drafted, sent) bleiben im Basisordner
// — nur explizit angefragt waren "sicher" (matched) und "unsicher" (uncertain).
const STATUS_DIRS: Partial<Record<JobStatus, string>> = {
  matched: 'sicher',
  uncertain: 'unsicher',
};

export class JsonStore implements Storage {
  constructor(private dir: string = config.dataDir) {}

  private getFilename(job: Job): string {
    return `${jobBasename(job)}.json`;
  }

  private dirFor(status: JobStatus): string {
    const sub = STATUS_DIRS[status];
    return sub ? join(this.dir, sub) : this.dir;
  }

  private allDirs(): string[] {
    return [this.dir, join(this.dir, 'sicher'), join(this.dir, 'unsicher')];
  }

  private async findFile(id: string): Promise<string | null> {
    for (const dir of this.allDirs()) {
      try {
        const files = await readdir(dir);
        const match = files.find(f => f.endsWith(`_${id.slice(0, 8)}.json`));
        if (match) return join(dir, match);
      } catch {
        // Ordner existiert (noch) nicht — überspringen
      }
    }
    return null;
  }

  async exists(id: string): Promise<boolean> {
    return (await this.findFile(id)) !== null;
  }

  async save(job: Job): Promise<void> {
    const targetDir = this.dirFor(job.status);
    await mkdir(targetDir, { recursive: true });
    const target = join(targetDir, this.getFilename(job));
    const tmp = join(targetDir, `.tmp-${randomBytes(6).toString('hex')}.json`);
    await writeFile(tmp, JSON.stringify(job, null, 2), 'utf8');
    await rename(tmp, target);

    // Falls der Job vorher in einem ANDEREN Ordner lag (Statuswechsel, z.B.
    // matched → generated), die alte Datei entfernen — sonst bleibt ein
    // veraltetes Duplikat liegen. Explizit ALLE anderen Ordner prüfen statt
    // findFile() (das nur den ERSTEN Treffer liefert): sonst würde ein Treffer
    // im gerade beschriebenen Zielordner einen Treffer in einem anderen Ordner
    // verdecken.
    for (const dir of this.allDirs()) {
      if (dir === targetDir) continue;
      try {
        const files = await readdir(dir);
        const match = files.find(f => f.endsWith(`_${job.id.slice(0, 8)}.json`));
        if (match) await unlink(join(dir, match));
      } catch {
        // Ordner existiert nicht — nichts zu tun
      }
    }
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
    const jobs: Job[] = [];
    for (const dir of this.allDirs()) {
      await mkdir(dir, { recursive: true });
      // ponytail: !startsWith('.') skips .tmp-* and .gitkeep, avoiding corrupt-file warnings
      const files = (await readdir(dir)).filter(f => f.endsWith('.json') && !f.startsWith('.'));
      for (const f of files) {
        try {
          const job = JSON.parse(await readFile(join(dir, f), 'utf8')) as Job;
          if (!filter?.status || job.status === filter.status) jobs.push(job);
        } catch {
          console.warn(`[storage] skipping corrupt file: ${f}`);
        }
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
