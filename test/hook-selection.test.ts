import { test } from 'node:test';
import assert from 'node:assert/strict';
import { useSelection } from '../ui/hooks/selection.ts';
import { renderHook, act } from './render-hook.ts';
import { toJob } from '../lib/normalize.ts';
import type { Job, Fit, JobStatus } from '../scrapers/interface.ts';
import type { FolderId } from '../lib/folders.ts';

function job(title: string, status: JobStatus = 'triaged', fit: Fit | null = 'matched'): Job {
  return { ...toJob({ source: 'x', url: `https://x/${title}`, title, company: 'c', description: 'd' }), status, fit };
}

test('initial: nichts ausgewählt, briefbar leer', () => {
  const jobs = [job('Frontend Engineer')];
  const { result } = renderHook(({ jobs, folder }) => useSelection(jobs, folder), { jobs, folder: 'jobs' as FolderId });

  assert.deepEqual(result.current.selectedJobIds, new Set());
  assert.deepEqual(result.current.briefbar, []);
});

test('toggleSelect: an- und wieder abwählen', () => {
  const j = job('Frontend Engineer');
  const { result } = renderHook(({ jobs, folder }) => useSelection(jobs, folder), { jobs: [j], folder: 'jobs' as FolderId });

  act(() => { result.current.toggleSelect(j.id); });
  assert.ok(result.current.selectedJobIds.has(j.id));

  act(() => { result.current.toggleSelect(j.id); });
  assert.equal(result.current.selectedJobIds.has(j.id), false);
});

test('briefbar: nur triagierte, nicht-brutale Jobs zählen mit', () => {
  const brief = job('Frontend Engineer', 'triaged', 'matched');
  const brutal = job('Sales Manager', 'triaged', 'brutal');
  const notTriaged = job('Backend Engineer', 'new', null);
  const jobs = [brief, brutal, notTriaged];
  const { result } = renderHook(({ jobs, folder }) => useSelection(jobs, folder), { jobs, folder: 'jobs' as FolderId });

  act(() => {
    result.current.toggleSelect(brief.id);
    result.current.toggleSelect(brutal.id);
    result.current.toggleSelect(notTriaged.id);
  });

  assert.deepEqual(result.current.briefbar, [brief.id]);
});

test('Ordnerwechsel setzt die Auswahl zurück', () => {
  const j = job('Frontend Engineer');
  const { result, rerender } = renderHook(({ jobs, folder }) => useSelection(jobs, folder), { jobs: [j], folder: 'jobs' as FolderId });

  act(() => { result.current.toggleSelect(j.id); });
  assert.ok(result.current.selectedJobIds.has(j.id));

  rerender({ jobs: [j], folder: 'mail/entwurf' as FolderId });
  assert.deepEqual(result.current.selectedJobIds, new Set());
});
