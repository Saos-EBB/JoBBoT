import type { Job } from '../scrapers/interface.ts';
import type { Storage } from '../storage/index.ts';
import type { ProfileData } from './profile.ts';
import type { ComposedEmail, MailTransport } from '../mail/transport.ts';
import { trockenTransport } from '../mail/transport.ts';
import { composeEmail, composeFollowUp, gmailTransport, logMailAction } from '../mail/gmail.ts';
import { anhangWennVorhanden } from './attachment.ts';
import { loadCc } from './cc.ts';
import { recordFollowUp } from './followup.ts';
import { config } from '../config.ts';

// Eine Bewerbung rausschicken ist vier Schritte in fester Reihenfolge: Text bauen,
// zustellen, den Job weiterdrehen, ins Log schreiben. Vorher stand diese Folge in fünf
// Route-Handlern je einmal von Hand — und niemand prüfte, dass die fünf gleich bleiben.
//
// Die Regel, die hier an EINER Stelle wohnt:
//   Bewerbung + Entwurf  → status "postausgang", KEIN sentAt
//   Bewerbung + Senden   → status "gesendet" UND sentAt
//   Nachfass (beide Wege)→ Status bleibt, wie er ist; nur followUps wächst
//
// Der Nachfass ändert bewusst keinen Status: die Bewerbung war schon gesendet und
// bleibt es, ein Nachfass ist kein neuer Zustand, sondern ein weiterer Kontakt.

export type VersandArt = 'bewerbung' | 'nachfass';
export type VersandWeg = 'entwurf' | 'senden';

export interface VersandOptions {
  job: Job;
  art: VersandArt;
  weg: VersandWeg;
  storage: Storage;
  profile: ProfileData;
  // Ohne Angabe entscheidet MAIL_DRY_RUN. Tests reichen ihren eigenen Adapter herein.
  transport?: MailTransport;
  logPath?: string;
  now?: () => Date;
}

const AKTION = {
  'bewerbung/entwurf': 'drafted',
  'bewerbung/senden': 'sent',
  'nachfass/entwurf': 'followup-drafted',
  'nachfass/senden': 'followup-sent',
} as const;

// Die Auswahl zwischen den zwei Adaptern — die eine Stelle, die sie trifft. Vorher
// verzweigte jeder der beiden Transporte selbst auf config.mailDryRun, und der
// Trockenlauf war damit nicht als Adapter zu erkennen.
export function standardTransport(): MailTransport {
  return config.mailDryRun ? trockenTransport : gmailTransport;
}

function statusPatch(art: VersandArt, weg: VersandWeg, job: Job, jetzt: Date): Partial<Job> {
  if (art === 'nachfass') {
    return { followUps: recordFollowUp(job, weg === 'senden' ? 'sent' : 'draft', jetzt) };
  }
  if (weg === 'senden') {
    // sentAt wird hier gesetzt und nicht aus updatedAt abgeleitet: updatedAt ändert
    // sich bei jedem späteren storage.update() (z.B. wenn replyReceivedAt eintrifft)
    // und wäre danach kein verlässliches Sendedatum mehr.
    return { status: 'gesendet', sentAt: jetzt.toISOString() };
  }
  return { status: 'postausgang' };
}

export async function versende(o: VersandOptions): Promise<Job> {
  const transport = o.transport ?? standardTransport();
  const jetzt = (o.now ?? (() => new Date()))();

  const entwurfstext = o.art === 'nachfass'
    ? await composeFollowUp(o.job, o.profile)
    : await composeEmail(o.job, o.profile);

  // CC und Anhang gehören zur Nachricht, nicht zum Transport — sonst müssten beide
  // Adapter dieselben zwei Dateien lesen und könnten auseinanderlaufen.
  const nachricht: ComposedEmail = {
    ...entwurfstext,
    cc: await loadCc(),
    attachments: await anhangWennVorhanden(),
  };

  // Erst zustellen, dann den Job weiterdrehen: schlägt der Versand fehl, bleibt der
  // Job unverändert stehen und der Fehler kommt beim Aufrufer an.
  if (o.weg === 'senden') await transport.sende(nachricht);
  else await transport.entwurf(nachricht);

  const updated = await o.storage.update(o.job.id, statusPatch(o.art, o.weg, o.job, jetzt));
  await logMailAction(o.job, AKTION[`${o.art}/${o.weg}`], o.logPath);
  return updated;
}
