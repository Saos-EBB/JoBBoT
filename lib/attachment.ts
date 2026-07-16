import { join } from 'node:path';
import { config } from '../config.ts';

// Ein einziger Anhang, fester Name, überschrieben bei jedem Upload (siehe
// docs/SESSION-LOG-anhang.md und die Scope-Entscheidung im Prompt: kein Dateimanagement,
// keine Pro-Job-Auswahl). Eine Konstante statt zwei Kopien (Upload-Endpoint + Mail-Versand),
// die sonst unbemerkt auseinanderlaufen könnten.
export const ATTACHMENT_PATH = join(config.attachmentsDir, 'lebenslauf.pdf');
export const ATTACHMENT_FILENAME = 'Lebenslauf.pdf';
