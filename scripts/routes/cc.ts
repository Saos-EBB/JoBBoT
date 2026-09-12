import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadCc, saveCc, clearCc } from '../../lib/cc.ts';
import { respondJson, readJsonBody } from './http.ts';

export async function handleCcRoutes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method === 'GET' && url.pathname === '/api/cc') {
    respondJson(res, 200, { email: await loadCc() });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/cc') {
    let email = '';
    try {
      email = (await readJsonBody<{ email?: string }>(req)).email?.trim() ?? '';
    } catch {
      // leer bleiben — unten als "fehlt" behandelt
    }
    if (!email) {
      respondJson(res, 400, { error: 'E-Mail-Adresse fehlt' });
      return true;
    }
    await saveCc(email);
    respondJson(res, 200, { email });
    return true;
  }

  if (req.method === 'DELETE' && url.pathname === '/api/cc') {
    await clearCc();
    res.writeHead(204).end();
    return true;
  }

  return false;
}
