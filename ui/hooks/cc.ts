import { useEffect, useState } from 'react';

// active = ob der CC-Tab gerade sichtbar ist (siehe view-State in app.tsx). ccInput ist
// der Formular-Entwurf vor dem Speichern, cc der zuletzt gespeicherte Stand — getrennt,
// weil ein Tippfehler im Feld nicht sofort den gespeicherten Wert überschreiben soll.
export function useCcAddress(active: boolean, say: (msg: string, kind?: 'ok' | 'err') => void) {
  const [cc, setCc] = useState<string | null | undefined>(undefined);
  const [ccInput, setCcInput] = useState('');

  useEffect(() => {
    if (!active) return;
    fetch('/api/cc')
      .then(r => r.json())
      .then((d: { email: string | null }) => { setCc(d.email); setCcInput(d.email ?? ''); });
  }, [active]);

  async function saveCcNow(email: string) {
    const res = await fetch('/api/cc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const body = await res.json().catch(() => null);
    if (res.ok) { setCc(body.email); say('CC gespeichert'); }
    else say(body?.error ?? 'Speichern fehlgeschlagen', 'err');
  }

  async function removeCc() {
    await fetch('/api/cc', { method: 'DELETE' });
    setCc(null);
    setCcInput('');
    say('CC entfernt');
  }

  return { cc, ccInput, setCcInput, saveCcNow, removeCc };
}
