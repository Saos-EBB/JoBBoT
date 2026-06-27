import { createHash } from 'node:crypto';

export function jobId(j: { title: string; company: string }): string {
  const key = `${j.title}|${j.company}`.trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}
