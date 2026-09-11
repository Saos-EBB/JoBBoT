import { useState } from 'react';
import { Copy } from 'lucide-react';
import type { QueryField } from '../../scrapers/interface.ts';
import { COUNTRY_ONLY } from '../../lib/location-terms.ts';

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
