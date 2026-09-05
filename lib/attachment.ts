import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../config.ts';

// Ein einziger Anhang, fester Name, überschrieben bei jedem Upload (siehe
// docs/SESSION-LOG-anhang.md und die Scope-Entscheidung im Prompt: kein Dateimanagement,
// keine Pro-Job-Auswahl). Eine Konstante statt zwei Kopien (Upload-Endpoint + Mail-Versand),
// die sonst unbemerkt auseinanderlaufen könnten.
export const ATTACHMENT_PATH = join(config.attachmentsDir, 'lebenslauf.pdf');
export const ATTACHMENT_FILENAME = 'Lebenslauf.pdf';

export interface Anhang { filename: string; path: string }

// Der Anhang ist optional, nicht Pflicht: "kein Lebenslauf hochgeladen" ist ein gültiger,
// alltäglicher Zustand (siehe /api/attachment, GET liefert dafür regulär 404) — eine Mail
// darf deswegen nie fehlschlagen. Wer das später zur Pflicht macht, sollte das bewusst
// entscheiden, nicht als Nebeneffekt eines Refactors hier.
//
// Steht hier statt in mail/gmail.ts, weil beide Transporte ihn brauchen (der echte hängt
// ihn an, der Trockenlauf nennt ihn) und keiner von beiden ihn selbst suchen soll.
export async function anhangWennVorhanden(): Promise<Anhang[]> {
  try {
    await stat(ATTACHMENT_PATH);
    return [{ filename: ATTACHMENT_FILENAME, path: ATTACHMENT_PATH }];
  } catch {
    return [];
  }
}
