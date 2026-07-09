const SCRIPT_STYLE_RE = /<(script|style)[^>]*>[\s\S]*?<\/\1>/gi;
const HEADING_RE = /<h[1-6](?:\s[^<>]*)?\s*\/?>/gi;
const LIST_ITEM_RE = /<li(?:\s[^<>]*)?\s*\/?>/gi;
const BLOCK_BREAK_RE = /<(?:br|p|div|ul|ol)(?:\s[^<>]*)?\s*\/?>/gi;
// öffnend ODER schließend, und tolerant gegenüber einem fehlenden schließenden ">"
// am Stringende (abgeschnittenes "</ul" aus kaputten Scrapes)
const ANY_TAG_RE = /<\/?[a-zA-Z][^<>]*>?/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…',
};

// Genau EIN Durchlauf über den Text — .replace() scannt seine eigene Ausgabe nicht
// erneut, "&amp;amp;" wird also zu "&amp;" (ein Level entschärft) statt zu "&".
function decodeEntitiesOnce(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const isHex = code[1]?.toLowerCase() === 'x';
      const num = parseInt(code.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(num) ? String.fromCodePoint(num) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

export function normalizeDescription(html: string): string {
  let text = html;

  // (a) script/style samt Inhalt entfernen
  text = text.replace(SCRIPT_STYLE_RE, '');

  // (b) Struktur in Textmarker übersetzen — nur öffnende Tags; schließende Tags
  // fallen in (c) einfach weg, das reicht für Fließtext
  text = text.replace(HEADING_RE, '\n\n## ');
  text = text.replace(LIST_ITEM_RE, '\n- ');
  text = text.replace(BLOCK_BREAK_RE, '\n');

  // (c) restliche Tags strippen, auch abgeschnittene wie "</ul" ohne ">"
  text = text.replace(ANY_TAG_RE, '');

  // (d) Entities GENAU EINMAL dekodieren — erst NACH dem Tag-Stripping, sonst würde
  // aus "&lt;script&gt;" wieder echtes Markup
  text = decodeEntitiesOnce(text);

  // (e) Zeilen trimmen, 3+ Leerzeilen auf 2 kollabieren
  text = text.split('\n').map(line => line.trim()).join('\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}
