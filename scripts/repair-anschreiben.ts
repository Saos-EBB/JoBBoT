import { readdir, stat, rename, unlink, mkdir, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { createStorage } from '../storage/index.ts';
import { slugify, jobBasename } from '../lib/slugify.ts';
import { config } from '../config.ts';
import type { Job } from '../scrapers/interface.ts';

// Einmal-Reparatur von data/anschreiben/.
//
// Das UI findet ein Anschreiben über jobBasename(job) — Titel, Firma, DATUM und
// id-Präfix. Wird dieselbe Stelle später neu gescrapt, bekommt sie ein neues
// postedAt und eine neue id; die Datei heisst dann noch nach dem alten Stand und
// ist für den Job unsichtbar, obwohl beide dieselbe Stelle meinen.
//
// Drei Faelle, in dieser Reihenfolge:
//   1. voller Dateiname passt zu einem Job          -> nichts zu tun
//   2. Titel+Firma passen eindeutig zu einem Job    -> auf dessen aktuellen Namen umbenennen
//      (haelt der Job schon einen Brief: die aeltere Fassung faellt weg)
//   3. kein oder mehrdeutiger Job                   -> Waise, faellt weg
//
// Datum und id werden fuer die Zuordnung bewusst ignoriert, Titel+Firma nicht:
// die beiden sind die Stelle. Mehrdeutige Treffer werden NICHT geraten.
//
//   npx tsx scripts/repair-anschreiben.ts            # Dry-Run, aendert nichts
//   npx tsx scripts/repair-anschreiben.ts --apply    # schreibt, nach vollem Backup

// Kein Anschreiben, sondern das Protokoll der Laeufe (lib/anschreiben.ts).
const KEIN_ANSCHREIBEN = new Set(['AnschreibenLog']);

interface Datei {
  name: string;
  mtime: Date;
}

// Zerlegt "<titel>_<firma>_<datum>_<id8>" zurueck. Der Titel-Slug darf selbst
// Unterstriche enthalten, deshalb von hinten gelesen.
function stelleAus(name: string): string | null {
  const teile = name.split('_');
  if (teile.length < 4) return null;
  const firma = teile.at(-3)!;
  const titel = teile.slice(0, -3).join('_');
  return `${titel}_${firma}`;
}

async function backup(dir: string): Promise<string> {
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const ziel = join('data', `backup-anschreiben-${ts}`);
  await mkdir(ziel, { recursive: true });
  await cp(dir, ziel, { recursive: true });
  return ziel;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const dir = config.anschreibenDir;

  if (apply) {
    console.log('Backup wird erstellt...');
    console.log(`Backup fertig: ${await backup(dir)}/\n`);
  }

  const jobs = await createStorage().list();
  const perBasename = new Map(jobs.map(j => [jobBasename(j), j]));
  const perStelle = new Map<string, Job[]>();
  for (const j of jobs) {
    const k = `${slugify(j.title)}_${slugify(j.company)}`;
    perStelle.set(k, [...(perStelle.get(k) ?? []), j]);
  }

  const namen = (await readdir(dir)).filter(f => f.endsWith('.md')).map(f => f.slice(0, -3));
  const dateien: Datei[] = [];
  for (const name of namen) {
    if (KEIN_ANSCHREIBEN.has(name)) continue;
    dateien.push({ name, mtime: (await stat(join(dir, `${name}.md`))).mtime });
  }

  // Neueste zuerst: streiten sich zwei Dateien um denselben Ziel-Namen, gewinnt die
  // juengere Fassung den Platz und die aeltere faellt weg — nie umgekehrt.
  dateien.sort((a, b) => +b.mtime - +a.mtime);

  // Belegte Ziel-Namen. Startet mit allem, was schon korrekt heisst.
  const belegt = new Map<string, Date>();
  for (const d of dateien) if (perBasename.has(d.name)) belegt.set(d.name, d.mtime);

  const umbenennen: { von: string; nach: string }[] = [];
  const loeschen: { name: string; grund: string }[] = [];
  let passt = 0;

  for (const d of dateien) {
    if (perBasename.has(d.name)) { passt++; continue; }

    const stelle = stelleAus(d.name);
    const treffer = stelle ? perStelle.get(stelle) : undefined;

    if (!treffer) { loeschen.push({ name: d.name, grund: 'kein Job zu dieser Stelle' }); continue; }
    if (treffer.length > 1) { loeschen.push({ name: d.name, grund: `mehrdeutig (${treffer.length} Jobs)` }); continue; }

    const ziel = jobBasename(treffer[0]);
    const belegtSeit = belegt.get(ziel);
    if (belegtSeit) {
      // Der Job hat bereits eine Fassung — und die ist juenger, sonst haette diese
      // Datei den Platz zuerst bekommen (Sortierung oben).
      loeschen.push({ name: d.name, grund: `aeltere Fassung von ${ziel}` });
      continue;
    }
    belegt.set(ziel, d.mtime);
    umbenennen.push({ von: d.name, nach: ziel });
  }

  const p = apply ? '' : '[DRY RUN] ';
  console.log(`${dateien.length} Anschreiben (plus ${namen.length - dateien.length} Protokolldatei).`);
  console.log(`  ${passt} heissen schon richtig — unangetastet`);
  console.log(`  ${umbenennen.length} werden ihrem Job zugeordnet (umbenannt)`);
  console.log(`  ${loeschen.length} fallen weg`);

  const gruende: Record<string, number> = {};
  for (const l of loeschen) {
    const k = l.grund.startsWith('aeltere Fassung') ? 'aeltere Fassung derselben Stelle' : l.grund;
    gruende[k] = (gruende[k] ?? 0) + 1;
  }
  for (const [k, v] of Object.entries(gruende).sort()) console.log(`      ${String(v).padStart(3)}  ${k}`);

  console.log(`\n${p}Zuordnung (erste 5):`);
  for (const u of umbenennen.slice(0, 5)) console.log(`  ${u.von}\n    -> ${u.nach}`);
  console.log(`\n${p}Faellt weg:`);
  for (const l of loeschen) console.log(`  ${l.name}  (${l.grund})`);

  if (apply) {
    for (const u of umbenennen) await rename(join(dir, `${u.von}.md`), join(dir, `${u.nach}.md`));
    for (const l of loeschen) await unlink(join(dir, `${l.name}.md`));
    console.log(`\n${umbenennen.length} umbenannt, ${loeschen.length} geloescht.`);
    console.log('Jetzt scripts/repair-status.ts --apply laufen lassen: die neu zugeordneten');
    console.log('Jobs stehen teils noch auf "triaged" und gehoeren auf "generated".');
  } else {
    console.log('\nMit --apply ausfuehren (legt vorher ein Backup an).');
  }
}

await main();
