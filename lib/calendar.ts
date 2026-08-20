// Gemeinsamer Startpunkt für Gmail-Sync und Kalender: der Sync liest den Gesendet-
// Ordner ab hier, und der Kalender zeigt ab demselben Monat — sonst scannt der Sync
// einen Zeitraum, den die Ansicht gar nicht darstellt (oder umgekehrt).
//
// Bewusst eine feste Konstante statt einer env-Variable: der Wert markiert den Beginn
// der Bewerbungsphase, nicht eine Einstellung, die pro Umgebung anders sein müsste.
// Absichtlich hier und nicht in config.ts — diese Datei wird auch ins Browser-Bundle
// gezogen, und config.ts liest process.env.
export const HISTORY_START = '2026-07-01';

// Alle Monate von `von` bis `bis` einschließlich, als 'YYYY-MM', neuester zuerst.
// Lücken werden aufgefüllt: ein Monat ohne Aktivität ist im Kalender eine leere
// Zeile, kein übersprungener Block — sonst rücken weit auseinanderliegende Monate
// direkt untereinander und täuschen Nachbarschaft vor.
export function monthsDescending(von: string, bis: string): string[] {
  const [vonJahr, vonMonat] = von.slice(0, 7).split('-').map(Number);
  const [bisJahr, bisMonat] = bis.slice(0, 7).split('-').map(Number);
  const monate: string[] = [];
  for (let j = vonJahr, m = vonMonat; j * 12 + m <= bisJahr * 12 + bisMonat; m === 12 ? (j++, m = 1) : m++) {
    monate.push(`${j}-${String(m).padStart(2, '0')}`);
  }
  return monate.reverse();
}
