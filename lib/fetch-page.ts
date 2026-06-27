const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

export async function fetchPage(url: string): Promise<{ ok: boolean; status: number; html: string }> {
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
    return { ok: res.ok, status: res.status, html };
  } catch {
    return { ok: false, status: 0, html: '' };
  } finally {
    clearTimeout(timer);
  }
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
