import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkOnline, type PageFetcher, type PageResult } from '../lib/offline-check.ts';

// Fake statt Netz: die Prüfung selbst ist eine Regelentscheidung über eine
// HTTP-Antwort, das echte Portal trägt zur Aussage nichts bei.
function antwort(res: Partial<PageResult> & { finalUrl?: string }): PageFetcher {
  return async (url: string) => ({
    ok: res.ok ?? false,
    status: res.status ?? 0,
    html: res.html ?? '',
    finalUrl: res.finalUrl ?? url,
  });
}

const karriere = { source: 'karriere.at', url: 'https://www.karriere.at/jobs/10024392' };
const linkedin = { source: 'linkedin', url: 'https://at.linkedin.com/jobs/view/irgendwas-4441961604' };

// ── Was auf jeder Quelle gilt ────────────────────────────────────────────────

test('404 → offline, egal welche Quelle', async () => {
  assert.equal(await checkOnline(karriere, antwort({ status: 404 })), 'offline');
  assert.equal(await checkOnline(linkedin, antwort({ status: 404 })), 'offline');
});

test('410 Gone → offline', async () => {
  assert.equal(await checkOnline(linkedin, antwort({ status: 410 })), 'offline');
});

// Der teuerste denkbare Fehler: devjobs.at hat beim Nachmessen auf den ERSTEN
// Request mit 429 geantwortet. Würde das als "offline" gelesen, archivierte ein
// einziger gedrosselter Lauf reihenweise lebende Jobs.
test('429 Rate-Limit → unbekannt, niemals offline', async () => {
  const devjobs = { source: 'devjobs.at', url: 'https://www.devjobs.at/job/abc' };
  assert.equal(await checkOnline(devjobs, antwort({ status: 429 })), 'unbekannt');
});

test('Timeout/Netzfehler (status 0) → unbekannt', async () => {
  assert.equal(await checkOnline(karriere, antwort({ status: 0 })), 'unbekannt');
});

test('500 und 403 → unbekannt (Serverfehler bzw. Bot-Schutz, kein gelöschtes Inserat)', async () => {
  assert.equal(await checkOnline(linkedin, antwort({ status: 500 })), 'unbekannt');
  assert.equal(await checkOnline(linkedin, antwort({ status: 403 })), 'unbekannt');
});

// ── karriere.at: der einzige nachgemessene Marker ────────────────────────────

test('karriere.at: 200 auf derselben Inserats-URL → online', async () => {
  const v = await checkOnline(karriere, antwort({ ok: true, status: 200 }));
  assert.equal(v, 'online');
});

// Der real gemessene Fall: /jobs/10024392 antwortet mit 200, landet aber auf der
// Suchseite /jobs/wels. Ohne finalUrl wäre das von einem lebenden Inserat nicht
// zu unterscheiden.
test('karriere.at: 200, aber auf die Suchseite umgeleitet → offline', async () => {
  const v = await checkOnline(karriere, antwort({
    ok: true, status: 200, finalUrl: 'https://www.karriere.at/jobs/wels',
  }));
  assert.equal(v, 'offline');
});

test('karriere.at: angehängte Query macht ein lebendes Inserat nicht offline', async () => {
  const v = await checkOnline(karriere, antwort({
    ok: true, status: 200, finalUrl: 'https://www.karriere.at/jobs/10024392?utm_source=x',
  }));
  assert.equal(v, 'online');
});

test('karriere.at: URL ohne Job-Nummer → unbekannt statt geraten', async () => {
  const v = await checkOnline(
    { source: 'karriere.at', url: 'https://www.karriere.at/jobs/wels' },
    antwort({ ok: true, status: 200 }),
  );
  assert.equal(v, 'unbekannt');
});

// ── Quellen ohne nachgemessenen Marker ───────────────────────────────────────

// Ehrlich statt bequem: ein 200 von linkedin/jobs.at/devjobs.at heisst nur, dass die
// URL antwortet. Ob die Seite "nimmt keine Bewerbungen mehr an" sagt, wurde nie
// gemessen — also gibt es dafür keine Regel und keine Aussage.
test('Quelle ohne geprüften Marker: 200 → unbekannt, nicht "online"', async () => {
  assert.equal(await checkOnline(linkedin, antwort({ ok: true, status: 200 })), 'unbekannt');
});

test('unbekannte Quelle → unbekannt', async () => {
  const v = await checkOnline(
    { source: 'irgendwas-neues', url: 'https://example.com/job/1' },
    antwort({ ok: true, status: 200 }),
  );
  assert.equal(v, 'unbekannt');
});

test('die geprüfte URL ist die des Jobs', async () => {
  let gerufen: string | null = null;
  await checkOnline(karriere, async url => {
    gerufen = url;
    return { ok: true, status: 200, html: '', finalUrl: url };
  });
  assert.equal(gerufen, karriere.url);
});
