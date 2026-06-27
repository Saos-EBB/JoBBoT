import { config } from '../config.ts';

export async function checkOllama(host = config.ollamaHost): Promise<{ ok: boolean; found: string[]; missing: string[] }> {
  try {
    const res = await fetch(`${host}/api/tags`);
    const data = await res.json() as { models: { name: string }[] };
    const names: string[] = data.models.map(m => m.name);
    const needed = [config.modelFilter, config.modelWriter];
    const missing = needed.filter(n => !names.some(found => found.startsWith(n)));
    return { ok: missing.length === 0, found: names, missing };
  } catch {
    return { ok: false, found: [], missing: [config.modelFilter, config.modelWriter] };
  }
}
