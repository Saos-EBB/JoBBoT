import { execFile } from 'node:child_process';

// OS-Desktop-Benachrichtigung vom SERVER aus — sichtbar, egal ob der Browser-Tab im
// Vordergrund, im Hintergrund oder ganz geschlossen ist. Anders als die Browser-
// Notification-API (nur aktiv, solange die Seite offen ist) läuft der Lauf im
// Server-Prozess weiter, auch wenn man den Browser zumacht; die Meldung kommt trotzdem.
//
// Best-effort: auf Linux via notify-send (libnotify). Auf anderen Plattformen oder wenn
// notify-send fehlt, passiert schlicht nichts — kein Fehler, kein Absturz.
export function desktopNotify(title: string, body: string): void {
  if (process.platform !== 'linux') return;
  execFile('notify-send', ['--app-name=JoBBoT', title, body], () => {
    /* notify-send nicht installiert oder Fehler → ignorieren */
  });
}
