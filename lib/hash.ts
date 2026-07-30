import { createHash } from 'node:crypto';

// Legal-form suffixes commonly seen at the end of AT/DE company names, longest first
// so "gmbh & co kg" is stripped as one unit rather than leaving a dangling "& co kg".
const LEGAL_FORM_RE = /\s*[,.]?\s*\b(gmbh\s*(?:&|und)\s*co\s*kg|gesmbh|gmbh|mbh|co\s*kg|ohg|ag|kg|og|e\.?u\.?)\b\.?\s*$/i;

// Gender markers in job titles, e.g. "(m/w/d)", "w-m-d", "m/f/x" — any order/punctuation,
// stripped rather than canonicalized since they carry no disambiguating information.
const GENDER_MARKER_RE = /\(?\b[mwfdx](?:[/-][mwfdx]){1,3}\b\)?/gi;

function stripDiacritics(s: string): string {
  return s.replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normalizeTitle(s: string): string {
  return s.replace(GENDER_MARKER_RE, ' ').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeCompany(s: string): string {
  return stripDiacritics(s).replace(LEGAL_FORM_RE, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function jobId(j: { title: string; company: string }): string {
  // JSON.stringify prevents separator-injection collisions (e.g. 'a|b'+'c' == 'a'+'b|c')
  return createHash('sha256')
    .update(JSON.stringify([normalizeTitle(j.title), normalizeCompany(j.company)]))
    .digest('hex')
    .slice(0, 16);
}
