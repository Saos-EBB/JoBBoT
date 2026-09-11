import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Storage } from '../../storage/index.ts';
import type { ProfileData } from '../../lib/profile.ts';

export interface Ctx {
  storage: Storage;
  profile: ProfileData;
}

// Ein Routenmodul meldet per Rückgabewert, ob es die Anfrage bedient hat (Response
// bereits geschrieben) — sonst probiert der Dispatcher in ui-server.ts das nächste
// Modul. Kein Registrieren von Pfad-Patterns nötig, jedes Modul prüft selbst.
export type RouteHandler = (req: IncomingMessage, res: ServerResponse, url: URL, ctx: Ctx) => Promise<boolean>;
