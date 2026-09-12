import type { IncomingMessage, ServerResponse } from 'node:http';
import { writeFile, mkdir, stat, unlink } from 'node:fs/promises';
import { config } from '../../config.ts';
import { ATTACHMENT_PATH, ATTACHMENT_FILENAME } from '../../lib/attachment.ts';
import { respondJson } from './http.ts';

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export async function handleAttachmentRoutes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method === 'GET' && url.pathname === '/api/attachment') {
    try {
      const st = await stat(ATTACHMENT_PATH);
      respondJson(res, 200, { filename: ATTACHMENT_FILENAME, size: st.size, uploadedAt: st.mtime.toISOString() });
    } catch {
      res.writeHead(404).end();
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/attachment') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const buf = Buffer.concat(chunks);
    if (buf.length > MAX_ATTACHMENT_BYTES) {
      respondJson(res, 413, { error: 'Datei zu groß (max. 10 MB)' });
      return true;
    }
    // Magic Bytes statt Dateiendung/Content-Type — beide sind Client-Angaben und
    // damit nicht vertrauenswürdig genug, um sie ungeprüft in einen Mail-Anhang
    // zu übernehmen.
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      respondJson(res, 400, { error: 'Keine gültige PDF-Datei' });
      return true;
    }
    await mkdir(config.attachmentsDir, { recursive: true });
    await writeFile(ATTACHMENT_PATH, buf);
    const st = await stat(ATTACHMENT_PATH);
    respondJson(res, 200, { filename: ATTACHMENT_FILENAME, size: st.size, uploadedAt: st.mtime.toISOString() });
    return true;
  }

  if (req.method === 'DELETE' && url.pathname === '/api/attachment') {
    await unlink(ATTACHMENT_PATH).catch(() => {});
    res.writeHead(204).end();
    return true;
  }

  return false;
}
