import { useEffect, useMemo, useState } from 'react';
import { Copy } from 'lucide-react';
import type { QueryField } from '../../scrapers/interface.ts';
import { COUNTRY_ONLY } from '../../lib/location-terms.ts';
import { checkQuery, describeProblem } from '../../lib/query-schema.ts';

// Spiegelt lib/sources.ts bzw. lib/location.ts — kein gemeinsames Modul, weil beide
// readFileSync benutzen und nicht ins Browser-Bundle dürfen (siehe lib/location-terms.ts).
export type SourcesCfg = Record<string, { enabled: boolean; queries: Record<string, string>[] }>;
export type LocationCfg = { cities: string[]; regions: string[]; remote: string[] };

export const UMKREIS_GRUPPEN: { key: keyof LocationCfg; label: string; hint: string }[] = [
  { key: 'cities', label: 'Orte', hint: 'Ort hinzufügen' },
  { key: 'regions', label: 'Regionen', hint: 'Region hinzufügen' },
  { key: 'remote', label: 'Zählt als „remote"', hint: 'Begriff hinzufügen' },
];

// Die eine Eingabe, die still das ganze Verhalten umdreht: COUNTRY_ONLY wird in
// isInRange() EXAKT verglichen, eine Region dagegen per Substring. "Österreich" als
// Region behält damit jeden Job mit "…, Österreich" — der Umkreisfilter ist praktisch
// aus. Gewarnt, nicht verboten: wer wirklich alles will, darf das.
export function istLandesbegriff(wert: string): boolean {
  return COUNTRY_ONLY.includes(wert.trim().toLowerCase());
}

// Chip-Liste für Felder, die aus einer einzigen Textzeile bestehen: Suchbegriffe,
// Orte, Regionen. Kompakt, weil sieben Begriffe sonst sieben Zeilen Höhe kosten.
export function ChipListe({ werte, hint, onChange, warnung }: {
  werte: string[];
  hint: string;
  onChange: (next: string[]) => void;
  warnung?: (wert: string) => string | null;
}) {
  const [entwurf, setEntwurf] = useState('');
  const [nachfrage, setNachfrage] = useState<string | null>(null);

  const uebernehmen = (wert: string, trotzWarnung = false) => {
    const w = wert.trim();
    if (!w || werte.includes(w)) { setEntwurf(''); return; }
    const warn = warnung?.(w);
    if (warn && !trotzWarnung) { setNachfrage(w); return; }
    onChange([...werte, w]);
    setEntwurf('');
    setNachfrage(null);
  };

  return (
    <div className="cfg__chips">
      {werte.map(w => (
        <span key={w} className="cfg__chip">
          {w}
          <button className="cfg__chip-x" onClick={() => onChange(werte.filter(x => x !== w))} aria-label={`${w} entfernen`}>×</button>
        </span>
      ))}
      <input
        className="cfg__add"
        value={entwurf}
        placeholder={hint}
        onChange={e => { setEntwurf(e.target.value); setNachfrage(null); }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); uebernehmen(entwurf); } }}
        onBlur={() => { if (!nachfrage) uebernehmen(entwurf); }}
      />
      {nachfrage && (
        <div className="cfg__warn">
          <span>{warnung?.(nachfrage)}</span>
          <button className="btn" onClick={() => uebernehmen(nachfrage, true)}>Trotzdem eintragen</button>
          <button className="btn btn--ghost" onClick={() => { setNachfrage(null); setEntwurf(''); }}>Abbrechen</button>
        </div>
      )}
    </div>
  );
}

