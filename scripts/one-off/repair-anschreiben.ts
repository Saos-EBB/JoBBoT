import { readdir, stat, rename, unlink, mkdir, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { createStorage } from '../../storage/index.ts';
import { slugify } from '../../lib/slugify.ts';
import { anschreibenName } from '../../lib/anschreiben-datei.ts';
import { config } from '../../config.ts';
import type { Job } from '../../scrapers/interface.ts';

// Einmal-Reparatur von data/anschreiben/.
//
// Das UI fand ein Anschreiben früher über jobBasename(job) — Titel, Firma, DATUM
// und id-Präfix. Wurde dieselbe Stelle später neu gescrapt, bekam sie ein neues
// postedAt (und ggf. eine neue id); die Datei hiess dann noch nach dem alten Stand
// und war für den Job unsichtbar.
//
// Die Ursache ist inzwischen behoben: gefunden wird über das id-Präfix allein
// (lib/anschreiben-datei.ts). Dieses Skript räumt den Bestand nach: es zieht die
// Dateien auf das neue, datumsfreie Namensschema und wirft weg, was zu keinem Job
// mehr gehört.
//
// Vier Faelle, in dieser Reihenfolge:
//   1. Name entspricht schon dem neuen Schema       -> nichts zu tun
//   2. id-Praefix trifft einen Job                  -> auf das neue Schema umbenennen
//   3. Titel+Firma treffen eindeutig einen Job      -> ebenso (faengt Jobs, die unter
//      einer NEUEN id neu angelegt wurden, weil der Portaltitel gedriftet ist)
//   4. kein oder mehrdeutiger Job                   -> Waise, faellt weg
//
// Stufe 3 ist die unscharfe: slugify() kuerzt den Titel auf 40 Zeichen, zwei Inserate
// koennen sich also jenseits davon unterscheiden. Deshalb steht sie NACH der id und
// mehrdeutige Treffer werden verworfen statt geraten. Haelt ein Job schon einen Brief,
// faellt die aeltere Fassung weg.
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
  // Ziel-Name im NEUEN Schema (ohne Datum). Eine Datei, die schon so heisst, bleibt.
  const perZielname = new Map(jobs.map(j => [anschreibenName(j), j]));
  // Und der Job, den eine Datei über ihr id-Präfix meint — unabhängig vom Rest des
  // Namens. Das ist der Weg, auf dem die alten Namen ihren Job wiederfinden.
  const perId8 = new Map(jobs.map(j => [j.id.slice(0, 8), j]));
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
  for (const d of dateien) if (perZielname.has(d.name)) belegt.set(d.name, d.mtime);

  const umbenennen: { von: string; nach: string }[] = [];
  const loeschen: { name: string; grund: string }[] = [];
  let passt = 0;

  for (const d of dateien) {
    if (perZielname.has(d.name)) { passt++; continue; }

    // Erst über das id-Präfix — das ist die verlässliche Zuordnung. Nur wenn die
    // ins Leere läuft (der Job wurde unter einer anderen id neu angelegt), wird
    // über Titel+Firma weitergesucht.
    const perId = perId8.get(d.name.slice(-8));
    if (perId) {
      const zielName = anschreibenName(perId);
      if (belegt.has(zielName)) { loeschen.push({ name: d.name, grund: `aeltere Fassung von ${zielName}` }); continue; }
      belegt.set(zielName, d.mtime);
      umbenennen.push({ von: d.name, nach: zielName });
      continue;
    }

    const stelle = stelleAus(d.name);
    const treffer = stelle ? perStelle.get(stelle) : undefined;

    if (!treffer) { loeschen.push({ name: d.name, grund: 'kein Job zu dieser Stelle' }); continue; }
    if (treffer.length > 1) { loeschen.push({ name: d.name, grund: `mehrdeutig (${treffer.length} Jobs)` }); continue; }

    const ziel = anschreibenName(treffer[0]);
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
