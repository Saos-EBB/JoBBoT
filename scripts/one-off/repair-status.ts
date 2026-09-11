import { readdir, readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { findAnschreiben } from '../../lib/anschreiben-datei.ts';
import { config } from '../../config.ts';
import type { Job, JobStatus } from '../../scrapers/interface.ts';

// Einmal-Reparatur des Bestands, Gegenstück zum Fix in lib/filter.ts.
//
// filterJob() hat den Status bedingungslos auf "triaged" gesetzt. Jeder
// `--scope=all`-Lauf warf damit generated/postausgang/gesendet auf Anfang zurück —
// versendete Bewerbungen standen danach wieder im "Jobs"-Ordner. Der Fix verhindert
// das ab jetzt; dieses Skript stellt wieder her, was schon passiert ist.
//
// Zwei Belege, beide unabhängig vom Job-JSON und deshalb vom Bug unberührt:
//   data/anschreiben/<basename>.md  — ein Anschreiben existiert => mindestens "generated"
//   data/mail-log.md                — "drafted" => postausgang, "sent" => gesendet
//
// Verlaufsrichtung ist strikt vorwärts: ein Job wird nie zurückgestuft, auch wenn ein
// Beleg schwächer ist als der gespeicherte Status (siehe RANG).
//
//   npx tsx scripts/repair-status.ts            # Dry-Run, ändert nichts
//   npx tsx scripts/repair-status.ts --apply    # schreibt, nach vollem Backup

const JOBS_DIR = 'data/jobs';

// Die Pipeline als Ordnung. Nur ein HÖHERER Rang darf überschreiben — so kann kein
// Beleg einen Job zurückwerfen, und mehrere Belege zum selben Job (Anschreiben +
// mail-log) einigen sich automatisch auf den weitesten.
// geloescht/fehler/offline stehen bewusst NICHT drin: das sind Seitenpfade, keine
// Stufen. Ein Job, der dort steht, wird gar nicht angefasst.
const RANG: Partial<Record<JobStatus, number>> = {
  new: 0, triaged: 1, generated: 2, freigegeben: 3, postausgang: 4, gesendet: 5,
};

interface Beleg {
  status: JobStatus;
  datum: string | null;   // ISO-Datum aus dem mail-log, für sentAt
  email: string | null;
  quelle: string;
}

async function findJobFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await findJobFiles(full));
    else if (entry.name.endsWith('.json')) files.push(full);
  }
  return files;
}

async function backup(files: string[]): Promise<string> {
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const backupRoot = join('data', `backup-${ts}`);
  for (const f of files) {
    const dest = join(backupRoot, relative('data', f));
    await mkdir(dirname(dest), { recursive: true });
    await cp(f, dest);
  }
  return backupRoot;
}

// Titel und Firma stehen im mail-log als Freitext, im Job-JSON als Feld. Nur
// Leerraum und Groß-/Kleinschreibung angleichen — keine weitere Normalisierung,
// sonst trifft die Zuordnung womöglich den falschen Job.
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

function staerker(neu: Beleg, alt: Beleg | undefined): boolean {
  if (!alt) return true;
  const rn = RANG[neu.status] ?? -1, ra = RANG[alt.status] ?? -1;
  if (rn !== ra) return rn > ra;
  // Gleicher Rang: das spätere Datum gewinnt (das mail-log enthält Dubletten).
  return (neu.datum ?? '') > (alt.datum ?? '');
}

