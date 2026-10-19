import type { Job } from '../scrapers/interface.ts';
import type { MailEvent } from './mail-events.ts';

// Bewerbungsnachweis fürs AMS: wann, wo, wie beworben und was zurückkam — als
// druckfertige HTML-Seite (GET /nachweis, im Browser "Drucken" bzw. als PDF sichern).
//
// Quellen: jeder Job mit sentAt oder Status "gesendet" (auch später gelöschte — die
// Bewerbung ist trotzdem passiert) plus die job-losen, in Gmail als Bewerbung
// gelabelten Mails aus dem Gmail-Sync (data/mail-events.json). Gesendet-Jobs ohne
// sentAt (Altbestand) stehen ohne Datum am Ende und fallen bei gesetztem Zeitraum weg.

export interface NachweisZeile {
  datum: string | null; // ISO
  firma: string;
  stelle: string;
  ort: string;
  weg: string;          // "E-Mail an …"
  quelle: string;       // Portal, leer bei job-losen Mails
  url: string;
  antwort: string;      // "Absage (12.08.2026)", "keine" …
}

export interface Zeitraum { von?: string; bis?: string } // YYYY-MM-DD, beide inklusive

const ART: Record<NonNullable<Job['replyKind']>, string> = {
  absage: 'Absage',
  zusage: 'Einladung/Zusage',
  datenschutz: 'Antwort (Datenschutz-Einwilligung angefragt)',
  plattform: 'Antwort (Bewerbung über Firmenportal angefragt)',
  eingang: 'Eingangsbestätigung',
  antwort: 'Antwort',
};

const tag = (iso: string) => iso.slice(0, 10);
// Manche Portale liefern Titel/Firma mit "&amp;" statt "&" — für den Ausdruck auflösen.
const klar = (s: string) => s.replace(/&amp;/g, '&');
export const datumDe = (iso: string) => { const [y, m, d] = tag(iso).split('-'); return `${d}.${m}.${y}`; };

function antwortText(j: Job): string {
  if (!j.replyReceivedAt && !j.replyKind) return 'keine';
  const art = j.replyKind ? ART[j.replyKind] : 'Antwort';
  return j.replyReceivedAt ? `${art} (${datumDe(j.replyReceivedAt)})` : art;
}

export function nachweisZeilen(jobs: Job[], events: MailEvent[], z: Zeitraum = {}): NachweisZeile[] {
  const zeilen: NachweisZeile[] = [
    ...jobs
      .filter(j => j.sentAt || j.status === 'gesendet')
      .map(j => ({
        datum: j.sentAt ?? null,
        firma: klar(j.company),
        stelle: klar(j.title),
        ort: j.location ?? '',
        weg: j.email ? `E-Mail an ${j.email}` : 'E-Mail',
        quelle: j.source,
        url: j.url,
        antwort: antwortText(j),
      })),
    ...events.map(e => ({
      datum: e.date, firma: klar(e.company), stelle: klar(e.title), ort: '', weg: `E-Mail an ${e.to}`, quelle: '', url: '', antwort: '—',
    })),
  ];
  const imZeitraum = (d: string | null) => {
    if (!z.von && !z.bis) return true;
    if (!d) return false;
    return (!z.von || tag(d) >= z.von) && (!z.bis || tag(d) <= z.bis);
  };
  return zeilen
    .filter(r => imZeitraum(r.datum))
    .sort((a, b) => (a.datum ?? '9999').localeCompare(b.datum ?? '9999'));
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function nachweisHtml(zeilen: NachweisZeile[], o: { name: string; zeitraum: Zeitraum; stand: Date }): string {
  const { von, bis } = o.zeitraum;
  const zeitraumText = von || bis ? `${von ? datumDe(von) : 'Beginn'} – ${bis ? datumDe(bis) : 'heute'}` : 'gesamt';
  const absagen = zeilen.filter(r => r.antwort.startsWith('Absage')).length;
  const mitAntwort = zeilen.filter(r => r.antwort !== 'keine' && r.antwort !== '—').length;
  const reihen = zeilen.map((r, i) => `
    <tr>
      <td class="n">${i + 1}</td>
      <td class="d">${r.datum ? datumDe(r.datum) : '—'}</td>
      <td>${esc(r.firma)}</td>
      <td>${esc(r.stelle)}</td>
      <td>${esc(r.ort)}</td>
      <td>${esc(r.weg)}</td>
      <td>${r.url ? `<a href="${esc(r.url)}">${esc(r.quelle)}</a>` : esc(r.quelle)}</td>
      <td>${esc(r.antwort)}</td>
    </tr>`).join('');
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bewerbungsnachweis ${esc(o.name)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font: 12px/1.4 system-ui, sans-serif; color: #111; background: #fff; margin: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #444; margin-bottom: 14px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #bbb; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #eee; }
  tr { break-inside: avoid; }
  td.n, td.d { white-space: nowrap; }
  a { color: inherit; }
  form { margin-bottom: 16px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  @media print { form { display: none; } body { margin: 0; } a { text-decoration: none; } }
</style></head><body>
<form method="get" action="/nachweis">
  <label>von <input type="date" name="von" value="${esc(von ?? '')}"></label>
  <label>bis <input type="date" name="bis" value="${esc(bis ?? '')}"></label>
  <button type="submit">Zeitraum anwenden</button>
  <button type="button" onclick="window.print()">Drucken / als PDF sichern</button>
</form>
<h1>Nachweis der Bewerbungsaktivitäten</h1>
<div class="meta">${esc(o.name)} · Zeitraum: ${zeitraumText} · ${zeilen.length} Bewerbungen, davon ${mitAntwort} mit Antwort (${absagen} Absagen) · Stand ${datumDe(o.stand.toISOString())}</div>
<table>
  <thead><tr><th>Nr.</th><th>Datum</th><th>Unternehmen</th><th>Stelle</th><th>Ort</th><th>Bewerbungsweg</th><th>Quelle</th><th>Antwort</th></tr></thead>
  <tbody>${reihen || '<tr><td colspan="8">Keine Bewerbungen im Zeitraum.</td></tr>'}</tbody>
</table>
</body></html>`;
}
