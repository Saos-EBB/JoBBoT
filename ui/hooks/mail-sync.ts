import { useState } from 'react';
import type { Job } from '../../scrapers/interface.ts';
import type { CalendarEvent } from '../components/calendar.tsx';
import { HISTORY_START } from '../../lib/calendar.ts';

// patch/setDetailOpen sind Kern-State aus app.tsx (die lokale jobs-Liste bzw. die
// Detailansicht), hier nur geschrieben — dieser Hook besitzt weder die Job-Liste noch
// die Ansicht, nur die Mail-Sync-eigenen Zustände und Aktionen.
export function useMailSync(
  say: (msg: string, kind?: 'ok' | 'err') => void,
  refetchJobs: () => void,
  setCalendarEvents: (events: CalendarEvent[]) => void,
  patch: (id: string, p: { status?: Job['status']; followUps?: Job['followUps'] }) => void,
  setDetailOpen: (open: boolean) => void,
) {
  const [replyOnly, setReplyOnly] = useState(false);
  const [repliesFetching, setRepliesFetching] = useState(false);
  const [gmailSyncing, setGmailSyncing] = useState(false);
  // Eigene Auswahl statt selectedJobIds: die hängt am Ordner und wird bei jedem
  // Ordnerwechsel geleert — der Nachfass-Tab ist kein Ordner.
  const [followUpSelection, setFollowUpSelection] = useState<Set<string>>(new Set());
  const [followUpBusy, setFollowUpBusy] = useState(false);

  async function fetchReplies() {
    setRepliesFetching(true);
    try {
      const res = await fetch('/api/mail/replies/fetch', { method: 'POST' });
      const data = await res.json() as { checked?: number; matched?: number; error?: string };
      if (!res.ok) { say(`Antworten-Abruf fehlgeschlagen: ${data.error}`, 'err'); return; }
      say(`Antworten-Abruf: ${data.matched ?? 0} von ${data.checked ?? 0} Mails zugeordnet`, 'ok');
      if ((data.matched ?? 0) > 0) refetchJobs();
    } catch (err) {
      say(`Antworten-Abruf fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`, 'err');
    } finally {
      setRepliesFetching(false);
    }
  }

  // Trägt sentAt/replyReceivedAt nach, die im Job-JSON fehlen — read-only gegenüber
  // Gmail, füllt nur Lücken (siehe POST /api/gmail-sync). Läuft synchron durch zwei
  // IMAP-Ordner, kann bei großem Postfach also dauern; deshalb der Fetching-Zustand.
  async function syncGmail() {
    setGmailSyncing(true);
    try {
      const res = await fetch('/api/gmail-sync', { method: 'POST' });
      const data = await res.json() as {
        sentGescannt?: number; markiert?: number; sentGefuellt?: number; ohneJob?: number;
        replyGescannt?: number; replyGefuellt?: number; seit?: string; error?: string;
      };
      if (!res.ok) { say(`Gmail-Sync fehlgeschlagen: ${data.error}`, 'err'); return; }
      // Jede Stufe einzeln melden (gelesen → markiert → zugeordnet): ein blankes
      // "0 ergänzt" ließe offen, ob das Postfach leer war, das Label fehlt oder die
      // Zuordnung nichts fand — drei völlig verschiedene Ursachen.
      say(
        `Gmail-Sync ab ${data.seit ?? HISTORY_START}: ${data.sentGescannt ?? 0} gesendet gelesen, `
        + `${data.markiert ?? 0} als Bewerbung markiert → ${data.sentGefuellt ?? 0} Jobs verknüpft, `
        + `${data.ohneJob ?? 0} nur Mail · ${data.replyGefuellt ?? 0} Antworten`,
        'ok'
      );
      if ((data.sentGefuellt ?? 0) > 0 || (data.replyGefuellt ?? 0) > 0) {
        refetchJobs();
        fetch('/api/calendar').then(r => r.json()).then(setCalendarEvents);
      }
    } catch (err) {
      say(`Gmail-Sync fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`, 'err');
    } finally {
      setGmailSyncing(false);
    }
  }

  // Sammelaktion, ausdrücklich so gewollt: "all masse nicht alles einzeln klicken".
  // Sequentiell statt Promise.all — anders als beim Statuspatch geht hier je Job eine
  // echte IMAP/SMTP-Verbindung raus, die parallel zu Rate-Limits bei Gmail führt.
  async function runFollowUps(via: 'draft' | 'sent') {
    const ids = [...followUpSelection];
    if (ids.length === 0) return;
    setFollowUpBusy(true);
    let ok = 0;
    let letzterFehler = '';
    for (const id of ids) {
      try {
        const res = await fetch(`/api/jobs/${id}/followup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ via }),
        });
        if (!res.ok) { letzterFehler = ((await res.json()) as { error?: string }).error ?? 'Fehler'; continue; }
        const updated = (await res.json()) as { followUps?: Job['followUps'] };
        patch(id, { followUps: updated.followUps });
        ok++;
      } catch (err) {
        letzterFehler = err instanceof Error ? err.message : String(err);
      }
    }
    setFollowUpBusy(false);
    setFollowUpSelection(new Set());
    const verb = via === 'sent' ? 'gesendet' : 'als Entwurf angelegt';
    if (ok === ids.length) say(`${ok} Nachfass ${verb}`);
    else say(`${ok} von ${ids.length} ${verb} — ${letzterFehler}`, 'err');
  }

  // "Entwurf erzeugen" heißt: echten Gmail-Entwurf per IMAP anlegen
  // (POST /api/jobs/:id/draft), nicht bloß den Status umbiegen — sonst würde die UI
  // "postausgang" behaupten, ohne dass in Gmail je ein Entwurf liegt. Status kommt
  // hier von der Server-Antwort, nicht optimistisch gesetzt.
  async function createDraft(id: string, email: string) {
    const res = await fetch(`/api/jobs/${id}/draft`, { method: 'POST' });
    if (res.ok) {
      patch(id, { status: 'postausgang' });
      say(`Entwurf für ${email} erstellt`);
      setDetailOpen(false);
    } else {
      const body = await res.json().catch(() => null);
      say(body?.error ?? 'Entwurf fehlgeschlagen', 'err');
    }
  }

  // "Direkt senden" ist die zweite Gabel neben "Entwurf erzeugen": SMTP-Versand ohne
  // Zwischenstopp in Gmail-Entwürfen (POST /api/jobs/:id/send). Getrennter Button statt
  // Parameter am bestehenden, weil beide Pfade zu unterschiedlichen Status-Endpunkten
  // führen (postausgang vs. gesendet) und das im UI sichtbar zwei bewusste Aktionen
  // sind, keine Variante derselben.
  async function sendDirect(id: string) {
    const res = await fetch(`/api/jobs/${id}/send`, { method: 'POST' });
    if (res.ok) {
      patch(id, { status: 'gesendet' });
      say('Gesendet');
      setDetailOpen(false);
    } else {
      const body = await res.json().catch(() => null);
      say(body?.error ?? 'Versand fehlgeschlagen', 'err');
    }
  }

  return {
    replyOnly, setReplyOnly, repliesFetching, gmailSyncing,
    followUpSelection, setFollowUpSelection, followUpBusy,
    fetchReplies, syncGmail, runFollowUps, createDraft, sendDirect,
  };
}
