// Klumpen-Physik: Flug (Parabel), Landen (kleben oder fallen), Haufen. Kennt
// weder 'mode' noch 'busy' — nur Koordinaten, Zielelemente und eine `session`
// (siehe tschobbo-session.js), gegen deren Generation jede rAF-Schrittfunktion
// sich vor einer sichtbaren Wirkung (appendChild, addGlob) prüft. Ohne diese
// Prüfung lief ein bereits losgelassener Klumpen unbeirrt weiter, auch wenn
// die Session zwischenzeitlich abgebrochen wurde (Ansicht verlassen, disable(),
// neue Scrape-Session) — er landete dann auf einem längst entfernten Quadrat
// oder im Haufen einer schon wieder anderen Session.

export const BLOB_FRAME = 32;
const BLOB_SHEET_W = 128, BLOB_SHEET_H = 96;
const BLOB_ROWS = { fly: 0, stick: 1, glob: 2 };
const BLOB_FRAME_COUNTS = { fly: 4, stick: 1, glob: 4 };

export const FLY_MS = 450; // nicht im Auftrag beziffert — zuegiger Wurf, an Drift/Park angelehnt; auch tschobbo.js braucht das (Nachlauf, bevor endScrape ausgelöst wird)
const FLY_SPINS = 2; // wie oft der Klumpen waehrend des Flugs durch seine 4 Frames rotiert, nicht beziffert
const ARC = 80; // Auftrag: "Wurfhöhe (ARC): ~80 px"
const FALL_G = 0.6; // Auftrag: "kleines g", nicht beziffert
const GLOB_CAP = 40; // Auftrag: "ab ~40 sichtbaren globs im Haufen keine neuen DOM-Knoten mehr"
const PILE_BASE_H = 40, PILE_MAX_H = 120; // nicht im Auftrag beziffert — Anfangs-/Deckelhöhe des Haufens

function rand(min, max) { return min + Math.random() * (max - min); }

