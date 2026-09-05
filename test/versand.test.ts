import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { versende } from '../lib/versand.ts';
import type { MailTransport, ComposedEmail } from '../mail/transport.ts';
import { anschreibenName } from '../lib/anschreiben-datei.ts';
import { createStorage } from '../storage/index.ts';
import { toJob } from '../lib/normalize.ts';
import type { Job } from '../scrapers/interface.ts';
import type { ProfileData } from '../lib/profile.ts';
import { tmpDir, rmTmp } from './helpers.ts';

const profile = { name: 'Test Person' } as ProfileData;

function fakeTransport() {
  const zugestellt: { weg: 'entwurf' | 'senden'; email: ComposedEmail }[] = [];
  const transport: MailTransport = {
    name: 'fake',
    async entwurf(email) { zugestellt.push({ weg: 'entwurf', email }); },
    async sende(email) { zugestellt.push({ weg: 'senden', email }); },
  };
  return { transport, zugestellt };
}

function werfenderTransport(): MailTransport {
  return {
    name: 'kaputt',
    async entwurf() { throw new Error('IMAP weg'); },
    async sende() { throw new Error('SMTP weg'); },
  };
}

// versende() liest das Anschreiben über cwd-relative Pfade (config.anschreibenDir),
// genau wie im Betrieb. Deshalb ein echtes Arbeitsverzeichnis statt Mocks — dann prüft
// der Test denselben Weg, den der Server geht. process.chdir() ist globaler Zustand;
// node --test führt jede Datei in einem eigenen Prozess aus, t.after() stellt es zurück.
async function arbeitsplatz(t: { after: (fn: () => void) => void }, job: Job, mitBrief = true) {
  const dir = await tmpDir();
  const zurueck = process.cwd();
  t.after(() => { process.chdir(zurueck); rmTmp(dir); });
  await mkdir(join(dir, 'data', 'anschreiben'), { recursive: true });
  await mkdir(join(dir, 'data', 'jobs'), { recursive: true });
  if (mitBrief) {
    await writeFile(join(dir, 'data', 'anschreiben', `${anschreibenName(job)}.md`), 'Der Brieftext.', 'utf8');
  }
  process.chdir(dir);
  const storage = createStorage();
  await storage.save(job);
  return { dir, storage };
}

const bewerbung = (over: Partial<Job> = {}): Job => ({
  ...toJob({
    source: 'karriere.at',
    url: 'https://www.karriere.at/jobs/1',
    title: 'Junior Developer',
    company: 'Test GmbH',
    description: 'x',
  }),
  status: 'freigegeben',
  email: 'jobs@test.at',
  ...over,
});

test('Entwurf: Status wird "postausgang", sentAt bleibt leer', async (t) => {
  const job = bewerbung();
  const { storage } = await arbeitsplatz(t, job);
  const { transport, zugestellt } = fakeTransport();

  const updated = await versende({ job, art: 'bewerbung', weg: 'entwurf', storage, profile, transport });

  assert.equal(updated.status, 'postausgang');
  assert.equal(updated.sentAt ?? null, null);
  assert.equal(zugestellt.length, 1);
  assert.equal(zugestellt[0].weg, 'entwurf');
  assert.equal(zugestellt[0].email.to, 'jobs@test.at');
  assert.match(zugestellt[0].email.text, /Der Brieftext\./);
  assert.equal((await storage.get(job.id))?.status, 'postausgang');
});

test('Senden: Status wird "gesendet" UND sentAt gesetzt', async (t) => {
  const job = bewerbung();
  const { storage } = await arbeitsplatz(t, job);
  const { transport, zugestellt } = fakeTransport();
  const jetzt = new Date('2026-09-05T09:00:00.000Z');

  const updated = await versende({ job, art: 'bewerbung', weg: 'senden', storage, profile, transport, now: () => jetzt });

  assert.equal(updated.status, 'gesendet');
  assert.equal(updated.sentAt, jetzt.toISOString());
  assert.equal(zugestellt[0].weg, 'senden');
  const gespeichert = await storage.get(job.id);
  assert.equal(gespeichert?.status, 'gesendet');
  assert.equal(gespeichert?.sentAt, jetzt.toISOString());
});

// Ein Nachfass ist kein neuer Zustand, sondern ein weiterer Kontakt — die Bewerbung
// war schon gesendet und bleibt es.
test('Nachfass: Status bleibt unverändert, followUps wächst um genau einen Eintrag', async (t) => {
  const job = bewerbung({ status: 'gesendet', sentAt: '2026-09-01T08:00:00.000Z' });
  const { storage } = await arbeitsplatz(t, job);
  const { transport, zugestellt } = fakeTransport();
  const jetzt = new Date('2026-09-05T09:00:00.000Z');

  const updated = await versende({ job, art: 'nachfass', weg: 'senden', storage, profile, transport, now: () => jetzt });

  assert.equal(updated.status, 'gesendet');
  assert.equal(updated.sentAt, '2026-09-01T08:00:00.000Z');
  assert.deepEqual(updated.followUps, [{ at: jetzt.toISOString(), via: 'sent' }]);
  // Der Nachfass trägt den Brief NICHT noch einmal mit.
  assert.doesNotMatch(zugestellt[0].email.text, /Der Brieftext\./);
  assert.match(zugestellt[0].email.text, /nachfragen/);
});

