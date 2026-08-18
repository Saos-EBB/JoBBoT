import { createHash } from 'node:crypto';

// Legal-form suffixes commonly seen at the end of AT/DE company names, longest first
// so "gmbh & co kg" is stripped as one unit rather than leaving a dangling "& co kg".
const LEGAL_FORM_RE = /\s*[,.]?\s*\b(gmbh\s*(?:&|und)\s*co\s*kg|gesmbh|gmbh|mbh|co\s*kg|ohg|ag|kg|og|e\.?u\.?)\b\.?\s*$/i;

// Gender markers in job titles, e.g. "(m/w/d)", "w-m-d", "m/f/x" — any order/punctuation,
// stripped rather than canonicalized since they carry no disambiguating information.
const GENDER_MARKER_RE = /\(?\b[mwfdx](?:[/-][mwfdx]){1,3}\b\)?/gi;

// German gender suffixes glued to the noun: "Entwickler:in", "Expert*in", "Kolleg_innen".
// Anchored on the punctuation, so a word that merely ends in "in" (Berlin, Marketing)
// is untouched. Must run BEFORE punctuation is stripped, or the anchor is gone.
const GENDER_SUFFIX_RE = /([\p{L}])[:*_/]in(?:nen)?\b/giu;

function stripDiacritics(s: string): string {
  return s.replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Punctuation collapses to a single space instead of surviving verbatim. Real case from
// the data: karriere.at listed "Technical Support Engineer (m/w/d) – 1st Level" while
// jobs.at listed the same posting without the en dash — collapsing only whitespace left
// two different ids, so the pair never showed up as a duplicate.
function normalizeTitle(s: string): string {
  return s
    .replace(GENDER_MARKER_RE, ' ')
    .replace(GENDER_SUFFIX_RE, '$1')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function normalizeCompany(s: string): string {
  return stripDiacritics(s)
    .replace(LEGAL_FORM_RE, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function jobId(j: { title: string; company: string }): string {
  // JSON.stringify prevents separator-injection collisions (e.g. 'a|b'+'c' == 'a'+'b|c')
  return createHash('sha256')
    .update(JSON.stringify([normalizeTitle(j.title), normalizeCompany(j.company)]))
    .digest('hex')
    .slice(0, 16);
}
