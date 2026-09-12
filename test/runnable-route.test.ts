import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import { beginRun, finishRun, parseBodyOrDefault } from '../scripts/routes/runnable-route.ts';
import { createRunState } from '../scripts/routes/run-state.ts';

function fakeRes(): { res: ServerResponse; calls: { status: number; body: unknown }[] } {
  const calls: { status: number; body: unknown }[] = [];
  const res = {
    writeHead(status: number) { calls.push({ status, body: undefined }); return res; },
    end(body: string) { calls[calls.length - 1].body = JSON.parse(body); },
  } as unknown as ServerResponse;
  return { res, calls };
}

test('beginRun: erster Aufruf startet, antwortet 200, ruft onStart auf', () => {
  const run = createRunState<{ n: number }>();
  const { res, calls } = fakeRes();
  let started = false;

  const runId = beginRun(res, run, () => { started = true; });

  assert.ok(runId);
  assert.equal(started, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, 200);
  assert.deepEqual(calls[0].body, { started: true, runId });
});

test('beginRun: zweiter Aufruf waehrend laufendem Lauf -> 409, onStart NICHT aufgerufen', () => {
  const run = createRunState<{ n: number }>();
  beginRun(fakeRes().res, run, () => {});

  const { res, calls } = fakeRes();
  let started = false;
  const runId = beginRun(res, run, () => { started = true; });

  assert.equal(runId, null);
  assert.equal(started, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, 409);
  assert.deepEqual(calls[0].body, { started: false, reason: 'already-running' });
});

test('finishRun: Erfolg -> run.succeed mit Ergebnis und optionalem Status', async () => {
  const run = createRunState<{ n: number }>();
  beginRun(fakeRes().res, run, () => {});

  await finishRun(run, async () => ({ result: { n: 3 }, status: 'stopped' as const }));

  assert.deepEqual(run.get(), { status: 'stopped', runId: run.get().runId, result: { n: 3 } });
});

test('finishRun: Standardstatus ist "done", wenn keiner angegeben wird', async () => {
  const run = createRunState<{ n: number }>();
  beginRun(fakeRes().res, run, () => {});

  await finishRun(run, async () => ({ result: { n: 1 } }));

  assert.equal(run.get().status, 'done');
});

test('finishRun: wirft die Arbeit einen Fehler, geht der Lauf auf "error" statt zu crashen', async () => {
  const run = createRunState<{ n: number }>();
  beginRun(fakeRes().res, run, () => {});

  await finishRun(run, async () => { throw new Error('kaputt'); });

  assert.equal(run.get().status, 'error');
  assert.equal(run.get().error, 'kaputt');
});

test('parseBodyOrDefault: gibt das geparste Ergebnis zurueck, wenn parse() nicht wirft', async () => {
  const result = await parseBodyOrDefault<{ sources?: string[] }>(async () => ({ sources: ['a'] }), {});
  assert.deepEqual(result, { sources: ['a'] });
});

test('parseBodyOrDefault: faellt auf den Default zurueck, wenn parse() wirft (kaputtes/fehlendes JSON)', async () => {
  const result = await parseBodyOrDefault<{ sources?: string[] }>(async () => { throw new SyntaxError('bad json'); }, {});
  assert.deepEqual(result, {});
});