test('Nachfass als Entwurf zählt mit — sonst bekäme derselbe Job beim nächsten Blick einen zweiten', async (t) => {
  const job = bewerbung({ status: 'gesendet', sentAt: '2026-09-01T08:00:00.000Z', followUps: [{ at: '2026-09-02T08:00:00.000Z', via: 'sent' }] });
  const { storage } = await arbeitsplatz(t, job);
  const { transport } = fakeTransport();

  const updated = await versende({ job, art: 'nachfass', weg: 'entwurf', storage, profile, transport, now: () => new Date('2026-09-05T09:00:00.000Z') });

  assert.equal(updated.followUps?.length, 2);
  assert.equal(updated.followUps?.at(-1)?.via, 'draft');
});

test('Nachfass benutzt denselben Betreff wie die Bewerbung — sonst reißt der Thread und der Antwort-Abgleich', async (t) => {
  const job = bewerbung({ status: 'gesendet' });
  const { storage } = await arbeitsplatz(t, job);
  const { transport, zugestellt } = fakeTransport();

  await versende({ job, art: 'nachfass', weg: 'senden', storage, profile, transport });

  assert.equal(zugestellt[0].email.subject, 'Bewerbung als Junior Developer bei Test GmbH');
});

test('ohne E-Mail-Adresse: sprechender Fehler, nichts zugestellt, Job unverändert', async (t) => {
  const job = bewerbung({ email: null });
  const { storage } = await arbeitsplatz(t, job);
  const { transport, zugestellt } = fakeTransport();

  await assert.rejects(
    versende({ job, art: 'bewerbung', weg: 'senden', storage, profile, transport }),
    /hat keine E-Mail-Adresse/,
  );
  assert.equal(zugestellt.length, 0);
  assert.equal((await storage.get(job.id))?.status, 'freigegeben');
});

test('ohne Anschreiben: sprechender Fehler, nichts zugestellt, Job unverändert', async (t) => {
  const job = bewerbung();
  const { storage } = await arbeitsplatz(t, job, false);
  const { transport, zugestellt } = fakeTransport();

  await assert.rejects(
    versende({ job, art: 'bewerbung', weg: 'senden', storage, profile, transport }),
    /hat kein Anschreiben/,
  );
  assert.equal(zugestellt.length, 0);
  assert.equal((await storage.get(job.id))?.status, 'freigegeben');
});

// Erst zustellen, dann den Job weiterdrehen: sonst stünde ein Job auf "gesendet",
// dessen Mail nie rausging.
test('scheitert die Zustellung, bleibt der Job stehen', async (t) => {
  const job = bewerbung();
  const { storage } = await arbeitsplatz(t, job);

  await assert.rejects(
    versende({ job, art: 'bewerbung', weg: 'senden', storage, profile, transport: werfenderTransport() }),
    /SMTP weg/,
  );
  const gespeichert = await storage.get(job.id);
  assert.equal(gespeichert?.status, 'freigegeben');
  assert.equal(gespeichert?.sentAt ?? null, null);
});

test('CC und Anhang liegen der Nachricht bei, nicht dem Transport', async (t) => {
  const job = bewerbung();
  const { dir, storage } = await arbeitsplatz(t, job);
  await mkdir(join(dir, 'data', 'attachments'), { recursive: true });
  await writeFile(join(dir, 'data', 'attachments', 'lebenslauf.pdf'), '%PDF-1.4', 'utf8');
  await writeFile(join(dir, 'data', 'cc.json'), JSON.stringify({ email: 'kopie@test.at' }), 'utf8');
  const { transport, zugestellt } = fakeTransport();

  await versende({ job, art: 'bewerbung', weg: 'entwurf', storage, profile, transport });

  assert.equal(zugestellt[0].email.cc, 'kopie@test.at');
  assert.deepEqual(zugestellt[0].email.attachments, [
    { filename: 'Lebenslauf.pdf', path: join('data', 'attachments', 'lebenslauf.pdf') },
  ]);
});

test('jede der vier Kombinationen schreibt ihre eigene Zeile ins Mail-Log', async (t) => {
  const job = bewerbung({ status: 'gesendet', sentAt: '2026-09-01T08:00:00.000Z' });
  const { dir, storage } = await arbeitsplatz(t, job);
  const logPath = join(dir, 'mail-log.md');
  const { transport } = fakeTransport();

  await versende({ job, art: 'bewerbung', weg: 'entwurf', storage, profile, transport, logPath });
  await versende({ job, art: 'bewerbung', weg: 'senden', storage, profile, transport, logPath });
  await versende({ job, art: 'nachfass', weg: 'entwurf', storage, profile, transport, logPath });
  await versende({ job, art: 'nachfass', weg: 'senden', storage, profile, transport, logPath });

  const log = await readFile(logPath, 'utf8');
  for (const aktion of ['drafted', 'sent', 'followup-drafted', 'followup-sent']) {
    assert.match(log, new RegExp(`: ${aktion} — Junior Developer — Test GmbH`));
  }
});
