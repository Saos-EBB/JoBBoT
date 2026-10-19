import type React from 'react';
import { useEffect, useState } from 'react';

// Spiegelt GridUnitEvent aus scripts/ui-server.ts — ein SSE-Event pro abgeschlossener
// Grid-Zeile (Seite/Batch/Anschreiben-Item), siehe LoadGrid weiter unten.
export type GridUnitEvent = { section: string; sectionLabel: string; row: string; items: LoadGridSquare[] };

// Ein Grid-Muster für alle drei Lade-Anzeigen (Scrape/Filter/Anschreiben) statt drei
// eigener Implementierungen — Abschnitt (z.B. Quelle) -> Zeile (z.B. Batch) -> Quadrate
// (ein Item, fertig oder Fehler). Hover-Tooltip ist der native `title`-Attribut-Tooltip
// des Browsers statt eines eigenen Tooltip-Bauteils — reicht für "Kurzinfo beim Hover".
export type LoadGridSquare = {
  id: string;
  tooltip: string;
  state: 'done' | 'error' | 'excluded' | 'matched' | 'offstack' | 'brutal';
  url?: string;
  // Nur Anschreiben-Items: für die Liste fertiger Briefe (siehe lib/anschreiben-runner.ts).
  title?: string;
  company?: string;
  durationMs?: number;
  attempts?: number;
  maxAttempts?: number;
  // Nur Filter-Items: ersetzt den nativen title-Tooltip durch eine Vorschaukarte.
  preview?: GridPreview;
};
export type GridPreview = { title: string; company: string; location?: string | null; salary?: string | null };
export type LoadGridRow = { key: string; squares: LoadGridSquare[] };
export type LoadGridSection = { key: string; label: string; rows: LoadGridRow[] };

export const ROW_DURATION_MS = 4000;
// Muss zur .35s-Pop-Dauer in der CSS oben passen — der Moment, an dem das LETZTE
// Quadrat einer Zeile fertig erschienen ist (danach färbt sich die ganze Zeile ein).
export const POP_DURATION_MS = 350;

