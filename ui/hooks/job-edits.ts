import type { JobWithBrief } from '../app.tsx';

export function useJobEdits(say: (m: string, kind?: 'ok' | 'err') => void, patch: (id: string, p: Partial<JobWithBrief>) => void) {
  // Speichert erst beim Verlassen der Textarea (onBlur), nicht bei jedem Tastendruck —
  // blur feuert im Browser garantiert vor dem onClick eines anderen Listeneintrags
  // (mousedown blurred zuerst), also landet der letzte Stand immer beim richtigen
  // Job, auch bei schnellem Wechsel. Kein Debounce-Timer nötig, keine Race Condition.
  function saveBrief(id: string, text: string) {
    fetch(`/api/jobs/${id}/brief`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
      .then(r => { if (!r.ok) throw new Error(); say('Anschreiben gespeichert'); })
      .catch(() => say('Speichern fehlgeschlagen', 'err'));
  }

  // Die einzige Stelle, an der eine Empfängeradresse von Hand gesetzt wird. Vorher
  // konnte das nur die servergerenderte /job/:id/email-Form, die niemand mehr erreichte
  // (das UI verlinkt sie nicht) — nötig ist es trotzdem, weil findEmail() nicht immer
  // trifft und eine falsche Adresse sonst nicht zu korrigieren wäre.
  // Speichern beim Verlassen des Feldes, wie beim Anschreiben.
  function saveEmail(id: string, value: string) {
    const email = value.trim() || null;
    fetch(`/api/jobs/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
      .then(r => { if (!r.ok) throw new Error(); patch(id, { email }); say(email ? 'Adresse gespeichert' : 'Adresse entfernt'); })
      .catch(() => say('Speichern fehlgeschlagen', 'err'));
  }

  return { saveBrief, saveEmail };
}
