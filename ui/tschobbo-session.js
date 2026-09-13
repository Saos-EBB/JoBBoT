// Ersetzt eine lose 'idle'/'scrape'-Variable durch einen Generation-Zähler.
// Grund: rAF-Ketten (Klumpen-Flug/-Fall in tschobbo-blobs.js) und verspätet
// auflösende Timeout-Ketten (returnToIdle in tschobbo.js) haben keine eigene
// Abbruch-Möglichkeit — sie laufen weiter, auch wenn die Session, für die sie
// gestartet wurden, längst nicht mehr die aktuelle ist. isCurrent(gen) macht
// das prüfbar: jede so eine Kette merkt sich ihre generation bei Start und
// bricht ab, sobald sie nicht mehr aktuell ist.
export function createScrapeSession() {
  let generation = 0;
  let active = false;
  return {
    get generation() { return generation; },
    get active() { return active; },
    isCurrent(gen) { return gen === generation; },
    // Neue Epoche (echter Scrape-Start oder Nachbau-Replay).
    begin() {
      generation += 1;
      active = true;
      return generation;
    },
    // Normales Ende (Stille-Timer / echtes scrapeStatus=done): Generation
    // bleibt stehen, noch fliegende/fallende Klumpen dieser Session dürfen
    // normal ankommen — nur ein neues begin() soll sie ungültig machen.
    finish() {
      active = false;
    },
    // Abbruch (Ansicht verlassen, disable(), destroy()): Generation bumpen,
    // damit noch unterwegs befindliche Klumpen NICHT mehr auf jetzt
    // verstecktes/entferntes DOM landen.
    abort() {
      generation += 1;
      active = false;
    },
  };
}
