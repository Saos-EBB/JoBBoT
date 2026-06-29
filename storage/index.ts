import type { Job, JobStatus } from '../scrapers/interface.ts';
import { JsonStore } from './json-store.ts';

export interface Storage {
  exists(id: string): Promise<boolean>;
  save(job: Job): Promise<void>;
  get(id: string): Promise<Job | null>;
  list(filter?: { status?: JobStatus }): Promise<Job[]>;
  update(id: string, patch: Partial<Job>): Promise<Job>;
  updateStatus(id: string, status: JobStatus): Promise<Job>;
  delete(id: string): Promise<void>;
}

export function createStorage(baseDir?: string): Storage {
  return new JsonStore(baseDir);
}
