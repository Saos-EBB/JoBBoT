import { useState, useMemo, useEffect, useRef } from 'react';
import { HISTORY_START, monthsDescending } from '../../lib/calendar.ts';

// Spiegelt die Ereignisliste von GET /api/calendar (scripts/ui-server.ts) — ein Eintrag
// je gesetztem sentAt/replyReceivedAt, date als 'YYYY-MM-DD'. jobId ist null bei
// gelabelten Bewerbungs-Mails, zu denen es keinen Job (mehr) gibt: die kommen aus
// data/mail-events.json und haben nichts, wohin man springen könnte.
export type CalendarEvent = { date: string; type: 'sent' | 'reply' | 'followup'; jobId: string | null; title: string; company: string };

export function formatDayLong(date: string): string {
  return new Date(date + 'T00:00:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
}
export function formatDayShort(date: string): string {
  return new Date(date + 'T00:00:00').toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
}
export function summarizeDay(date: string, bucket: DayBucket | undefined): string {
  const parts = CAL_TYPES.filter(t => bucket?.[t].length).map(t => CAL_LABEL[t](bucket![t].length));
  return `${formatDayShort(date)} · ${parts.join(' · ')}`;
}

export type DayBucket = { sent: CalendarEvent[]; followup: CalendarEvent[]; reply: CalendarEvent[] };

// Reihenfolge = Chronologie einer Bewerbung: raus, nachgehakt, Antwort. Sie bestimmt
// auch, wie die Streifen im Tagesquadrat liegen und wie das Popup sortiert.
export const CAL_TYPES = ['sent', 'followup', 'reply'] as const;
export const CAL_COLOR: Record<CalendarEvent['type'], string> = {
  sent: 'var(--fit-matched)',
  followup: 'var(--fit-offstack)',
  reply: 'var(--ok)',
};
export const CAL_LABEL: Record<CalendarEvent['type'], (n: number) => string> = {
  sent: n => `${n} gesendet`,
  followup: n => `${n}× nachgefasst`,
  reply: n => `${n} Antwort${n > 1 ? 'en' : ''}`,
};

// Ein Tag kann jetzt drei Sorten tragen — statt für jede Kombination eine eigene
// CSS-Klasse (--sent/--reply/--both/…) wächst der Verlauf aus den tatsächlich
// vorhandenen Farben. Eine Farbe bleibt einfarbig.
export function calBackground(farben: string[]): string {
  if (farben.length === 1) return farben[0];
  const stufe = 100 / farben.length;
  const stops = farben.map((f, i) => `${f} ${i * stufe}% ${(i + 1) * stufe}%`);
  return `linear-gradient(135deg, ${stops.join(', ')})`;
}

export function calTypesOf(bucket: DayBucket | undefined): CalendarEvent['type'][] {
  return CAL_TYPES.filter(t => (bucket?.[t].length ?? 0) > 0);
}

// Ein Monatsblock: Monatsüberschrift + 7-Spalten-Wochenraster (Mo–So), führende
// Leerzellen für den Wochentags-Versatz des Monatsersten. Kein Auffüllen am Ende
// der letzten Woche — optisch unauffällig, spart eine zweite Padding-Rechnung.
function CalendarMonth({ month, byDate, offen, onToggle, onHover, onOpenDay }: {
  month: string;
  byDate: Map<string, DayBucket>;
  offen: boolean;
  onToggle: () => void;
  onHover: (h: { x: number; y: number; text: string } | null) => void;
  onOpenDay: (date: string) => void;
}) {
  const [year, mo] = month.split('-').map(Number);
  const firstWeekday = (new Date(year, mo - 1, 1).getDay() + 6) % 7; // Mo=0..So=6
  const daysInMonth = new Date(year, mo, 0).getDate();
  const label = new Date(year, mo - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  // Monatssumme in der Überschrift: ein eingeklappter Monat soll trotzdem sagen, ob
  // sich das Aufklappen lohnt.
  const summen: Record<CalendarEvent['type'], number> = { sent: 0, followup: 0, reply: 0 };
  for (let d = 1; d <= daysInMonth; d++) {
    const bucket = byDate.get(`${month}-${String(d).padStart(2, '0')}`);
    for (const t of CAL_TYPES) summen[t] += bucket?.[t].length ?? 0;
  }
  const summe = CAL_TYPES.filter(t => summen[t]).map(t => CAL_LABEL[t](summen[t])).join(' · ');

  return (
    <div>
      <button className="cal__month-h" onClick={onToggle} aria-expanded={offen}>
        <span className={'cal__caret' + (offen ? ' cal__caret--offen' : '')}>▸</span>
        {label}
        <span className="cal__month-sum">{summe || 'keine Aktivität'}</span>
      </button>
      {!offen ? null : <>
      <div className="cal__weekday-row">
        {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => <span key={d}>{d}</span>)}
      </div>
      <div className="cal__grid">
        {cells.map((day, i) => {
          if (day == null) return <span key={'pad' + i} className="cal__sq cal__sq--pad" />;
          const date = `${month}-${String(day).padStart(2, '0')}`;
          const bucket = byDate.get(date);
          const typen = calTypesOf(bucket);
          const active = typen.length > 0;
          const cls = 'cal__sq' + (active ? ' cal__sq--filled cal__sq--active' : '');
          return (
            <span
              key={date}
              className={cls}
              style={active ? { background: calBackground(typen.map(t => CAL_COLOR[t])) } : undefined}
              onClick={active ? () => onOpenDay(date) : undefined}
              onMouseMove={active ? (e) => onHover({ x: e.clientX, y: e.clientY, text: summarizeDay(date, bucket) }) : undefined}
              onMouseLeave={active ? () => onHover(null) : undefined}
            >
              {day}
            </span>
          );
        })}
      </div>
      </>}
    </div>
  );
}

// Eigenes Hover-Element statt native title (Verzögerung/Optik, dieselbe Entscheidung
// stand beim Lade-Grid noch offen) + Tages-Popup mit Pfeiltasten-Navigation über
// activeDates (nur Tage mit Aktivität — leere Tage werden beim Wechseln übersprungen).
export function CalendarView({ events, onOpenJob }: { events: CalendarEvent[]; onOpenJob: (id: string) => void }) {
  const byDate = useMemo(() => {
    const m = new Map<string, DayBucket>();
    for (const ev of events) {
      const bucket = m.get(ev.date) ?? { sent: [], followup: [], reply: [] };
      bucket[ev.type].push(ev);
      m.set(ev.date, bucket);
    }
    return m;
  }, [events]);

  // Durchgehende Reihe ab HISTORY_START bis mindestens heute — auch Monate ohne
  // Aktivität bekommen einen Block, damit der Zeitraum, den der Gmail-Sync scannt,
  // im Kalender vollständig sichtbar ist statt auf die Treffermonate zusammenzuschrumpfen.
  const months = useMemo(() => {
    const letzter = [...byDate.keys()].sort().at(-1) ?? '';
    const heute = new Date().toISOString().slice(0, 10);
    return monthsDescending(HISTORY_START, letzter > heute ? letzter : heute);
  }, [byDate]);

  const activeDates = useMemo(() => [...byDate.keys()].sort(), [byDate]);

  // Monate ohne Aktivität starten eingeklappt: sie sind nur da, um den Zeitraum
  // lückenlos zu zeigen, und sollen die Monate mit Inhalt nicht wegdrücken. Gespeichert
  // wird nur die Abweichung vom Standard, nicht der Zustand selbst — sonst müsste die
  // Menge jedes Mal nachgezogen werden, wenn neue Ereignisse einen Monat füllen.
  const [umgeschaltet, setUmgeschaltet] = useState<Set<string>>(new Set());
  const mitAktivitaet = useMemo(
    () => new Set([...byDate.keys()].map(d => d.slice(0, 7))),
    [byDate]
  );
  const istOffen = (m: string) => (umgeschaltet.has(m) ? !mitAktivitaet.has(m) : mitAktivitaet.has(m));
  const umschalten = (m: string) => setUmgeschaltet(prev => {
    const next = new Set(prev);
    if (next.has(m)) next.delete(m); else next.add(m);
    return next;
  });

  const [activeDay, setActiveDay] = useState<string | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeDay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setActiveDay(null); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const i = activeDates.indexOf(activeDay);
        const next = e.key === 'ArrowLeft' ? activeDates[i - 1] : activeDates[i + 1];
        if (next) setActiveDay(next);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        listRef.current?.scrollBy({ top: e.key === 'ArrowDown' ? 40 : -40 });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeDay, activeDates]);

  // Ganz ohne Ereignisse wäre der Kalender nur eine Reihe leerer Monatsköpfe — die
  // Erklärung ist dann nützlicher als das Raster.
  if (events.length === 0) {
    return (
      <div className="empty" style={{ textAlign: 'left', padding: '8px 0' }}>
        <div className="empty__h">Noch keine Aktivität</div>
        Sobald eine Bewerbung versendet wird, du nachfasst oder eine Antwort eintrifft, erscheint sie hier.
      </div>
    );
  }

  // Chronologisch nach CAL_TYPES: erst die Bewerbung, dann die Nachfassen, dann die Antwort.
  const dayEntries = activeDay ? CAL_TYPES.flatMap(t => byDate.get(activeDay)?.[t] ?? []) : [];

  return (
    <>
      {months.map(month => (
        <CalendarMonth
          key={month}
          month={month}
          byDate={byDate}
          offen={istOffen(month)}
          onToggle={() => umschalten(month)}
          onHover={setHover}
          onOpenDay={setActiveDay}
        />
      ))}
      {hover && <div className="cal__hover" style={{ left: hover.x + 14, top: hover.y + 14 }}>{hover.text}</div>}
      {activeDay && (
        <div className="cal__overlay" onClick={() => setActiveDay(null)}>
          <div className="cal__popup" onClick={e => e.stopPropagation()}>
            <div className="cal__popup-head">{formatDayLong(activeDay)}</div>
            <div className="cal__popup-list" ref={listRef}>
              {dayEntries.map((ev, i) => (
                <button
                  key={(ev.jobId ?? 'mail') + ev.type + i}
                  className={'cal__entry' + (ev.jobId ? '' : ' cal__entry--nurmail')}
                  disabled={!ev.jobId}
                  onClick={ev.jobId ? () => onOpenJob(ev.jobId!) : undefined}
                  title={ev.jobId ? undefined : 'Aus Gmail — kein Job dazu im Bestand'}
                >
                  <span className="cal__entry__dot" style={{ background: CAL_COLOR[ev.type] }} />
                  {ev.type === 'followup' && <span className="cal__entry__quelle">Nachfass</span>}
                  <span className="cal__entry__firma">{ev.company}</span>
                  <span className="cal__entry__titel">{ev.title}</span>
                  {!ev.jobId && <span className="cal__entry__quelle">nur Mail</span>}
                </button>
              ))}
            </div>
            <div className="cal__popup-foot">← → Tag · ↑ ↓ scrollen · Esc</div>
          </div>
        </div>
      )}
    </>
  );
}