// Ein Portalblock. Die Form folgt der Feldzahl, nicht dem Portalnamen: ein Feld wird zur
// Chip-Wolke, mehrere werden zu beschrifteten Zeilen. Welche Form es ist, sagt das
// querySchema des Adapters — ein künftiges Portal ordnet sich damit von selbst ein.
export function PortalBlock({ name, cfg, felder, onChange }: {
  name: string;
  cfg: { enabled: boolean; queries: Record<string, string>[] };
  felder: QueryField[];
  onChange: (next: { enabled: boolean; queries: Record<string, string>[] }) => void;
}) {
  const einfeldrig = felder.length === 1;
  const feld = felder[0];

  return (
    <div className={'cfg__portal' + (cfg.enabled ? '' : ' cfg__portal--aus')}>
      <div className="cfg__portal-kopf">
        <span className="cfg__portal-name">{name}</span>
        {/* Deaktivierte Portale bleiben sichtbar statt ausgeblendet — sonst verschwindet
            die Konfiguration mitsamt dem Weg, sie zurückzuholen. */}
        <label className="cfg__schalter">
          <input type="checkbox" checked={cfg.enabled} onChange={e => onChange({ ...cfg, enabled: e.target.checked })} />
          {cfg.enabled ? 'an' : 'aus'}
        </label>
      </div>

      {einfeldrig ? (
        <ChipListe
          werte={cfg.queries.map(q => q[feld.key] ?? '').filter(Boolean)}
          hint={`+ ${feld.label}`}
          onChange={next => onChange({ ...cfg, queries: next.map(v => ({ [feld.key]: v })) })}
        />
      ) : (
        <div className="cfg__zeilen">
          <div className="cfg__zeile cfg__zeile--kopf" style={{ gridTemplateColumns: `repeat(${felder.length}, 1fr) auto` }}>
            {felder.map(f => <span key={f.key}>{f.label}{f.required && ' *'}</span>)}
            <span />
          </div>
          {cfg.queries.map((q, i) => (
            <div key={i} className="cfg__zeile" style={{ gridTemplateColumns: `repeat(${felder.length}, 1fr) auto` }}>
              {felder.map(f => (
                <input
                  key={f.key}
                  className="cfg__feld"
                  value={q[f.key] ?? ''}
                  placeholder={f.placeholder}
                  onChange={e => onChange({
                    ...cfg,
                    queries: cfg.queries.map((x, xi) => (xi === i ? { ...x, [f.key]: e.target.value } : x)),
                  })}
                />
              ))}
              <button className="cfg__chip-x" aria-label={`Anfrage ${i + 1} entfernen`}
                onClick={() => onChange({ ...cfg, queries: cfg.queries.filter((_, xi) => xi !== i) })}>×</button>
            </div>
          ))}
          <button className="btn btn--ghost cfg__plus"
            onClick={() => onChange({ ...cfg, queries: [...cfg.queries, Object.fromEntries(felder.map(f => [f.key, ''])) ] })}>
            + Anfrage
          </button>
        </div>
      )}
    </div>
  );
}

// Das Roh-JSON ist eine ANSICHT, kein zweiter Editor: es zeigt, was das Formular gerade
// hält. Damit gibt es keine zweite Wahrheit, die mit der ersten in Konflikt geraten kann
// (siehe .scratch/einstellungsseite, Ticket "Formular und Roh-JSON").
export function RohAnsicht({ offen, onToggle, data }: { offen: boolean; onToggle: () => void; data: unknown }) {
  const text = JSON.stringify(data, null, 2);
  return (
    <div className="cfg__roh">
      <button className="cfg__roh-kopf" onClick={onToggle} aria-expanded={offen}>
        <span className={'cal__caret' + (offen ? ' cal__caret--offen' : '')}>▸</span>
        Rohdaten (JSON)
        <span className="cfg__roh-hint">nur lesen · spiegelt das Formular</span>
      </button>
      {offen && (
        <>
          <pre className="cfg__roh-text">{text}</pre>
          <button className="btn btn--ghost" onClick={() => navigator.clipboard?.writeText(text)}>
            <Copy /> Kopieren
          </button>
        </>
      )}
    </div>
  );
}

