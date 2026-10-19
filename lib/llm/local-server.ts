// Gemeinsamer Ablauf "lokalen LLM-Server bei Bedarf hochfahren" für alle Backends mit
// eigenem Serverprozess (llama.cpp). Das Backend liefert nur, wie man "läuft?" fragt
// und wie man startet.

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];

export async function probe(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

// Läuft der Server schon → fertig. Sonst (nur lokale Hosts) start() und warten, bis er
// antwortet. Wirft mit klarer Meldung statt später mit einem kryptischen "fetch failed".
export async function ensureLocalServer(opts: {
  label: string;
  host: string;
  isUp: (host: string) => Promise<boolean>;
  start: () => void;
  timeoutMs: number;
  // Was der User zum Nachsehen tun kann, z. B. "Log: data/llama-server.log".
  statusHint: string;
}): Promise<void> {
  const { label, host, isUp, start, timeoutMs, statusHint } = opts;
  if (await isUp(host)) return;
  const { hostname } = new URL(host);
  if (!LOCAL_HOSTS.includes(hostname)) {
    throw new Error(`${label} unter ${host} nicht erreichbar (Remote-Host, kein Autostart)`);
  }
  start();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 500));
    if (await isUp(host)) return;
  }
  throw new Error(`${label} nicht erreichbar: ${host} — Start versucht, keine Antwort nach ${Math.round(timeoutMs / 1000)}s (${statusHint})`);
}
