import type { Anhang } from '../lib/attachment.ts';

// Der Seam zwischen "was verschickt wird" und "wie es rausgeht".
//
// Vorher steckte der Trockenlauf als `if (config.mailDryRun)` MITTEN im Transport —
// ein zweiter Adapter, getarnt als Verzweigung. Damit war er weder für sich testbar
// noch war sichtbar, dass es zwei Wege gibt. Jetzt sind es zwei Adapter an einem Seam,
// und die Auswahl trifft eine Stelle (siehe lib/versand.ts).

// Die fertige Nachricht: alles, was zum Zustellen nötig ist, und nichts, was der
// Transport selbst noch nachschlagen müsste. cc und attachments legt der Aufrufer bei
// (lib/versand.ts) — sonst müsste jeder Adapter dieselben zwei Dateien lesen und die
// beiden könnten auseinanderlaufen.
export interface ComposedEmail {
  to: string;
  subject: string;
  text: string;
  cc?: string | null;
  attachments?: Anhang[];
}

export interface MailTransport {
  name: string;
  entwurf(email: ComposedEmail): Promise<void>;
  sende(email: ComposedEmail): Promise<void>;
}

function zeile(art: 'draft' | 'send', email: ComposedEmail): string {
  const anhang = email.attachments?.length ? ` (Anhang: ${email.attachments[0].filename})` : '';
  const cc = email.cc ? ` (CC: ${email.cc})` : '';
  return `[MAIL_DRY_RUN] ${art} → ${email.to} — ${email.subject}${anhang}${cc}`;
}

// Zustellung, die nichts zustellt — für MAIL_DRY_RUN und für Tests. Die Ausgabe ist
// wörtlich dieselbe wie vorher aus createDraft/sendMail, damit ein Trockenlauf im
// Terminal unverändert aussieht.
export const trockenTransport: MailTransport = {
  name: 'trocken',
  async entwurf(email) { console.log(zeile('draft', email)); },
  async sende(email) { console.log(zeile('send', email)); },
};
