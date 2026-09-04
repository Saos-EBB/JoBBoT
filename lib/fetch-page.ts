const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// finalUrl ist die URL NACH allen Weiterleitungen (fetch folgt ihnen standardmässig).
// Nachgemessen: karriere.at beantwortet ein abgelaufenes Inserat nicht mit 404, sondern
// mit 200 auf einer Suchseite — /jobs/10024392 landet auf /jobs/wels. Ohne die finale
// URL ist so ein totes Inserat von einem lebenden nicht zu unterscheiden (siehe
// lib/offline-check.ts). Bei einem Fehler vor der Antwort (Timeout, DNS) fällt sie auf
// die angefragte URL zurück — dann sagt ohnehin `ok:false`, dass nichts gemessen wurde.
export async function fetchPage(url: string): Promise<{ ok: boolean; status: number; html: string; finalUrl: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'de-AT,de;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    const html = res.ok ? await res.text() : '';
    return { ok: res.ok, status: res.status, html, finalUrl: res.url };
  } catch {
    return { ok: false, status: 0, html: '', finalUrl: url };
  } finally {
    clearTimeout(timer);
  }
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