// active = ob der Einstellungen-Tab ("suche" im view-State von app.tsx) gerade
// sichtbar ist — beim Betreten geladen, nicht beim App-Start, wie Duplikate/Kalender.
export function useSettingsConfig(active: boolean, say: (msg: string, kind?: 'ok' | 'err') => void) {
  const [schema, setSchema] = useState<Record<string, QueryField[]> | null>(null);
  const [sources, setSources] = useState<SourcesCfg | null>(null);
  const [umkreis, setUmkreis] = useState<LocationCfg | null>(null);
  const [cfgBackup, setCfgBackup] = useState<{ sources: boolean; location: boolean }>({ sources: false, location: false });
  const [cfgDirty, setCfgDirty] = useState<{ sources: boolean; location: boolean }>({ sources: false, location: false });
  const [cfgErrors, setCfgErrors] = useState<string[]>([]);
  const [cfgBusy, setCfgBusy] = useState(false);
  const [rohOffen, setRohOffen] = useState<Record<string, boolean>>({});

  // Das Schema kommt aus der Adapter-Registry (GET /api/config/schema), nicht aus der
  // Datei: der Code sagt, welche Portale es gibt und welche Felder sie kennen.
  useEffect(() => {
    if (!active) return;
    let abgebrochen = false;
    (async () => {
      const [sch, src, loc] = await Promise.all([
        fetch('/api/config/schema').then(r => r.json()),
        fetch('/api/config/sources').then(r => r.json()),
        fetch('/api/config/location').then(r => r.json()),
      ]);
      if (abgebrochen) return;
      setSchema(sch as Record<string, QueryField[]>);
      setSources(src.data as SourcesCfg);
      setUmkreis(loc.data as LocationCfg);
      setCfgBackup({ sources: !!src.hasBackup, location: !!loc.hasBackup });
      setCfgDirty({ sources: false, location: false });
      setCfgErrors([]);
    })();
    return () => { abgebrochen = true; };
  }, [active]);

  async function saveConfig(name: 'sources' | 'location') {
    const data = name === 'sources' ? sources : umkreis;
    if (!data) return;
    setCfgBusy(true);
    setCfgErrors([]);
    try {
      const res = await fetch(`/api/config/${name}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const body = await res.json();
      if (!res.ok) { setCfgErrors(body.errors ?? ['Speichern fehlgeschlagen']); return; }
      setCfgDirty(d => ({ ...d, [name]: false }));
      setCfgBackup(b => ({ ...b, [name]: true }));
      // loadSources() liest pro Nutzung frisch — ein laufender Scrape sieht die Änderung
      // mitten drin. Gesperrt wird nicht, aber ungesagt bleiben soll es auch nicht.
      say(body.scrapeRunning ? 'Gespeichert — ein Scrape läuft gerade und sieht die Änderung noch' : 'Gespeichert');
    } finally {
      setCfgBusy(false);
    }
  }

  async function restoreConfig(name: 'sources' | 'location') {
    setCfgBusy(true);
    try {
      const res = await fetch(`/api/config/${name}/restore`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) { say(body.error ?? 'Zurückholen fehlgeschlagen', 'err'); return; }
      if (name === 'sources') setSources(body.data as SourcesCfg); else setUmkreis(body.data as LocationCfg);
      setCfgBackup(b => ({ ...b, [name]: false }));
      setCfgDirty(d => ({ ...d, [name]: false }));
      setCfgErrors([]);
      say('Letzte Fassung zurückgeholt');
    } finally {
      setCfgBusy(false);
    }
  }

  // Anfragen, die kein Adapter annehmen würde. Zwei Quellen: Handedits an der Datei —
  // dafür war der Hinweis ursprünglich gedacht — und Tippen im Formular selbst, etwa eine
  // frisch angelegte Zeile mit leerem Pflichtfeld. Deshalb hängt daran auch der
  // Speichern-Knopf: die Rückmeldung kommt beim Tippen, nicht erst als 422 vom Server.
  //
  // "Reparieren" wird nur angeboten, wenn die Absicht eindeutig ist: genau ein
  // unbekannter Schlüssel und genau ein fehlendes Pflichtfeld heisst Tippfehler im
  // Namen, der Wert soll bleiben. Alles andere waere Raten.
  const kaputteAnfragen = useMemo(() => {
    if (!sources || !schema) return [];
    const treffer: { portal: string; index: number; problem: string; fix?: { von: string; nach: string } }[] = [];
    for (const [portal, cfg] of Object.entries(sources)) {
      const felder = schema[portal];
      if (!felder) continue;
      cfg.queries.forEach((q, i) => {
        const probleme = checkQuery(felder, q);
        if (probleme.length === 0) return;
        const fehlend = probleme.filter(p => p.kind === 'missing');
        const unbekannt = probleme.filter(p => p.kind === 'unknown');
        treffer.push({
          portal, index: i,
          problem: probleme.map(describeProblem).join('; '),
          fix: fehlend.length === 1 && unbekannt.length === 1
            ? { von: unbekannt[0].key, nach: fehlend[0].key }
            : undefined,
        });
      });
    }
    return treffer;
  }, [sources, schema]);

  const sourcesFehlerhaft = kaputteAnfragen.length > 0;

  // Benennt einen Schlüssel um und behält den Wert — der Tippfehler-Fall.
  function repariereAnfrage(portal: string, index: number, von: string, nach: string) {
    setSources(prev => {
      if (!prev) return prev;
      const queries = prev[portal].queries.map((q, qi) => {
        if (qi !== index) return q;
        const { [von]: wert, ...rest } = q;
        return { ...rest, [nach]: wert };
      });
      return { ...prev, [portal]: { ...prev[portal], queries } };
    });
    setCfgDirty(d => ({ ...d, sources: true }));
  }

  return {
    schema, sources, setSources, umkreis, setUmkreis,
    cfgBackup, cfgDirty, setCfgDirty, cfgErrors, cfgBusy, rohOffen, setRohOffen,
    saveConfig, restoreConfig, kaputteAnfragen, sourcesFehlerhaft, repariereAnfrage,
  };
}