// ghost: Quadrate bleiben im Layout (Tschobbo braucht ihre Positionen als
// Wurfziele), werden aber unsichtbar + nicht klickbar — nur die Scrape-Section
// nutzt das, seit Tschobbo dort Klumpen statt Quadraten zeigt (siehe ui/tschobbo.js).
export function LoadGrid({ sections, ghost }: { sections: LoadGridSection[]; ghost?: boolean }) {
  const [karte, setKarte] = useState<{ p: GridPreview; x: number; y: number } | null>(null);
  return (
    <div className="loadgrid">
      {karte && <VorschauKarte {...karte} />}
      {sections.map(s => (
        <div className="loadgrid__section" key={s.key}>
          <div className="loadgrid__head">{s.label}</div>
          {s.rows.map(r => {
            // Feste Gesamtdauer pro Zeile (Kevin: "eine Zeile auf 4 Sek") statt fixem
            // Versatz pro Quadrat — sonst bräuchte eine 10er-Zeile 10x so lang wie eine
            // 1er-Zeile (Anschreiben). Bei 1 Quadrat entfällt der Versatz automatisch.
            const step = ROW_DURATION_MS / r.squares.length;
            // Gleich für jedes Quadrat der Zeile — erst wenn ALLE erschienen sind
            // (letztes Quadrat bei (n-1)*step + Pop-Dauer), färbt sich die Zeile ein.
            const revealDelay = (r.squares.length - 1) * step + POP_DURATION_MS;
            return (
              // data-row: Tschobbo (ui/tschobbo.js) muss bei parallelen Quellen die
              // Zeile aus dem Event finden können, nicht raten — DOM-Reihenfolge ist
              // nach Section gruppiert, nicht nach Event-Chronologie.
              <div className="loadgrid__row" key={r.key} data-row={r.key}>
                {r.squares.map((sq, i) => (
                  <span
                    key={sq.id}
                    className={'loadgrid__sq loadgrid__sq--' + sq.state + (sq.url ? ' loadgrid__sq--clickable' : '') + (ghost ? ' loadgrid__sq--ghost' : '')}
                    title={sq.preview ? undefined : sq.tooltip}
                    onMouseEnter={sq.preview ? e => {
                      const r = e.currentTarget.getBoundingClientRect();
                      setKarte({ p: sq.preview!, x: r.left, y: r.bottom });
                    } : undefined}
                    onMouseLeave={sq.preview ? () => setKarte(null) : undefined}
                    onClick={sq.url ? () => window.open(sq.url, '_blank', 'noopener,noreferrer') : undefined}
                    style={{ '--pop-delay': `${i * step}ms`, '--reveal-delay': `${revealDelay}ms` } as React.CSSProperties}
                  />
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// Vorschaukarte für einen Filter-Punkt: fest positioniert unter dem Punkt, am rechten
// Rand nach links geklappt, damit sie nicht aus dem Fenster ragt.
const KARTE_BREITE = 280;
function VorschauKarte({ p, x, y }: { p: GridPreview; x: number; y: number }) {
  const left = Math.min(x, window.innerWidth - KARTE_BREITE - 12);
  const zeile = (label: string, wert: string | null | undefined) => (
    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
      <span style={{ color: 'var(--dim)', width: 64, flexShrink: 0 }}>{label}</span>
      <span style={{ color: wert ? 'var(--text)' : 'var(--dim)' }}>{wert || 'nicht angegeben'}</span>
    </div>
  );
  return (
    <div style={{
      position: 'fixed', left, top: y + 6, width: KARTE_BREITE, zIndex: 50, pointerEvents: 'none',
      background: 'var(--raised)', border: '1px solid var(--line)', borderRadius: 8,
      padding: '10px 12px', fontSize: 12.5, boxShadow: '0 8px 24px rgba(0,0,0,.35)',
    }}>
      <div style={{ fontWeight: 600, color: 'var(--text)' }}>{p.title}</div>
      {zeile('Firma', p.company)}
      {zeile('Dienstort', p.location)}
      {zeile('Lohn', p.salary)}
    </div>
  );
}

// Hülle ums Grid, geteilt von Scrape/Filter/Anschreiben: bleibt nach Laufende stehen
// (Kevin: "verschwindet zu schnell"), bis der Schließen-Button sie wegräumt oder ein
// neuer Lauf sections auf [] zurücksetzt (siehe runScrapeNow/runFilterNow/runAnschreibenNow).
export function LoadGridPanel({ running, sections, onClose, ghost }: { running: boolean; sections: LoadGridSection[]; onClose: () => void; ghost?: boolean }) {
  return (
    <div className="empty" style={{ textAlign: 'left', padding: '8px 0', position: 'relative' }}>
      <div className="empty__h" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1 }}>{running ? 'Läuft…' : ''}</span>
        {!running && (
          <button className="btn" style={{ padding: '2px 10px', fontSize: 11.5 }} onClick={onClose}>
            Schließen
          </button>
        )}
      </div>
      {sections.length === 0 ? 'Startet…' : <LoadGrid sections={sections} ghost={ghost} />}
      {!running && <span className="loadgrid__done-badge">Fertig</span>}
    </div>
  );
}


// Hängt ein SSE-GridUnitEvent (eine fertige Zeile) an den bestehenden Sections-Baum an —
// von Scrape/Filter/Anschreiben gleichermaßen genutzt, damit die Anhänge-Logik nicht
// dreimal geschrieben wird.
export function appendGridRow(sections: LoadGridSection[], e: GridUnitEvent): LoadGridSection[] {
  const row: LoadGridRow = { key: e.row, squares: e.items };
  const idx = sections.findIndex(s => s.key === e.section);
  if (idx === -1) return [...sections, { key: e.section, label: e.sectionLabel, rows: [row] }];
  const next = [...sections];
  next[idx] = { ...next[idx], rows: [...next[idx].rows, row] };
  return next;
}

// Eine dauerhaft offene SSE-Verbindung, die jedes Event ans Sections-Grid anhängt —
// von Scrape/Filter/Anschreiben gleichermaßen genutzt, damit die Verbindungslogik nicht
// dreimal geschrieben wird (siehe appendGridRow oben). onEvent ist für Sonderfälle wie
// den Tschobbo-Hook der Scrape-Section, der zusätzlich zum Anhängen selbst reagiert.
export function useGridStream(
  url: string,
  setSections: React.Dispatch<React.SetStateAction<LoadGridSection[]>>,
  onEvent?: (e: GridUnitEvent) => void,
): void {
  useEffect(() => {
    const es = new EventSource(url);
    es.onmessage = (e) => {
      const event = JSON.parse(e.data) as GridUnitEvent;
      setSections(prev => appendGridRow(prev, event));
      onEvent?.(event);
    };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
}
