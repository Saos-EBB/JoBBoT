import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createStorage } from '../storage/index.ts';
import { loadProfile } from '../lib/profile.ts';
import type { Ctx, RouteHandler } from './routes/context.ts';
import { handleJobsRoutes } from './routes/jobs.ts';
import { handleCalendarRoutes } from './routes/calendar.ts';
import { handleAttachmentRoutes } from './routes/attachment.ts';
import { handleCcRoutes } from './routes/cc.ts';
import { handleConfigRoutes } from './routes/config.ts';
import { handleDuplicatesRoutes } from './routes/duplicates.ts';
import { handleScrapeRoutes } from './routes/scrape.ts';
import { handleFilterRoutes } from './routes/filter.ts';
import { handleAnschreibenRoutes } from './routes/anschreiben.ts';
import { handleGmailRoutes } from './routes/gmail.ts';

function portFromArgs(): string | undefined {
  const flag = process.argv.find(a => a === '--port' || a.startsWith('--port='));
  if (!flag) return undefined;
  if (flag.includes('=')) return flag.split('=')[1];
  return process.argv[process.argv.indexOf(flag) + 1];
}

const PORT = Number(portFromArgs() ?? process.env.UI_PORT ?? 3000);
const ctx: Ctx = { storage: createStorage(), profile: loadProfile() };

// Whitelist statt generischem File-Server — ui-server.ts liefert sonst nur die
// eine hartkodierte /app.js-Route (aus ui/dist/), kein Static-Handler existiert
// bereits (siehe docs/architecture.md, Tschobbo-Entscheidung 2). Feste Pfade,
// kein Verzeichnis-Traversal möglich.
const TSCHOBBO_ASSETS = new Map<string, { path: string; type: string }>([
  ['/tschobbo-sheet.png', { path: join(import.meta.dirname, '..', 'ui', 'tschobbo-sheet.png'), type: 'image/png' }],
  ['/tschobbo-blobs.png', { path: join(import.meta.dirname, '..', 'ui', 'tschobbo-blobs.png'), type: 'image/png' }],
  ['/tschobbo.js', { path: join(import.meta.dirname, '..', 'ui', 'tschobbo.js'), type: 'text/javascript; charset=utf-8' }],
]);

// Ressourcen-Routenmodule (scripts/routes/*.ts), der Reihe nach probiert — jedes meldet
// per Rückgabewert, ob es die Anfrage bedient hat. Statische Routen (Index-HTML,
// Tschobbo-Assets, app.js) bleiben hier im Dispatcher, weil sie keine eigene Domäne sind.
const routeHandlers: RouteHandler[] = [
  handleJobsRoutes,
  handleCalendarRoutes,
  handleAttachmentRoutes,
  handleCcRoutes,
  handleConfigRoutes,
  handleDuplicatesRoutes,
  handleScrapeRoutes,
  handleFilterRoutes,
  handleAnschreibenRoutes,
  handleGmailRoutes,
];

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><meta charset="utf-8"><title>JoBBoT</title></head>'
      + '<body><div id="root"></div><script type="module" src="/app.js"></script>'
      + '<script type="module" src="/tschobbo.js"></script></body></html>');
    return;
  }

  if (req.method === 'GET' && TSCHOBBO_ASSETS.has(url.pathname)) {
    const asset = TSCHOBBO_ASSETS.get(url.pathname)!;
    try {
      const data = await readFile(asset.path);
      res.writeHead(200, { 'Content-Type': asset.type });
      res.end(data);
    } catch {
      res.writeHead(404).end();
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/app.js') {
    try {
      const js = await readFile(join(import.meta.dirname, '..', 'ui', 'dist', 'app.js'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      res.end(js);
    } catch {
      res.writeHead(404).end('app.js nicht gebaut — npm run build:ui');
    }
    return;
  }

  for (const handle of routeHandlers) {
    if (await handle(req, res, url, ctx)) return;
  }

  res.writeHead(404).end('Not found');
});

server.listen(PORT, () => console.log(`JobBot UI: http://localhost:${PORT}`));
