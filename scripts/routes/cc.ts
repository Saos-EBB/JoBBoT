import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadCc, saveCc, clearCc } from '../../lib/cc.ts';

export async function handleCcRoutes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method === 'GET' && url.pathname === '/api/cc') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ email: await loadCc() }));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/cc') {
    let body = '';
    for await (const chunk of req) body += chunk;
    let email = '';
    try {
      email = (JSON.parse(body) as { email?: string }).email?.trim() ?? '';
    } catch {
      // leer bleiben — unten als "fehlt" behandelt
    }
    if (!email) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'E-Mail-Adresse fehlt' }));
      return true;
    }
    await saveCc(email);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ email }));
    return true;
  }

  if (req.method === 'DELETE' && url.pathname === '/api/cc') {
    await clearCc();
    res.writeHead(204).end();
    return true;
  }

  return false;
}
