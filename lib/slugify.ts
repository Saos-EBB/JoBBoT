function normalize(text: string): string {
  return text.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Für Dateinamen: gekürzt, weil Pfade eine Grenze haben.
export function slugify(text: string): string {
  const s = normalize(text);
  return s.length > 40 ? s.slice(0, 40).replace(/-+$/, '') : s;
}

// Für Such-URLs (karriere.at /jobs/<slug>, jobs.at /j/<slug>): identisch, aber OHNE
// Kürzung. Die 40-Zeichen-Grenze ist eine Dateisystem-Rücksicht und hätte einen langen
// Suchbegriff still abgeschnitten ("junior fullstack javascript typescript entwickler").
//
// Beide Portale hatten vorher je eine eigene Variante — karriere.at ersetzte nur
// Leerzeichen und liess Umlaute stehen. Nachgemessen ist das folgenlos (karriere.at
// liefert für "bürokauffrau" und "buerokauffrau" dieselben 630+ Treffer), aber zwei
// Funktionen hiessen zwei Formatbezeichner im querySchema für etwas, das aus Nutzersicht
// dasselbe ist.
export function searchSlug(text: string): string {
  return normalize(text);
}

export function jobBasename(job: {
  title: string;
  company: string;
  postedAt?: string | null;
  scrapedAt: string;
  id: string;
}): string {
  const dateStr = (job.postedAt ?? job.scrapedAt).slice(0, 10);
  return `${slugify(job.title)}_${slugify(job.company)}_${dateStr}_${job.id.slice(0, 8)}`;
}
