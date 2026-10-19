import { useEffect, useState } from 'react';
import type { LoadGridSquare } from './grid.tsx';

// Laufende und fertige Briefe eines Anschreiben-Laufs, unter dem Lade-Grid der
// Anschreiben-Ansicht: pro Brief Dauer der Generierung und Versuche (x/3). Die Items
// kommen aus demselben SSE-Strom wie das Grid (lib/anschreiben-runner.ts).

const dauer = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Tickt jede Sekunde, solange der aktuelle Brief entsteht.
function Uhr({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <>{dauer(now - since)}</>;
}

const zeile = { display: 'flex', alignItems: 'baseline', gap: 10, padding: '5px 0', borderTop: '1px solid var(--line)' } as const;
const zahl = { fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--dim)', whiteSpace: 'nowrap' } as const;

export function AnschreibenListe({ items, current, onOpen }: {
  items: LoadGridSquare[];
  current?: { title: string; startedAt: number };
  onOpen: (id: string) => void;
}) {
  if (items.length === 0 && !current) return null;
  return (
    <div style={{ marginTop: 16, fontSize: 13 }}>
      {current && (
        <div style={zeile}>
          <span style={{ flex: 1 }}>{current.title} <span style={{ color: 'var(--dim)' }}>— entsteht…</span></span>
          <span style={zahl}><Uhr since={current.startedAt} /></span>
        </div>
      )}
      {[...items].reverse().map(it => (
        <div
          key={it.id}
          style={{ ...zeile, cursor: it.state === 'done' ? 'pointer' : 'default' }}
          title={it.state === 'done' ? 'Brief öffnen' : 'Kein Brief — alle Versuche fehlgeschlagen'}
          onClick={it.state === 'done' ? () => onOpen(it.id) : undefined}
        >
          <span style={{ color: it.state === 'done' ? 'var(--ok)' : 'var(--err)' }}>
            {it.state === 'done' ? '✓' : '✗'}
          </span>
          <span style={{ flex: 1 }}>
            {it.title} <span style={{ color: 'var(--dim)' }}>— {it.company}</span>
          </span>
          {it.durationMs != null && <span style={zahl}>{dauer(it.durationMs)}</span>}
          {it.attempts != null && (
            <span style={zahl}>{it.attempts}/{it.maxAttempts ?? 3} {it.attempts === 1 ? 'Versuch' : 'Versuche'}</span>
          )}
        </div>
      ))}
    </div>
  );
}
