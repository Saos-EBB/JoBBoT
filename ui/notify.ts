// Desktop-Benachrichtigung, wenn ein Arbeitsschritt fertig ist. Bewusst nur, wenn der
// Tab NICHT sichtbar ist — ist er sichtbar, sieht der Nutzer ohnehin den Toast, eine
// zweite Meldung wäre Lärm. No-op ohne erteilte Erlaubnis und im Test-Runner (dort gibt
// es weder Notification noch document — die typeof-Checks fangen das ab).

// Erlaubnis beim ersten Lauf-Start anfragen (ein echter Klick = User-Geste, die manche
// Browser für requestPermission verlangen).
export function ensureNotifyPermission(): void {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') Notification.requestPermission().catch(() => {});
}

export function notify(title: string, body: string): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (typeof document !== 'undefined' && !document.hidden) return; // Tab sichtbar → Toast reicht
  try {
    new Notification(title, { body });
  } catch {
    /* manche Browser werfen ohne Service-Worker — dann eben keine Benachrichtigung */
  }
}
