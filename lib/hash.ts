import { createHash } from 'node:crypto';

export function jobId(j: { title: string; company: string }): string {
  const n = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  // JSON.stringify prevents separator-injection collisions (e.g. 'a|b'+'c' == 'a'+'b|c')
  return createHash('sha256').update(JSON.stringify([n(j.title), n(j.company)])).digest('hex').slice(0, 16);
}
