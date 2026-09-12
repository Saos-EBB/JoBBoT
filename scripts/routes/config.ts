import type { IncomingMessage, ServerResponse } from 'node:http';
import { adapterRegistry } from '../../lib/scrape-setup.ts';
import { isConfigName, readConfig, writeConfig, restoreConfig, hasBackup, validateConfig } from '../../lib/config-store.ts';
import { isScrapeRunning } from './scrape.ts';
import { respondJson, readJsonBody } from './http.ts';

export async function handleConfigRoutes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  // Das querySchema jedes Portals, damit die Einstellungsseite ihr Formular daraus bauen
  // kann. Kommt aus der Registry, nicht aus config/sources.json — der Code sagt, welche
  // Portale es gibt und welche Felder sie kennen (siehe Ticket "Schema pro Portal").
  if (req.method === 'GET' && url.pathname === '/api/config/schema') {
    respondJson(res, 200, Object.fromEntries(Object.entries(adapterRegistry).map(([name, a]) => [name, a.querySchema])));
    return true;
  }

  // Config-Endpunkte fuer die Einstellungsseite. Ein GET/PUT je Datei statt eines
  // Sammel-Endpunkts: die beiden Dateien haben getrennte Bedeutung, und ein PUT, das
  // beide schreibt, schriebe auch, was niemand angefasst hat.
  const configMatch = url.pathname.match(/^\/api\/config\/([a-z]+)$/);
  if (configMatch && (req.method === 'GET' || req.method === 'PUT')) {
    const name = configMatch[1];
    if (!isConfigName(name)) { res.writeHead(404).end('Unbekannte Konfiguration'); return true; }

    if (req.method === 'GET') {
      respondJson(res, 200, { data: await readConfig(name), hasBackup: await hasBackup(name) });
      return true;
    }

    let data: unknown;
    try {
      data = await readJsonBody<unknown>(req);
    } catch (err) {
      respondJson(res, 400, { errors: [`Kein gültiges JSON: ${err instanceof Error ? err.message : String(err)}`] });
      return true;
    }
    const errors = validateConfig(name, data);
    if (errors.length > 0) {
      respondJson(res, 422, { errors });
      return true;
    }
    await writeConfig(name, data);
    // scrapeRun.status mitschicken: loadSources() liest pro Nutzung frisch, ein
    // laufender Scrape sieht die Aenderung also mitten drin. Gesperrt wird nicht (der
    // Schaden ist eine Anfrage mehr oder weniger), aber die Seite soll es sagen koennen.
    respondJson(res, 200, { ok: true, scrapeRunning: isScrapeRunning() });
    return true;
  }

  const restoreMatch = url.pathname.match(/^\/api\/config\/([a-z]+)\/restore$/);
  if (req.method === 'POST' && restoreMatch) {
    const name = restoreMatch[1];
    if (!isConfigName(name)) { res.writeHead(404).end('Unbekannte Konfiguration'); return true; }
    const restored = await restoreConfig(name);
    respondJson(res, restored ? 200 : 404, restored ? { ok: true, data: await readConfig(name) } : { error: 'Keine gesicherte Fassung vorhanden' });
    return true;
  }

  return false;
}
