import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyReply, strongerKind, htmlToText } from '../lib/reply-kind.ts';

test('classifyReply: typische Absagen', () => {
  const absagen = [
    'Leider müssen wir Ihnen mitteilen, dass wir Ihre Bewerbung nicht weiter berücksichtigen können.',
    'Wir haben uns für einen anderen Kandidaten entschieden.',
    'Nach sorgfältiger Prüfung haben wir uns leider gegen Ihre Bewerbung entschieden.',
    'Die Stelle wurde bereits besetzt.',
    'Sie sind leider nicht in die engere Auswahl gekommen.',
    'We regret to inform you that we will not move forward with your application.',
    'Unfortunately, we have decided to proceed with other candidates.',
    // Echte Formen aus dem Postfach (umformuliert), die die erste Fassung verpasst hat:
    'Leider können wir dir aktuell keine Praktikumsstelle anbieten.',
    'dass wir Sie im Auswahlprozess nicht\nweiter berücksichtigen können',
    'dass wir leider keine Stellen mehr frei haben',
    'haben sich leider andere Bewerber*innen als passender erwiesen',
    'Bei uns ist der Bedarf gedeckt, deshalb kann ich dir aktuell leider nichts anbieten.',
    'Leider müssen wir Ihnen für diese Position absagen.',
    'Daher können wir Sie leider nicht zu einem persönlichen Gespräch einladen.',
  ];
  for (const t of absagen) assert.equal(classifyReply('Ihre Bewerbung', t), 'absage', t);
  assert.equal(classifyReply('Absage: Junior Developer', 'Sehr geehrter Herr Schaberl, …'), 'absage');
});

test('classifyReply: Eingangsbestätigung', () => {
  assert.equal(classifyReply('Eingangsbestätigung', 'Danke.'), 'eingang');
  assert.equal(classifyReply('Ihre Bewerbung', 'Ihre Bewerbung ist bei uns eingegangen, wir melden uns.'), 'eingang');
  assert.equal(classifyReply('Re: Bewerbung', 'We have received your application and will review it.'), 'eingang');
});

test('classifyReply: alles andere ist "antwort" — ein nacktes "leider" ist keine Absage', () => {
  assert.equal(classifyReply('Re: Bewerbung', 'Leider konnte ich Ihren Anhang nicht öffnen, bitte nochmal schicken.'), 'antwort');
  assert.equal(classifyReply('Einladung zum Gespräch', 'Wir laden Sie gerne zu einem Gespräch ein.'), 'antwort');
  assert.equal(classifyReply('Einladung', 'Falls Sie den Termin absagen müssen, melden Sie sich bitte.'), 'antwort');
  assert.equal(classifyReply('Re: Bewerbung', 'Bewerbungen per E-Mail dürfen wir leider nicht annehmen, bitte über das Portal.'), 'antwort');
});

test('strongerKind: Absage > Zusage > Datenschutz/Plattform > Antwort > Eingang', () => {
  assert.equal(strongerKind('zusage', 'absage'), 'absage');
  assert.equal(strongerKind('absage', 'zusage'), 'absage');
  assert.equal(strongerKind('datenschutz', 'zusage'), 'zusage');
  assert.equal(strongerKind('antwort', 'plattform'), 'plattform');
  assert.equal(strongerKind('eingang', 'datenschutz'), 'datenschutz');
  // Gleichrangig: das Bestehende bleibt.
  assert.equal(strongerKind('datenschutz', 'plattform'), 'datenschutz');
});

test('strongerKind: Absage schlägt Eingang, nie umgekehrt', () => {
  assert.equal(strongerKind('eingang', 'absage'), 'absage');
  assert.equal(strongerKind('absage', 'eingang'), 'absage');
  assert.equal(strongerKind(null, 'eingang'), 'eingang');
  assert.equal(strongerKind('antwort', 'eingang'), 'antwort');
});

test('htmlToText: Tags weg, Umlaut-Entities aufgelöst', () => {
  assert.match(htmlToText('<p>Die Stelle wurde <b>bereits</b> besetzt.</p><style>x{}</style>'), /Die Stelle wurde bereits besetzt\./);
  assert.equal(htmlToText('Pr&uuml;fung').trim(), 'Prüfung');
});
