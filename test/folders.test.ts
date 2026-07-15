import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toJob } from '../lib/normalize.ts';
import { deriveStatus, inFolder, folderCounts } from '../lib/folders.ts';
import type { Job, JobStatus } from '../scrapers/interface.ts';

function job(status: JobStatus, email: string | null = null): Job {
  return { ...toJob({ source: 'x', url: 'https://x', title: 't', company: 'c', description: 'd' }), status, email };
}

test('deriveStatus: Pipeline-Zone-Werte werden zusammengefasst', () => {
  assert.equal(deriveStatus(job('new')), 'posteingang');
  assert.equal(deriveStatus(job('uncertain')), 'posteingang');
  assert.equal(deriveStatus(job('matched')), 'posteingang');
  assert.equal(deriveStatus(job('generated')), 'entwurf');
  assert.equal(deriveStatus(job('filtered_out')), 'aussortiert');
});

test('deriveStatus: UI-Zone-Werte laufen 1:1 durch', () => {
  for (const s of ['freigegeben', 'postausgang', 'gesendet', 'geloescht', 'fehler'] as const) {
    assert.equal(deriveStatus(job(s)), s);
  }
});

test('inFolder: entwurf mit/ohne Mail landet in unterschiedlichen Ordnern', () => {
  const mit = job('generated', 'firma@example.com');
  const ohne = job('generated', null);
  assert.equal(inFolder(mit, 'mail/entwurf'), true);
  assert.equal(inFolder(mit, 'nomail/entwurf'), false);
  assert.equal(inFolder(ohne, 'mail/entwurf'), false);
  assert.equal(inFolder(ohne, 'nomail/entwurf'), true);
});

test('inFolder: postausgang ist immer mail/postausgang', () => {
  assert.equal(inFolder(job('postausgang', 'firma@example.com'), 'mail/postausgang'), true);
});

test('inFolder: posteingang ist ein eigener Ordner ohne mail/nomail-Split', () => {
  assert.equal(inFolder(job('uncertain'), 'posteingang'), true);
  assert.equal(inFolder(job('matched'), 'posteingang'), true);
  assert.equal(inFolder(job('new'), 'posteingang'), true);
});

test('inFolder: VERLAUF-Ordner ignorieren Mail-Status', () => {
  assert.equal(inFolder(job('gesendet', 'x@y.at'), 'log/gesendet'), true);
  assert.equal(inFolder(job('gesendet', null), 'log/gesendet'), true);
  assert.equal(inFolder(job('filtered_out'), 'log/aussortiert'), true);
});

test('folderCounts: jeder Job landet in genau einem Ordner', () => {
  const jobs = [
    job('new'), job('uncertain'), job('matched'),
    job('generated', 'a@b.at'), job('generated', null),
    job('freigegeben', 'a@b.at'), job('freigegeben', null),
    job('postausgang', 'a@b.at'),
    job('gesendet'), job('filtered_out'), job('geloescht'), job('fehler'),
  ];
  const counts = folderCounts(jobs);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  assert.equal(total, jobs.length);
});
