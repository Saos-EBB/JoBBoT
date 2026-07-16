import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createStorage } from '../storage/index.ts';
import { config } from '../config.ts';
import { jobBasename } from '../lib/slugify.ts';
import { loadProfile } from '../lib/profile.ts';
import { composeEmail, createDraft, sendMail, logMailAction, type ComposedEmail } from '../mail/gmail.ts';
import { ATTACHMENT_PATH, ATTACHMENT_FILENAME } from '../lib/attachment.ts';
import type { Job, JobStatus } from '../scrapers/interface.ts';

const PORT = Number(process.env.UI_PORT ?? 3000);
const STATUSES: JobStatus[] = ['new', 'filtered_out', 'uncertain', 'matched', 'generated', 'freigegeben', 'postausgang', 'gesendet', 'geloescht', 'fehler'];
const storage = createStorage();
const profile = loadProfile();

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function layout(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>JobBot</title>
<style>
:root {
  --paper: #f6f7fb; --paper-raised: #ffffff; --ink: #1b1f2a; --muted: #5b6272; --line: #dfe2ea;
  --accent: #4338ca; --accent-ink: #ffffff; --success: #15803d; --success-bg: #e8f5ec;
  --danger: #b91c1c; --danger-bg: #fbe9e9; --amber: #92400e; --amber-bg: #fdf1de;
  --sans: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --mono: ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #12141c; --paper-raised: #1a1d27; --ink: #e6e8f0; --muted: #9aa0b4; --line: #2a2e3b;
    --accent: #818cf8; --accent-ink: #12141c; --success: #4ade80; --success-bg: #16281d;
    --danger: #f87171; --danger-bg: #2c1616; --amber: #fbbf6a; --amber-bg: #2c2210;
  }
}
* { box-sizing: border-box; }
body { font-family: var(--sans); background: var(--paper); color: var(--ink); max-width: 720px; margin: 2.5rem auto; padding: 0 1.25rem 6rem; }
a { color: var(--accent); text-decoration: none; } a:hover { text-decoration: underline; }
h1 { font-size: 1.7rem; margin: 0.2rem 0 0; } h3 { font-size: 1.05rem; margin: 2.2rem 0 0.7rem; }
.meta-label { font-family: var(--mono); font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
pre { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--paper-raised); border: 1px solid var(--line); padding: 1rem; border-radius: 6px; }
form { margin-top: 1rem; }
select, input[type="email"] { font-family: var(--sans); font-size: 0.9rem; color: var(--ink); background: var(--paper-raised); border: 1px solid var(--line); border-radius: 6px; padding: 0.4rem 0.6rem; }
button { font-family: var(--sans); font-size: 0.88rem; font-weight: 600; cursor: pointer; border-radius: 6px; padding: 0.45rem 0.85rem; border: 1px solid var(--line); background: transparent; color: var(--ink); }
button.primary { background: var(--accent); color: var(--accent-ink); border-color: transparent; }
button.danger { background: var(--danger); color: #fff; border-color: transparent; }
.mail-card { background: var(--paper-raised); border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 10px; padding: 1.1rem 1.3rem 1.3rem; margin-top: 0.7rem; display: flex; flex-direction: column; gap: 1rem; }
.field-row { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
.field-row input[type="email"] { flex: 1; min-width: 220px; font-family: var(--mono); }
.letter { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; font-family: var(--mono); font-size: 0.82rem; line-height: 1.6; overflow-x: auto; }
.letter dl { margin: 0; padding: 0.7rem 0.9rem; border-bottom: 1px solid var(--line); display: grid; grid-template-columns: auto 1fr; gap: 0.15rem 0.6rem; }
.letter dt { color: var(--muted); } .letter dd { margin: 0; }
.letter .body { padding: 0.9rem; white-space: pre-wrap; }
.action-row { display: flex; gap: 0.6rem; align-items: center; flex-wrap: wrap; }
.action-hint { font-size: 0.78rem; color: var(--muted); }
.locked { background: var(--paper); border: 1px dashed var(--line); border-radius: 8px; padding: 0.9rem 1rem; color: var(--muted); font-size: 0.88rem; margin-top: 0.7rem; }
.empty-email { background: var(--amber-bg); color: var(--amber); border-radius: 8px; padding: 0.8rem 1rem; font-size: 0.88rem; margin-top: 0.7rem; }
.banner-error { background: var(--danger-bg); color: var(--danger); border-radius: 8px; padding: 0.8rem 1rem; font-size: 0.88rem; margin-top: 1rem; }
.banner-done { background: var(--success-bg); color: var(--success); border-radius: 8px; padding: 0.8rem 1rem; font-size: 0.88rem; margin-top: 0.7rem; }
</style></head><body>${body}</body></html>`;
}

async function readCoverLetter(job: { title: string; company: string; postedAt?: string | null; scrapedAt: string; id: string }): Promise<string | null> {
  try {
    return await readFile(join(config.anschreibenDir, `${jobBasename(job)}.md`), 'utf8');
  } catch {
    return null;
  }
}

function renderLetter(email: ComposedEmail): string {
  return `<div class="letter">
    <dl><dt>An</dt><dd>${esc(email.to)}</dd><dt>Betreff</dt><dd>${esc(email.subject)}</dd></dl>
    <div class="body">${esc(email.text)}</div>
  </div>`;
}

async function renderMailSection(job: Job, error: string | null): Promise<string> {
  const errorBanner = error ? `<div class="banner-error">${esc(error)}</div>` : '';

  if (job.status === 'gesendet') {
    return `<h3>E-Mail</h3><div class="banner-done">Gesendet an ${esc(job.email ?? '')}.</div>${errorBanner}`;
  }
  if (job.status === 'postausgang') {
    return `<h3>E-Mail</h3><div class="banner-done">Als Gmail-Entwurf gespeichert (an ${esc(job.email ?? '')}). Versand erfolgt manuell in Gmail.</div>${errorBanner}`;
  }
  if (job.status !== 'freigegeben') {
    return `<h3>E-Mail</h3><div class="locked">Versand gesperrt, bis der Status auf <code>freigegeben</code> gesetzt ist.</div>${errorBanner}`;
  }

  const emailForm = `<form class="field-row" method="post" action="/job/${job.id}/email">
    <label for="mail-to">an</label>
    <input id="mail-to" name="email" type="email" value="${esc(job.email ?? '')}" placeholder="bewerbung@firma.at" required />
    <button type="submit">Speichern</button>
  </form>`;

  if (!job.email) {
    return `<h3>E-Mail</h3><div class="empty-email">Keine E-Mail-Adresse gefunden — weder im Inserat noch auf firmenabc.at.${emailForm}</div>${errorBanner}`;
  }

  let preview = '';
  try {
    preview = renderLetter(await composeEmail(job, profile));
  } catch {
    preview = '<p class="action-hint">Vorschau nicht verfügbar (Anschreiben fehlt).</p>';
  }

  return `<h3>E-Mail</h3>
    <div class="mail-card">
      ${emailForm}
      ${preview}
      <div class="action-row">
        <form method="post" action="/job/${job.id}/draft">
          <button type="submit" class="primary">Entwurf erstellen</button>
        </form>
        <form method="post" action="/job/${job.id}/send" onsubmit="return confirm('Wirklich an ${esc(job.email)} senden?')">
          <button type="submit" class="danger">Direkt senden</button>
        </form>
        <span class="action-hint">Entwurf = jederzeit löschbar in Gmail. Senden fragt vorher nochmal nach.</span>
      </div>
    </div>
    ${errorBanner}`;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><meta charset="utf-8"><title>JobBot</title></head>'
      + '<body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/jobs') {
    const jobs = await storage.list();
    // brief lebt in data/anschreiben/{slug}.md, nicht im Job-JSON (siehe readCoverLetter
    // oben) — hier server-seitig gejoint, damit die Liste im Client die Anschreiben-
    // Vorschau zeigen kann, ohne 282 Einzel-Requests zu feuern. Der Join ist reines
    // Lesen; SPEICHERN einer Bearbeitung ist ein eigener Schreibpfad (anderer Endpunkt,
    // eigener Schritt), weil das Anschreiben nicht Teil des Job-Records ist.
    const withBriefs = await Promise.all(jobs.map(async job => ({ ...job, brief: await readCoverLetter(job) })));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(withBriefs));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/attachment') {
    try {
      const st = await stat(ATTACHMENT_PATH);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ filename: ATTACHMENT_FILENAME, size: st.size, uploadedAt: st.mtime.toISOString() }));
    } catch {
      res.writeHead(404).end();
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/attachment') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const buf = Buffer.concat(chunks);
    if (buf.length > MAX_ATTACHMENT_BYTES) {
      res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Datei zu groß (max. 10 MB)' }));
      return;
    }
    // Magic Bytes statt Dateiendung/Content-Type — beide sind Client-Angaben und
    // damit nicht vertrauenswürdig genug, um sie ungeprüft in einen Mail-Anhang
    // zu übernehmen.
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'Keine gültige PDF-Datei' }));
      return;
    }
    await mkdir(config.attachmentsDir, { recursive: true });
    await writeFile(ATTACHMENT_PATH, buf);
    const st = await stat(ATTACHMENT_PATH);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ filename: ATTACHMENT_FILENAME, size: st.size, uploadedAt: st.mtime.toISOString() }));
    return;
  }

  if (req.method === 'DELETE' && url.pathname === '/api/attachment') {
    await unlink(ATTACHMENT_PATH).catch(() => {});
    res.writeHead(204).end();
    return;
  }

  const jobPatchMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9]+)$/);
  if (req.method === 'POST' && jobPatchMatch) {
    const job = await storage.get(jobPatchMatch[1]);
    if (!job) { res.writeHead(404).end('Job nicht gefunden'); return; }
    let body = '';
    for await (const chunk of req) body += chunk;
    // Nur status/fit sind hier gemeint (Aktionen entlang der Statusmaschine im UI) —
    // keine serverseitige Allowlist, weil dieser Server nur lokal auf localhost läuft
    // und der Client (ui/app.tsx) ohnehin nie andere Felder schickt.
    const patch = JSON.parse(body) as Partial<Pick<Job, 'status' | 'fit'>>;
    const updated = await storage.update(job.id, patch);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(updated));
    return;
  }

  const apiDraftMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9]+)\/draft$/);
  if (req.method === 'POST' && apiDraftMatch) {
    const job = await storage.get(apiDraftMatch[1]);
    if (!job) { res.writeHead(404).end('Job nicht gefunden'); return; }
    try {
      const email = await composeEmail(job, profile);
      await createDraft(email);
      const updated = await storage.updateStatus(job.id, 'postausgang');
      await logMailAction(job, 'drafted');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(updated));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: `Entwurf fehlgeschlagen: ${message}` }));
    }
    return;
  }

  const apiSendMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9]+)\/send$/);
  if (req.method === 'POST' && apiSendMatch) {
    const job = await storage.get(apiSendMatch[1]);
    if (!job) { res.writeHead(404).end('Job nicht gefunden'); return; }
    try {
      const email = await composeEmail(job, profile);
      await sendMail(email);
      const updated = await storage.updateStatus(job.id, 'gesendet');
      await logMailAction(job, 'sent');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(updated));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: `Versand fehlgeschlagen: ${message}` }));
    }
    return;
  }

  const briefMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9]+)\/brief$/);
  if (req.method === 'POST' && briefMatch) {
    const job = await storage.get(briefMatch[1]);
    if (!job) { res.writeHead(404).end('Job nicht gefunden'); return; }
    let body = '';
    for await (const chunk of req) body += chunk;
    const { text } = JSON.parse(body) as { text: string };
    // Gegenstück zum Join in GET /api/jobs: brief lebt in data/anschreiben/{slug}.md,
    // nicht im Job-JSON, also schreibt eine Bearbeitung dorthin statt über
    // storage.update() — ein Status-Wechsel und eine Anschreiben-Bearbeitung sind zwei
    // unabhängige Schreibpfade, die zufällig denselben Job betreffen.
    await writeFile(join(config.anschreibenDir, `${jobBasename(job)}.md`), text, 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/app.js') {
    try {
      const js = await readFile(join(import.meta.dirname, '..', 'ui', 'dist', 'app.js'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      res.end(js);
    } catch {
      res.writeHead(404).end('app.js nicht gebaut — npm run build:ui');
    }
    return;
  }

  const jobMatch = url.pathname.match(/^\/job\/([a-f0-9]+)$/);
  if (req.method === 'GET' && jobMatch) {
    const job = await storage.get(jobMatch[1]);
    if (!job) { res.writeHead(404).end('Job nicht gefunden'); return; }
    const cover = await readCoverLetter(job);
    const options = STATUSES.map(s => `<option value="${s}" ${s === job.status ? 'selected' : ''}>${s}</option>`).join('');
    const error = url.searchParams.get('error');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(layout(`
      <p><a href="/">&larr; zurück</a></p>
      <h1>${esc(job.title)}</h1>
      <p><strong>${esc(job.company)}</strong> — ${esc(job.location ?? '')} — <a href="${esc(job.url)}" target="_blank">Anzeige</a></p>
      <form method="post" action="/job/${job.id}/status">
        <select name="status">${options}</select>
        <button type="submit">Status ändern</button>
      </form>
      ${job.match ? `<h3>Match</h3><pre>${esc(JSON.stringify(job.match, null, 2))}</pre>` : ''}
      ${cover ? `<h3>Anschreiben</h3><pre>${esc(cover)}</pre>` : ''}
      ${await renderMailSection(job, error)}
      <h3>Beschreibung</h3>
      <pre>${esc(job.description)}</pre>
    `));
    return;
  }

  const statusMatch = url.pathname.match(/^\/job\/([a-f0-9]+)\/status$/);
  if (req.method === 'POST' && statusMatch) {
    let body = '';
    for await (const chunk of req) body += chunk;
    const status = new URLSearchParams(body).get('status') as JobStatus | null;
    if (status && STATUSES.includes(status)) await storage.updateStatus(statusMatch[1], status);
    res.writeHead(302, { Location: `/job/${statusMatch[1]}` });
    res.end();
    return;
  }

  const emailMatch = url.pathname.match(/^\/job\/([a-f0-9]+)\/email$/);
  if (req.method === 'POST' && emailMatch) {
    let body = '';
    for await (const chunk of req) body += chunk;
    const email = new URLSearchParams(body).get('email');
    if (email) await storage.update(emailMatch[1], { email });
    res.writeHead(302, { Location: `/job/${emailMatch[1]}` });
    res.end();
    return;
  }

  const draftMatch = url.pathname.match(/^\/job\/([a-f0-9]+)\/draft$/);
  if (req.method === 'POST' && draftMatch) {
    const job = await storage.get(draftMatch[1]);
    if (!job) { res.writeHead(404).end('Job nicht gefunden'); return; }
    try {
      const email = await composeEmail(job, profile);
      await createDraft(email);
      await storage.updateStatus(job.id, 'postausgang');
      await logMailAction(job, 'drafted');
      res.writeHead(302, { Location: `/job/${job.id}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(302, { Location: `/job/${job.id}?error=${encodeURIComponent(`Entwurf fehlgeschlagen: ${message}`)}` });
    }
    res.end();
    return;
  }

  const sendMatch = url.pathname.match(/^\/job\/([a-f0-9]+)\/send$/);
  if (req.method === 'POST' && sendMatch) {
    const job = await storage.get(sendMatch[1]);
    if (!job) { res.writeHead(404).end('Job nicht gefunden'); return; }
    try {
      const email = await composeEmail(job, profile);
      await sendMail(email);
      await storage.updateStatus(job.id, 'gesendet');
      await logMailAction(job, 'sent');
      res.writeHead(302, { Location: `/job/${job.id}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(302, { Location: `/job/${job.id}?error=${encodeURIComponent(`Versand fehlgeschlagen: ${message}`)}` });
    }
    res.end();
    return;
  }

  res.writeHead(404).end('Not found');
});

server.listen(PORT, () => console.log(`JobBot UI: http://localhost:${PORT}`));
