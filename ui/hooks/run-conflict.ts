// 409 eines Lauf-Starts in Klartext: derselbe Lauf läuft schon.
type Lauf = 'scrape' | 'filter' | 'anschreiben';
const NAME: Record<Lauf, string> = { scrape: 'Scrape', filter: 'Filter', anschreiben: 'Anschreiben-Lauf' };

export function konfliktMeldung(lauf: Lauf): string {
  return `${NAME[lauf]} läuft bereits`;
}