async function main() {
  const apply = process.argv.includes('--apply');

  const files = await findJobFiles(JOBS_DIR);
  const jobs = new Map<string, { job: Job; datei: string }>();
  for (const f of files) {
    try {
      const job = JSON.parse(await readFile(f, 'utf8')) as Job;
      jobs.set(job.id, { job, datei: f });
    } catch {
      console.warn(`  übersprungen (kaputtes JSON): ${f}`);
    }
  }
  console.log(`${jobs.size} Jobs in ${files.length} Dateien.`);

  const belege = new Map<string, Beleg>();
  const merke = (id: string, b: Beleg) => { if (staerker(b, belege.get(id))) belege.set(id, b); };

  // Beleg 1: eine Anschreiben-Datei => das Anschreiben WURDE geschrieben.
  // Gesucht wird ueber findAnschreiben() (id-Praefix), nicht ueber den Dateinamen —
  // sonst haengt der Beleg wieder am Datum, siehe lib/anschreiben-datei.ts.
  for (const { job } of jobs.values()) {
    if (await findAnschreiben(job)) {
      merke(job.id, { status: 'generated', datum: null, email: null, quelle: 'anschreiben-datei' });
    }
  }

  // Beleg 2: das mail-log. Zuordnung über Titel+Firma, ersatzweise nur Titel.
  const perTitelFirma = new Map([...jobs.values()].map(({ job }) => [norm(job.title) + '|' + norm(job.company), job]));
  const perTitel = new Map([...jobs.values()].map(({ job }) => [norm(job.title), job]));
  const log = await readFile('data/mail-log.md', 'utf8');
  const zeilen = [...log.matchAll(/^- (\S+) \S+: (drafted|sent) — (.+?) — (.+?) — (\S+)$/gm)];
  let ohneJob = 0;
  for (const m of zeilen) {
    const [, datum, art, titel, firma, email] = m;
    const job = perTitelFirma.get(norm(titel) + '|' + norm(firma)) ?? perTitel.get(norm(titel));
    if (!job) { ohneJob++; continue; }
    merke(job.id, {
      status: art === 'sent' ? 'gesendet' : 'postausgang',
      datum, email, quelle: 'mail-log',
    });
  }
  console.log(`mail-log: ${zeilen.length} Zeilen, davon ${ohneJob} ohne passenden Job im Bestand.`);

  let geaendert = 0, uebersprungen = 0;
  const zusammenfassung: Record<string, number> = {};
  let mailNachtrag = 0, sentAtNachtrag = 0;

  for (const [id, beleg] of belege) {
    const eintrag = jobs.get(id)!;
    const job = eintrag.job;

    const rangJetzt = RANG[job.status];
    // Seitenpfade (geloescht/fehler/offline) und alles, was schon weiter ist, bleiben.
    if (rangJetzt == null || rangJetzt >= (RANG[beleg.status] ?? -1)) { uebersprungen++; continue; }

    const k = `${job.status} → ${beleg.status} (${beleg.quelle})`;
    zusammenfassung[k] = (zusammenfassung[k] ?? 0) + 1;
    geaendert++;

    job.status = beleg.status;
    // Nur FEHLENDE Felder ergänzen — ein vorhandener Wert ist im Zweifel der bessere.
    if (beleg.email && job.email == null) { job.email = beleg.email; mailNachtrag++; }
    if (beleg.status === 'gesendet' && beleg.datum && job.sentAt == null) {
      // Nur das Datum ist belegt, nicht die Uhrzeit — Mittag statt 00:00, damit der
      // Eintrag nicht durch eine Zeitzonenverschiebung auf den Vortag rutscht.
      job.sentAt = `${beleg.datum}T12:00:00.000Z`;
      sentAtNachtrag++;
    }
    job.updatedAt = new Date().toISOString();

    if (apply) await writeFile(eintrag.datei, JSON.stringify(job, null, 2), 'utf8');
  }

  console.log(`\n${apply ? '' : '[DRY RUN] '}Änderungen:`);
  for (const [k, v] of Object.entries(zusammenfassung).sort()) console.log(` ${String(v).padStart(3)}  ${k}`);
  console.log(` ${String(uebersprungen).padStart(3)}  bereits korrekt oder weiter — unangetastet`);
  console.log(`\n  ${mailNachtrag} × fehlende email ergänzt, ${sentAtNachtrag} × sentAt ergänzt`);
  console.log(`\n${apply ? '' : '[DRY RUN] '}${geaendert} Job-Dateien ${apply ? 'geschrieben' : 'würden geschrieben'}.`);
  if (!apply) console.log('Mit --apply ausführen (legt vorher ein Backup an).');
}

// Backup VOR jeder Analyse — nicht erst kurz vor dem ersten Schreibzugriff. Bricht die
// Analyse mittendrin ab, liegt die Sicherung trotzdem schon vollständig da.
if (process.argv.includes('--apply')) {
  const files = await findJobFiles(JOBS_DIR);
  console.log('Backup wird erstellt...');
  console.log(`Backup fertig: ${await backup(files)}/ (${files.length} Dateien)\n`);
}

await main();