function makeBlobEl() {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed; width:${BLOB_FRAME}px; height:${BLOB_FRAME}px; background-image:url(/tschobbo-blobs.png); background-repeat:no-repeat; background-size:${BLOB_SHEET_W}px ${BLOB_SHEET_H}px; pointer-events:none; z-index:39;`;
  return el;
}

function setBlobFrame(el, row, frame) {
  el.style.backgroundPosition = `-${frame * BLOB_FRAME}px -${BLOB_ROWS[row] * BLOB_FRAME}px`;
}

export function createBlobField({ layer, pile, session }) {
  let stuckBlobs = [];
  let pileCount = 0;

  // Klebt als echtes DOM-Kind des Quadrats (nicht eigenständig positioniert) —
  // .dt__body scrollt (overflow-y:auto), ein eigenständig positionierter Klumpen
  // würde beim Scrollen vom Quadrat abdriften. Als Kind wandert er zwangsläufig
  // mit, .loadgrid__sq braucht dafür position:relative als Anker.
  function stick(el, targetEl) {
    setBlobFrame(el, 'stick', 0);
    el.style.position = 'absolute';
    el.style.left = '0';
    el.style.top = '0';
    el.style.visibility = 'visible'; // Quadrat ist visibility:hidden (Ghost), Klumpen holt sich das explizit zurück
    targetEl.appendChild(el);
    stuckBlobs.push(el);
  }

  // Deckel (Auftrag: "ab ~40 sichtbaren globs keine neuen DOM-Knoten mehr") —
  // Füllstand wächst danach nur noch über die Haufenhöhe, nicht über neue Knoten.
  function addGlob(x) {
    pileCount++;
    if (pileCount <= GLOB_CAP) {
      const glob = makeBlobEl();
      glob.style.position = 'absolute';
      const variant = Math.floor(rand(0, BLOB_FRAME_COUNTS.glob));
      setBlobFrame(glob, 'glob', variant);
      const pileRect = pile.getBoundingClientRect();
      const relX = Math.min(pileRect.width - BLOB_FRAME, Math.max(0, x - pileRect.left + rand(-10, 10)));
      glob.style.left = `${relX}px`;
      glob.style.bottom = `${rand(0, 6)}px`;
      pile.appendChild(glob);
    } else {
      const extra = pileCount - GLOB_CAP;
      pile.style.height = `${Math.min(PILE_MAX_H, PILE_BASE_H + extra * 1.5)}px`;
    }
  }

  // Formel-basiertes Fallen (Auftrag: "y += vy; vy += g", kein Stapeln, keine
  // Kollision) bis zum Haufen-Rand. gen: siehe Modulkommentar oben — bricht ab,
  // sobald die Session, für die geworfen wurde, nicht mehr die aktuelle ist.
  function fall(el, x, startY, gen) {
    let y = startY, vy = 0;
    function step() {
      if (!session.isCurrent(gen)) { el.remove(); return; }
      vy += FALL_G;
      y += vy;
      const pileTop = pile.getBoundingClientRect().top;
      if (y < pileTop) {
        el.style.top = `${y}px`;
        requestAnimationFrame(step);
      } else {
        el.remove();
        addGlob(x);
      }
    }
    requestAnimationFrame(step);
  }

  // Ein Klumpen fliegt auf einer Parabel (Formel, keine Physik-Engine) von der
  // Wurfhand zum Ziel und rotiert dabei durch seine 4 fly-Frames. Am Ziel
  // entscheidet das Location-Gate-Ergebnis (matched): klebt oder fällt.
  function spawnFly(origin, target, matched, targetEl, gen) {
    const el = makeBlobEl();
    layer.appendChild(el);
    const t0 = performance.now();
    function step(now) {
      if (!session.isCurrent(gen)) { el.remove(); return; }
      const t = Math.min(1, (now - t0) / FLY_MS);
      const x = origin.x + (target.x - origin.x) * t;
      const y = origin.y + (target.y - origin.y) * t - ARC * Math.sin(Math.PI * t);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      const frame = Math.floor(t * BLOB_FRAME_COUNTS.fly * FLY_SPINS) % BLOB_FRAME_COUNTS.fly;
      setBlobFrame(el, 'fly', frame);
      if (t < 1) requestAnimationFrame(step);
      else if (matched) stick(el, targetEl);
      else fall(el, target.x, target.y, gen);
    }
    requestAnimationFrame(step);
  }

  // Haufen an .dt__body verankern (genau eine Instanz sichtbar) — Aufruf bei
  // jedem Scrape-Start, damit Größe/Position stimmen, falls sich das Layout
  // seit dem letzten Lauf geändert hat.
  function positionPile() {
    const bodyRect = document.querySelector('.dt__body')?.getBoundingClientRect();
    if (!bodyRect) return;
    pile.style.left = `${bodyRect.left}px`;
    pile.style.width = `${bodyRect.width}px`;
    pile.style.top = `${bodyRect.bottom - PILE_BASE_H}px`;
    pile.style.height = `${PILE_BASE_H}px`;
    pile.style.display = 'block';
  }

  // "Der Haufen bleibt sichtbar bis zum nächsten Scrape-Start (dann leeren)" —
  // Auftrag. Geklebte Klumpen einer alten, längst ersetzten scrapeSections-
  // Zeile ebenso, sonst hängen sie über dem neuen (leeren) Grid in der Luft.
  function clearPile() {
    pile.replaceChildren();
    pileCount = 0;
    pile.style.height = `${PILE_BASE_H}px`;
  }

  function clearStuck() {
    stuckBlobs.forEach(el => el.remove());
    stuckBlobs = [];
  }

  return {
    // Erfasst die aktuelle Generation selbst, bei jedem Aufruf frisch — der
    // Aufrufer muss sich darum nicht kümmern.
    throwBlob(origin, target, matched, targetEl) {
      spawnFly(origin, target, matched, targetEl, session.generation);
    },
    positionPile,
    clearPile,
    clearStuck,
  };
}
