import { useEffect, useState } from 'react';

type AttachmentMeta = { filename: string; size: number; uploadedAt: string };

// active = ob der Attachment-Tab gerade sichtbar ist (siehe view-State in app.tsx) —
// der Fetch beim Betreten der Ansicht ist die einzige Kopplung nach außen, neben say().
export function useAttachment(active: boolean, say: (msg: string, kind?: 'ok' | 'err') => void) {
  const [attachment, setAttachment] = useState<AttachmentMeta | null | undefined>(undefined);

  useEffect(() => {
    if (!active) return;
    fetch('/api/attachment')
      .then(r => (r.ok ? r.json() : null))
      .then(setAttachment);
  }, [active]);

  async function uploadAttachment(file: File) {
    const res = await fetch('/api/attachment', { method: 'POST', body: file });
    const body = await res.json().catch(() => null);
    if (res.ok) { setAttachment(body); say('Anhang hochgeladen'); }
    else say(body?.error ?? 'Upload fehlgeschlagen', 'err');
  }

  async function removeAttachment() {
    await fetch('/api/attachment', { method: 'DELETE' });
    setAttachment(null);
    say('Anhang entfernt');
  }

  return { attachment, uploadAttachment, removeAttachment };
}
