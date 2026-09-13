import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useFolderView } from '../ui/hooks/folder-view.ts';
import { renderHook, act } from './render-hook.ts';
import { toJob } from '../lib/normalize.ts';
import type { JobWithBrief } from '../ui/app.tsx';
import type { Fit } from '../scrapers/interface.ts';
import type { FolderId } from '../lib/folders.ts';

const FIT_KEYS: readonly Fit[] = ['matched', 'offstack', 'brutal'];

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function job(title: string, overrides: Partial<JobWithBrief> = {}): JobWithBrief {
  return {
    ...toJob({ source: 'x', url: `https://x/${title}`, title, company: overrides.company ?? 'c', description: 'd' }),
    brief: null,
    ...overrides,
  };
}

// Ohne localStorage im Testlauf (Node wirft ReferenceError, von ladeOrdner/merkeOrdner
// selbst abgefangen — siehe folder-view.ts) landet der Hook immer beim Default-Ordner.
function hookProps(jobs: JobWithBrief[], replyOnly = false) {
  return { jobs, replyOnly, fitKeys: FIT_KEYS };
}

test('initial: Default-Ordner "mail/entwurf", leere Suche, Filter "alle"', () => {
  const { result } = renderHook(({ jobs, replyOnly, fitKeys }) => useFolderView(jobs, replyOnly, fitKeys), hookProps([]));
  assert.equal(result.current.folder, 'mail/entwurf');
  assert.equal(result.current.fit, 'alle');
  assert.equal(result.current.q, '');
});

test('setFolder wechselt den Ordner', () => {
  const { result } = renderHook(({ jobs, replyOnly, fitKeys }) => useFolderView(jobs, replyOnly, fitKeys), hookProps([]));
  act(() => { result.current.setFolder('jobs' as FolderId); });
  assert.equal(result.current.folder, 'jobs');
});

test('counts zählt jeden Job in genau seinen abgeleiteten Ordner ein', () => {
  const triagedMatched = job('Frontend Engineer', { status: 'triaged', fit: 'matched' });
  const triagedBrutal = job('Sales Manager', { status: 'triaged', fit: 'brutal' });
  const sent = job('DevOps Engineer', { status: 'gesendet', fit: 'matched' });
  const jobs = [triagedMatched, triagedBrutal, sent];

  const { result } = renderHook(({ jobs, replyOnly, fitKeys }) => useFolderView(jobs, replyOnly, fitKeys), hookProps(jobs));

  assert.equal(result.current.counts['jobs'], 1);
  assert.equal(result.current.counts['log/aussortiert'], 1);
  assert.equal(result.current.counts['log/gesendet'], 1);
  assert.equal(result.current.counts['mail/entwurf'], 0);
});

test('fitCounts zählt nur innerhalb des aktuellen Ordners', () => {
  const matched = job('Frontend Engineer', { status: 'triaged', fit: 'matched' });
  const offstack = job('Backend Engineer', { status: 'triaged', fit: 'offstack' });
  const outsideFolder = job('Sales Manager', { status: 'triaged', fit: 'brutal' }); // landet in log/aussortiert, nicht "jobs"
  const jobs = [matched, offstack, outsideFolder];

  const { result } = renderHook(({ jobs, replyOnly, fitKeys }) => useFolderView(jobs, replyOnly, fitKeys), hookProps(jobs));
  act(() => { result.current.setFolder('jobs' as FolderId); });

  assert.equal(result.current.fitCounts.alle, 2);
  assert.equal(result.current.fitCounts.matched, 1);
  assert.equal(result.current.fitCounts.offstack, 1);
  assert.equal(result.current.fitCounts.brutal, 0);
});

test('list: sortiert nach Aktualität (jüngster zuerst) und respektiert den Fit-Filter', () => {
  const older = job('Frontend Engineer', { status: 'triaged', fit: 'matched', scrapedAt: daysAgoIso(3) });
  const newer = job('Backend Engineer', { status: 'triaged', fit: 'offstack', scrapedAt: daysAgoIso(1) });
  const jobs = [older, newer];

  const { result } = renderHook(({ jobs, replyOnly, fitKeys }) => useFolderView(jobs, replyOnly, fitKeys), hookProps(jobs));
  act(() => { result.current.setFolder('jobs' as FolderId); });

  assert.deepEqual(result.current.list.map(j => j.id), [newer.id, older.id]);

  act(() => { result.current.setFit('matched'); });
  assert.deepEqual(result.current.list.map(j => j.id), [older.id]);
});

test('list: Volltextsuche über Firma/Titel/Ort', () => {
  const a = job('Frontend Engineer', { status: 'triaged', fit: 'matched', company: 'Foo GmbH' });
  const b = job('Backend Engineer', { status: 'triaged', fit: 'matched', company: 'Bar AG' });
  const jobs = [a, b];

  const { result } = renderHook(({ jobs, replyOnly, fitKeys }) => useFolderView(jobs, replyOnly, fitKeys), hookProps(jobs));
  act(() => { result.current.setFolder('jobs' as FolderId); });
  act(() => { result.current.setQ('backend'); });

  assert.deepEqual(result.current.list.map(j => j.id), [b.id]);
});

test('list: replyOnly greift nur im Ordner log/gesendet', () => {
  const withReply = job('Frontend Engineer', { status: 'gesendet', fit: 'matched', replyReceivedAt: daysAgoIso(1) });
  const withoutReply = job('Backend Engineer', { status: 'gesendet', fit: 'matched' });
  const jobs = [withReply, withoutReply];

  const { result, rerender } = renderHook(
    ({ jobs, replyOnly, fitKeys }) => useFolderView(jobs, replyOnly, fitKeys),
    hookProps(jobs, false),
  );
  act(() => { result.current.setFolder('log/gesendet' as FolderId); });
  assert.equal(result.current.list.length, 2);

  rerender(hookProps(jobs, true));
  assert.deepEqual(result.current.list.map(j => j.id), [withReply.id]);
});

test('selectable schließt gesendete Jobs aus, auch wenn sie in list stehen', () => {
  const sent = job('Frontend Engineer', { status: 'gesendet', fit: 'matched' });
  const jobs = [sent];

  const { result } = renderHook(({ jobs, replyOnly, fitKeys }) => useFolderView(jobs, replyOnly, fitKeys), hookProps(jobs));
  act(() => { result.current.setFolder('log/gesendet' as FolderId); });

  assert.equal(result.current.list.length, 1);
  assert.deepEqual(result.current.selectable, []);
});
