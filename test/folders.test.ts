import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toJob } from '../lib/normalize.ts';
import { deriveStatus, inFolder, folderCounts, canGenerateAnschreiben } from '../lib/folders.ts';
import type { Fit, Job, JobStatus } from '../scrapers/interface.ts';

function job(status: JobStatus, fit: Fit | null = null, email: string | null = null): Job {
  return { ...toJob({ source: 'x', url: 'https://x', title: 't', company: 'c', description: 'd' }), status, fit, email };
}

test('deriveStatus: Pipeline-Zone-Werte werden zusammengefasst', () => {
  assert.equal(deriveStatus(job('new')), 'jobs');
  assert.equal(deriveStatus(job('triaged', 'offstack')), 'jobs');
  assert.equal(deriveStatus(job('triaged', 'matched')), 'jobs');
  assert.equal(deriveStatus(job('generated')), 'entwurf');
  assert.equal(deriveStatus(job('triaged', 'brutal')), 'aussortiert');
});

test('deriveStatus: UI-Zone-Werte laufen 1:1 durch', () => {
  for (const s of ['freigegeben', 'postausgang', 'gesendet', 'geloescht', 'fehler'] as const) {
    assert.equal(deriveStatus(job(s)), s);
  }
});

// Archivierte Inserate bekommen einen eigenen Ordner statt in "aussortiert" mitzulaufen:
// aussortiert ist ein Urteil ueber den Job (fit brutal), offline eine Tatsache ueber das
// Inserat. Wer die zwei mischt, kann spaeter nicht mehr sagen, warum etwas weg ist.
test('deriveStatus/inFolder: offline ist eine eigene Endstation, nicht "aussortiert"', () => {
  assert.equal(deriveStatus(job('offline')), 'offline');
  assert.equal(inFolder(job('offline'), 'log/offline'), true);
  assert.equal(inFolder(job('offline'), 'log/aussortiert'), false);
  assert.equal(inFolder(job('offline'), 'jobs'), false);
});

// Der Ordner sammelt archivierte Inserate unabhaengig davon, ob eine Mailadresse
// gefunden war — wie die uebrigen Verlauf-Ordner.
test('inFolder: log/offline ignoriert den Mail-Status', () => {
  assert.equal(inFolder(job('offline', 'matched', 'a@b.at'), 'log/offline'), true);
  assert.equal(inFolder(job('offline', null, null), 'log/offline'), true);
});

test('inFolder: entwurf mit/ohne Mail landet in unterschiedlichen Ordnern', () => {
  const mit = job('generated', null, 'firma@example.com');
  const ohne = job('generated', null, null);
  assert.equal(inFolder(mit, 'mail/entwurf'), true);
  assert.equal(inFolder(mit, 'nomail/entwurf'), false);
  assert.equal(inFolder(ohne, 'mail/entwurf'), false);
  assert.equal(inFolder(ohne, 'nomail/entwurf'), true);
});

test('inFolder: postausgang ist immer mail/postausgang', () => {
  assert.equal(inFolder(job('postausgang', null, 'firma@example.com'), 'mail/postausgang'), true);
});

test('inFolder: jobs ist ein eigener Ordner ohne mail/nomail-Split', () => {
  assert.equal(inFolder(job('triaged', 'offstack'), 'jobs'), true);
  assert.equal(inFolder(job('triaged', 'matched'), 'jobs'), true);
  assert.equal(inFolder(job('new'), 'jobs'), true);
});

test('canGenerateAnschreiben: nur getriagt und nicht brutal', () => {
  assert.equal(canGenerateAnschreiben(job('triaged', 'matched')), true);
  assert.equal(canGenerateAnschreiben(job('triaged', 'offstack')), true);
  assert.equal(canGenerateAnschreiben(job('triaged', 'brutal')), false);
  // Der Fall, der die Auswahl im UI still verschluckt hat: "new" sitzt im
  // "jobs"-Ordner, ist aber ungefiltert.
  assert.equal(canGenerateAnschreiben(job('new')), false);
});

test('canGenerateAnschreiben: nicht jeder Job im "jobs"-Ordner ist geeignet', () => {
  const imOrdner = [job('new'), job('triaged', 'matched'), job('triaged', 'offstack')]
    .filter(j => inFolder(j, 'jobs'));
  assert.equal(imOrdner.length, 3);
  assert.equal(imOrdner.filter(canGenerateAnschreiben).length, 2);
});

test('inFolder: VERLAUF-Ordner ignorieren Mail-Status', () => {
  assert.equal(inFolder(job('gesendet', null, 'x@y.at'), 'log/gesendet'), true);
  assert.equal(inFolder(job('gesendet', null, null), 'log/gesendet'), true);
  assert.equal(inFolder(job('triaged', 'brutal'), 'log/aussortiert'), true);
});

test('folderCounts: jeder Job landet in genau einem Ordner', () => {
  const jobs = [
    job('new'), job('triaged', 'offstack'), job('triaged', 'matched'),
    job('generated', null, 'a@b.at'), job('generated', null, null),
    job('freigegeben', null, 'a@b.at'), job('freigegeben', null, null),
    job('postausgang', null, 'a@b.at'),
    job('gesendet'), job('triaged', 'brutal'), job('geloescht'), job('fehler'),
    job('offline', 'matched'),
  ];
  const counts = folderCounts(jobs);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  assert.equal(total, jobs.length);
});
