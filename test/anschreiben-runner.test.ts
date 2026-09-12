import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAnschreiben, type EmailFinder } from '../lib/anschreiben-runner.ts';
import { JsonStore } from '../storage/json-store.ts';
import { toJob } from '../lib/normalize.ts';
import { tmpDir, rmTmp } from './helpers.ts';
import type { ProfileData } from '../lib/profile.ts';
import type { Job } from '../scrapers/interface.ts';

// Diese Tests pruefen NUR die Schleife in runAnschreiben (Zaehler, Abort, Lifecycle
// des EmailFinders) — generateAnschreiben() selbst (Ollama, Retry/Parse) hat eigene
// Tests in test/anschreiben.test.ts. Ein Fake statt eines echten Browsers bzw.
// generateAnschreiben() macht diese Schleife zum ersten Mal ueberhaupt testbar.

const profile: ProfileData = {
  name: 'Max Mustermann',
  job_title: 'Junior Softwareentwickler',
  quereinstieg: { bootcamp: 'TestBootcamp', abschluss: 'HTL Informatik', hintergrund: 'Quereinsteiger' },
  skills: { sprachen: [], frontend: [], backend: [], datenbanken: [], tools: [] },
  sprachkenntnisse: [],
  projekte: [],
};

function job(overrides: Partial<{ title: string; company: string; email: string | null }> = {}): Job {
  const j = toJob({
    source: 'karriere.at',
    url: `https://www.karriere.at/jobs/${Math.random()}`,
    title: overrides.title ?? 'Junior Developer',
    company: overrides.company ?? 'Acme',
    description: 'Anforderungen: TypeScript-Kenntnisse.',
  });
  return { ...j, email: overrides.email === undefined ? null : overrides.email };
}

function fakeFinder(finds: (job: Job) => Promise<string | null> = async () => null): EmailFinder & { closed: boolean } {
  const finder = {
    closed: false,
    find: finds,
    async close() { finder.closed = true; },
  };
  return finder;
}

test('generiert fuer jeden Job, zaehlt korrekt hoch', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const jobs = [job({ email: 'a@acme.at' }), job({ email: 'b@acme.at' })];
  const finder = fakeFinder();

  const result = await runAnschreiben({
    jobs, storage, profile, emailFinder: finder,
    generate: async () => '/tmp/does-not-matter.txt',
  });

  assert.equal(result.generated, 2);
  assert.equal(result.skipped, 0);
  assert.equal(result.mailGenerated, 2); // beide hatten schon eine Adresse
  assert.equal(result.nomailGenerated, 0);
  assert.equal(result.emailsFound, 0); // findEmail wurde nie gebraucht
  assert.equal(finder.closed, true);
});

test('ruft den EmailFinder nur fuer Jobs ohne Adresse auf, zaehlt emailsFound', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const mitMail = job({ email: 'a@acme.at' });
  const ohneMail = job({ email: null });
  await storage.save(mitMail);
  await storage.save(ohneMail);
  let finderCalls = 0;
  const finder = fakeFinder(async () => { finderCalls++; return 'found@acme.at'; });

  const result = await runAnschreiben({
    jobs: [mitMail, ohneMail], storage, profile, emailFinder: finder,
    generate: async () => '/tmp/does-not-matter.txt',
  });

  assert.equal(finderCalls, 1); // nur fuer ohneMail
  assert.equal(result.emailsFound, 1);
  assert.equal(result.mailGenerated, 2); // beide haben am Ende eine Adresse
  const updated = await storage.get(ohneMail.id);
  assert.equal(updated?.email, 'found@acme.at');
});

test('speichert die gefundene Adresse am Job', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const ohneMail = job({ email: null });
  await storage.save(ohneMail);
  const finder = fakeFinder(async () => 'found@acme.at');

  await runAnschreiben({
    jobs: [ohneMail], storage, profile, emailFinder: finder,
    generate: async () => '/tmp/does-not-matter.txt',
  });

  const updated = await storage.get(ohneMail.id);
  assert.equal(updated?.email, 'found@acme.at');
});

test('generate() liefert null -> zaehlt als skipped, kein Fehler', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const finder = fakeFinder();

  const result = await runAnschreiben({ jobs: [job()], storage, profile, emailFinder: finder, generate: async () => null });

  assert.equal(result.generated, 0);
  assert.equal(result.skipped, 1);
});

test('Abort vor dem naechsten Job bricht die Schleife sauber ab, EmailFinder wird trotzdem geschlossen', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const jobs = [job(), job(), job()];
  const finder = fakeFinder();
  const controller = new AbortController();
  let calls = 0;

  const result = await runAnschreiben({
    jobs, storage, profile, emailFinder: finder, signal: controller.signal,
    generate: async () => {
      calls++;
      if (calls === 1) controller.abort(); // nach dem ersten Job abbrechen
      return '/tmp/does-not-matter.txt';
    },
  });

  assert.equal(calls, 1); // zweiter/dritter Job wurden nicht mehr gestartet
  assert.equal(result.generated, 1);
  assert.equal(result.skipped, 0); // processed zaehlt nur den einen abgearbeiteten Job
  assert.equal(finder.closed, true);
});

test('EmailFinder wird auch geschlossen, wenn generate() wirft', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const jobs = [job()];
  const finder = fakeFinder();

  await assert.rejects(
    runAnschreiben({ jobs, storage, profile, emailFinder: finder, generate: async () => { throw new Error('kaputt'); } }),
  );

  assert.equal(finder.closed, true);
});

test('emailFinder.find() wirft -> wird abgefangen, Job zaehlt trotzdem als generiert ohne Mail', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const ohneMail = job({ email: null });
  const finder = fakeFinder(async () => { throw new Error('firmenabc down'); });

  const result = await runAnschreiben({
    jobs: [ohneMail], storage, profile, emailFinder: finder,
    generate: async () => '/tmp/does-not-matter.txt',
  });

  assert.equal(result.generated, 1);
  assert.equal(result.emailsFound, 0);
  assert.equal(result.nomailGenerated, 1);
});

test('onProgress/onItemDone werden pro Job aufgerufen', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const storage = new JsonStore(dir);
  const jobs = [job(), job()];
  const finder = fakeFinder();
  const progress: number[] = [];
  const done: string[] = [];

  await runAnschreiben({
    jobs, storage, profile, emailFinder: finder,
    generate: async () => '/tmp/does-not-matter.txt',
    onProgress: (i) => progress.push(i),
    onItemDone: item => done.push(item.state),
  });

  assert.deepEqual(progress, [0, 1]);
  assert.deepEqual(done, ['done', 'done']);
});
