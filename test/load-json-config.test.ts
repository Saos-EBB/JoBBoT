import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpDir, rmTmp } from './helpers.ts';
import { loadJsonConfig } from '../lib/load-json-config.ts';

async function tempConfigDir(t: { after: (fn: () => void) => void }) {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  return dir;
}

test('loadJsonConfig liest und parsed die Datei aus configDir', async (t) => {
  const configDir = await tempConfigDir(t);
  await writeFile(join(configDir, 'thing.json'), JSON.stringify({ a: 1 }), 'utf8');
  assert.deepEqual(loadJsonConfig(configDir, 'thing.json'), { a: 1 });
});

test('ohne onMissing propagiert eine fehlende Datei den nativen fs-Fehler', async (t) => {
  const configDir = await tempConfigDir(t);
  assert.throws(() => loadJsonConfig(configDir, 'missing.json'), /ENOENT/);
});

test('mit onMissing wird die fehlende Datei zur eigenen Fehlermeldung', async (t) => {
  const configDir = await tempConfigDir(t);
  assert.throws(
    () => loadJsonConfig(configDir, 'missing.json', { onMissing: p => `${p} fehlt.` }),
    /missing\.json fehlt\.$/,
  );
});

test('ohne wrapParseErrors propagiert kaputtes JSON den nativen SyntaxError', async (t) => {
  const configDir = await tempConfigDir(t);
  await writeFile(join(configDir, 'broken.json'), '{not json', 'utf8');
  assert.throws(
    () => loadJsonConfig(configDir, 'broken.json', { onMissing: () => 'sollte hier nicht greifen' }),
    SyntaxError,
  );
});

test('mit wrapParseErrors greift onMissing auch bei kaputtem JSON', async (t) => {
  const configDir = await tempConfigDir(t);
  await writeFile(join(configDir, 'broken.json'), '{not json', 'utf8');
  assert.throws(
    () => loadJsonConfig(configDir, 'broken.json', { onMissing: p => `${p} kaputt`, wrapParseErrors: true }),
    /broken\.json kaputt$/,
  );
});

test('mkdir-losigkeit des configDir selbst zaehlt ebenfalls als "missing"', async (t) => {
  const dir = await tmpDir();
  t.after(() => rmTmp(dir));
  const nichtVorhanden = join(dir, 'nope');
  assert.throws(
    () => loadJsonConfig(nichtVorhanden, 'x.json', { onMissing: p => `${p} fehlt.` }),
    /x\.json fehlt\.$/,
  );
});
