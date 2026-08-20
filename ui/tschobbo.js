/* Tschobbo — Maskottchen-Sprite-Layer. Reines DOM/CSS/JS, kein React, kein
 * Build-Schritt. Idle-Verhalten (Driften, Drehen, Seele-Beats) lebt hier;
 * der Scrape-Teil reagiert auf 'tschobbo:unit' (siehe ui/app.tsx, Hook im
 * /api/scrape/stream-Effect — nur dort wird das Event gefeuert, das ist die
 * ganze "v1 reagiert nur auf Scrape"-Beschränkung, siehe docs/architecture.md).
 * Dazu zwei Ansichts-Events aus ui/app.tsx: 'tschobbo:view' ({active}) blendet
 * die Klumpen mit der Scrape-Ansicht ein/aus, 'tschobbo:replay' wirft den
 * fertigen Stand beim Zurückkommen neu auf.
 */

const FRAME = 96;
const DISPLAY = 72;
const SCALE = DISPLAY / FRAME;
const SHEET_W = 576 * SCALE;
const SHEET_H = 384 * SCALE;

const ROWS = { front: 0, side: 1, quarter: 2, throw: 3 };
const FRAME_COUNTS = { front: 6, side: 6, quarter: 6, throw: 4 };

// Klumpen-Sheet (tschobbo-blobs.png): eigenes, kleineres Raster, nativ ohne
// Skalierung (Anzeigegroesse = Asset-Groesse, siehe Auftrag).
const BLOB_FRAME = 32;
const BLOB_SHEET_W = 128, BLOB_SHEET_H = 96;
const BLOB_ROWS = { fly: 0, stick: 1, glob: 2 };
const BLOB_FRAME_COUNTS = { fly: 4, stick: 1, glob: 4 };

const IDLE_FRAME_MS = 1000 / 8;
const DRIFT_WAIT_MIN = 6000, DRIFT_WAIT_MAX = 14000;
const DRIFT_TRAVEL_MIN = 3000, DRIFT_TRAVEL_MAX = 6000;
const TURN_STEP_MIN = 150, TURN_STEP_MAX = 200;
const ENTRANCE_MS = 400;
const SETTLE_MS = 180;
const MARGIN = 32;

const PARK_TRAVEL_MS = 600; // nicht im Auftrag beziffert — an Entrance/Drift angelehnt
const HOP_MS = 160;
const SCRAPE_SILENCE_MS = 5000;

const THROW_FRAME_MS = 1000 / 12; // Auftrag: "Throw-Ticker: 12 fps"
const THROW_STAGGER_MS = 120; // Auftrag: Wurf-Frequenz bei mehreren Jobs
const FLY_MS = 450; // nicht im Auftrag beziffert — zuegiger Wurf, an Drift/Park angelehnt
const FLY_SPINS = 2; // wie oft der Klumpen waehrend des Flugs durch seine 4 Frames rotiert, nicht beziffert
const ARC = 80; // Auftrag: "Wurfhöhe (ARC): ~80 px"
const FALL_G = 0.6; // Auftrag: "kleines g", nicht beziffert
const GLOB_CAP = 40; // Auftrag: "ab ~40 sichtbaren globs im Haufen keine neuen DOM-Knoten mehr"
const PILE_BASE_H = 40, PILE_MAX_H = 120; // nicht im Auftrag beziffert — Anfangs-/Deckelhöhe des Haufens

const STORAGE_KEY = 'tschobbo.enabled';

// Macht die Scrape-Quadrate unsichtbar (Klumpen übernehmen die Anzeige), ohne
// LoadGrids Layout/Pop-Timing anzufassen — Quadrate bleiben im Fluss (Tschobbo
// braucht ihre Positionen als Wurfziele), nur Sichtbarkeit + Interaktion aus.
// visibility statt opacity: geklebte Klumpen sind echte DOM-Kinder des Quadrats
// (siehe stick() weiter unten) — opacity:0 würde die ganze Kind-Subbaum-Ebene
// mitdimmen und ließe sich von einem Kind nicht zurücksetzen, visibility:hidden
// schon (per visibility:visible am Klumpen). loadgrid-pop animiert nur opacity,
// nicht visibility — kein !important nötig, nichts konkurriert hier.
//
// Das Ghost-Quadrat ist ausserdem so gross wie ein Klumpen: ein 11px-Quadrat auf
// 14px-Raster trug einen 32px-Klumpen, der seine beiden Nachbarn und die ganze
// Zeile darunter verdeckte — von 13 geklebten Klumpen waren ~7 zu sehen (Kevin:
// "die die kleben bleiben sind nicht sichtbar"). In der Scrape-Ansicht IST der
// Klumpen die Anzeige, also gibt das unsichtbare Quadrat ihm seinen Platz.
// Betrifft nur --ghost, die sichtbaren Grids in Filter/Anschreiben bleiben klein.
// Doppelte Klasse im Selektor, weil ui/app.tsx sein <style> im Body rendert (also
// NACH diesem hier im <head>) — bei gleicher Spezifitaet gewaenne sonst dort
// width/height:11px.
// Und ohne Pop-Animation: die staffelt opacity 0->1 und transform scale(.4)->1
// pro Quadrat um bis zu 4s (--pop-delay). Ein geklebter Klumpen ist Kind des
// Quadrats, erbt beides und war dadurch bis zu seinem Pop unsichtbar bzw.
// geschrumpft — besonders beim Nachbau, wo das Grid frisch mountet und alle
// Delays neu laufen. Am Ghost-Quadrat ist die Animation ohnehin unsichtbar.
const TSCHOBBO_CSS = `
.loadgrid__sq.loadgrid__sq--ghost {
  visibility:hidden; pointer-events:none;
  width:${BLOB_FRAME}px; height:${BLOB_FRAME}px; border-radius:0;
  animation:none; opacity:1; transform:none;
}`;

function rand(min, max) { return min + Math.random() * (max - min); }

// Idle-Driftziel: fest rechter Rand, vertikal mittig — kein Rand-Sampling mehr.
function rightMidSpot() {
  return { x: innerWidth - DISPLAY - MARGIN, y: innerHeight / 2 - DISPLAY / 2 };
}

function spawnSpot() {
  return { x: innerWidth - DISPLAY - MARGIN, y: innerHeight - DISPLAY - MARGIN };
}

// Park-Position beim Scrapen: rechter Rand, aber ganz im Bild (Kevin: "rück ihn
// rechts rein, dass er immer ganz zu sehen ist"). Früher halb draußen
// (innerWidth - DISPLAY/2) — sah abgeschnitten aus.
function parkSpot(gridTop) {
  return { x: innerWidth - DISPLAY - MARGIN, y: gridTop };
}

function setFrame(body, view, frame) {
  body.style.backgroundPosition = `-${frame * DISPLAY}px -${ROWS[view] * DISPLAY}px`;
}

function setBlobFrame(el, row, frame) {
  el.style.backgroundPosition = `-${frame * BLOB_FRAME}px -${BLOB_ROWS[row] * BLOB_FRAME}px`;
}

function makeBlobEl() {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed; width:${BLOB_FRAME}px; height:${BLOB_FRAME}px; background-image:url(/tschobbo-blobs.png); background-repeat:no-repeat; background-size:${BLOB_SHEET_W}px ${BLOB_SHEET_H}px; pointer-events:none; z-index:39;`;
  return el;
}

// Der Schalter haengt in der Seitenleiste, nicht mehr fix unten rechts am Fenster.
// Dort lag er ueber JEDER Fussleiste (z-index 41) — beim Nachfassen-Tab musste ich die
// Knoepfe deswegen schon nach links ruecken, und auf schmalen Schirmen verdeckte er einen
// guten Teil der Zeile. In der Leiste ist er ausserdem automatisch mit in der Schublade,
// sobald die Leiste unter 1024px zu einer wird.
//
// React raeumt fremde Kinder eines von ihm gerenderten Elements beim Abgleich nicht weg
// (dieselbe Annahme wie bei den geklebten Klumpen an .loadgrid__sq). Ist die Leiste noch
// nicht da — tschobbo.js laedt als eigenes Modul neben app.js —, wird kurz gewartet und
// sonst auf die alte Ecke zurueckgefallen, damit der Schalter nie ganz verschwindet.
function mountToggle(toggle, versuch = 0) {
  const sb = document.querySelector('.sb');
  if (sb) {
    // sticky im scrollenden .sb: die Leiste ist laenger als der Schirm, ohne das lag der
    // Schalter unterhalb der Falte und waere in der Schublade erst nach Scrollen zu finden.
    toggle.style.position = 'sticky';
    toggle.style.bottom = '10px';
    toggle.style.margin = 'auto 12px 12px';
    toggle.style.alignSelf = 'flex-start';
    // Er schwebt ueber den Tastatur-Hinweisen, solange die Leiste nicht ganz unten steht —
    // der Schatten macht daraus ein Overlay statt einer Kollision.
    toggle.style.boxShadow = '0 2px 10px rgba(0,0,0,.45)';
    sb.appendChild(toggle);
    return;
  }
  if (versuch < 40) { setTimeout(() => mountToggle(toggle, versuch + 1), 50); return; }
  toggle.style.position = 'fixed';
  toggle.style.right = '12px';
  toggle.style.bottom = '12px';
  document.body.appendChild(toggle);
}

function buildDom() {
  const root = document.createElement('div');
  root.className = 'tschobbo';
  root.style.cssText = `position:fixed; left:0; top:0; width:${DISPLAY}px; height:${DISPLAY}px; pointer-events:none; z-index:40;`;

  const body = document.createElement('div');
  body.style.cssText = `position:absolute; inset:0; width:${DISPLAY}px; height:${DISPLAY}px; background-image:url(/tschobbo-sheet.png); background-repeat:no-repeat; background-size:${SHEET_W}px ${SHEET_H}px;`;

  root.appendChild(body);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.style.cssText = 'z-index:41; pointer-events:auto; font-family:var(--sans, sans-serif); font-size:11px; font-weight:600; letter-spacing:.02em; padding:4px 9px; border-radius:20px; border:1px solid var(--line, #2A323F); background:var(--panel, #1B212B); color:var(--muted, #8A94A6); cursor:pointer;';

  const style = document.createElement('style');
  style.textContent = TSCHOBBO_CSS;

  // Klumpen-Ebene: Sammel-Container für alles Geworfene (fliegende Klumpen +
  // Haufen). Die Klumpen gehören zur Scrape-Ansicht, hängen aber an <body> statt
  // im React-Baum — ohne diesen einen Schalter blieben sie beim Ansichtswechsel
  // über Jobs/Kalender/… stehen (Kevin). Startet aus: erst 'tschobbo:view' bzw.
  // der erste Wurf machen sie sichtbar.
  const layer = document.createElement('div');
  layer.style.cssText = 'position:fixed; inset:0; pointer-events:none; display:none;';

  // Schleimhaufen-Footer: unsichtbarer Sammelbereich am unteren Rand des
  // Scrape-Containers (.dt__body), overflow:hidden hält die globs drin.
  // Position/Größe wird erst bei Scrape-Start gesetzt (positionPile), solange
  // unsichtbar (Auftrag will keine feste Größe vorab).
  const pile = document.createElement('div');
  pile.style.cssText = 'position:fixed; overflow:hidden; pointer-events:none; z-index:38; display:none;';

  document.head.appendChild(style);
  document.body.appendChild(root);
  mountToggle(toggle);
  layer.appendChild(pile);
  document.body.appendChild(layer);
  return { root, body, toggle, style, pile, layer };
}

export function initTschobbo() {
  const { root, body, toggle, style, pile, layer } = buildDom();

  let timers = [];
  let frameTimer = null;
  let atFront = true;
  let destroyed = false;
  let enabledState = true;
  let posX = 0, posY = 0;
  let stuckBlobs = [];
  let pileCount = 0;

  // 'idle' | 'scrape' — 'scrape' deckt sowohl die Anfahrt an den Grid-Rand als
  // auch die eigentlichen Schübe ab. `busy` ist die Burst-Sperre: laeuft eine
  // Anfahrt oder ein Schub, wird ein eintreffendes Event ignoriert (keine
  // Queue, kein Nachholen — siehe docs/architecture.md).
  let mode = 'idle';
  let busy = false;
  let silenceTimer = null;
  let throwQueue = [];
  // Wiederholung beim Betreten der Scrape-Ansicht (siehe onReplay): dieselben
  // Würfe, aber ohne Stille-Timer — hier ist die Queue selbst das Ende-Signal,
  // sonst würde ein langer Nachbau nach 5s mittendrin abgebrochen.
  let replaying = false;

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
    if (frameTimer) { clearInterval(frameTimer); frameTimer = null; }
    if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
  }

  function place(x, y, durationMs) {
    posX = x; posY = y;
    root.style.transition = durationMs ? `left ${durationMs}ms ease-in-out, top ${durationMs}ms ease-in-out` : 'none';
    root.style.left = `${x}px`;
    root.style.top = `${y}px`;
  }

  function startFrameLoop(view) {
    let i = 0;
    setFrame(body, view, 0);
    if (frameTimer) clearInterval(frameTimer);
    frameTimer = setInterval(() => {
      i = (i + 1) % FRAME_COUNTS[view];
      setFrame(body, view, i);
    }, IDLE_FRAME_MS);
  }

  // Seele-Beat 2: "ankommen statt stoppen" — kurzer Squash am Drift-Ziel.
  function settleSquash() {
    root.animate(
      [{ transform: 'scale(1.06)' }, { transform: 'scale(.94)' }, { transform: 'scale(1)' }],
      { duration: SETTLE_MS, easing: 'ease-out' }
    );
  }

  // Seele-Beat 4: Unregelmäßigkeit — Wartezeit vor jeder Drift/Drehung randomisiert.
  function scheduleDrift() {
    const wait = rand(DRIFT_WAIT_MIN, DRIFT_WAIT_MAX);
    timers.push(setTimeout(() => {
      const target = rightMidSpot();
      const travel = rand(DRIFT_TRAVEL_MIN, DRIFT_TRAVEL_MAX);
      place(target.x, target.y, travel);
      timers.push(setTimeout(() => { settleSquash(); scheduleDrift(); }, travel));
    }, wait));
  }

  function startIdle() {
    atFront = true;
    startFrameLoop('front');
    scheduleDrift();
  }

  // Scrape-Beginn: dreht über die Dreh-Kette front -> quarter -> side (quarter
  // als kurze Zwischenstufe, 150–200ms, TURN_STEP_MIN/MAX) und fährt an den rechten
  // Rand des Viewports (parkSpot, ganz im Bild). Zaehlt als busy, bis geparkt ist —
  // das erste Event triggert nur die Anfahrt, der erste Schub kommt erst mit dem
  // naechsten.
  function parkForScrape() {
    busy = true;
    const finishPark = () => {
      requestAnimationFrame(() => {
        const gridRect = document.querySelector('.loadgrid')?.getBoundingClientRect();
        const spot = parkSpot(gridRect ? gridRect.top : posY);
        place(spot.x, spot.y, PARK_TRAVEL_MS);
        timers.push(setTimeout(() => { busy = false; }, PARK_TRAVEL_MS));
      });
    };
    if (atFront) {
      startFrameLoop('quarter');
      timers.push(setTimeout(() => {
        atFront = false;
        startFrameLoop('side');
        finishPark();
      }, rand(TURN_STEP_MIN, TURN_STEP_MAX)));
    } else {
      startFrameLoop('side');
      finishPark();
    }
  }

  // Ein Klumpen fliegt auf einer Parabel (Formel, keine Physik-Engine) von der
  // Wurfhand zum Ziel und rotiert dabei durch seine 4 fly-Frames. Am Ziel
  // entscheidet das Location-Gate-Ergebnis (an der Zielquadrat-Klasse abgelesen):
  // klebt (matched) oder fällt (Auftrag-Regel 1, real erkennbar).
  function spawnFly(origin, target, matched, targetEl) {
    const el = makeBlobEl();
    layer.appendChild(el);
    const t0 = performance.now();
    function step(now) {
      const t = Math.min(1, (now - t0) / FLY_MS);
      const x = origin.x + (target.x - origin.x) * t;
      const y = origin.y + (target.y - origin.y) * t - ARC * Math.sin(Math.PI * t);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      const frame = Math.floor(t * BLOB_FRAME_COUNTS.fly * FLY_SPINS) % BLOB_FRAME_COUNTS.fly;
      setBlobFrame(el, 'fly', frame);
      if (t < 1) requestAnimationFrame(step);
      else if (matched) {
        stick(el, targetEl);
      } else {
        fall(el, target.x, target.y);
      }
    }
    requestAnimationFrame(step);
  }

  // Klebt als echtes DOM-Kind des Quadrats (nicht mehr fixed an der Landeposition)
  // — .dt__body scrollt (overflow-y:auto), ein eigenständig positionierter Klumpen
  // würde beim Scrollen vom Quadrat abdriften/verdeckt wirken. Als Kind wandert er
  // zwangsläufig mit, .loadgrid__sq braucht dafür position:relative als Anker.
  function stick(el, targetEl) {
    setBlobFrame(el, 'stick', 0);
    el.style.position = 'absolute';
    el.style.left = '0';
    el.style.top = '0';
    el.style.visibility = 'visible'; // Quadrat ist visibility:hidden (Ghost), Klumpen holt sich das explizit zurück
    targetEl.appendChild(el);
    stuckBlobs.push(el);
  }

  // Formel-basiertes Fallen (Auftrag: "y += vy; vy += g", kein Stapeln, keine
  // Kollision) bis zum Haufen-Rand, dann verschwindet der Einzel-Klumpen und
  // wird zu einem glob im Footer.
  function fall(el, x, startY) {
    let y = startY, vy = 0;
    function step() {
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

  // Haufen an .dt__body verankern (genau eine Instanz sichtbar, siehe Auftrag-
  // Regel 3) — Aufruf bei jedem Scrape-Start, damit Größe/Position stimmen,
  // falls sich das Layout seit dem letzten Lauf geändert hat.
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

  // Wurf-Animation: Frame 0 ausholen, 1 hochziehen, 2 = Release, 3 nachschwingen
  // (siehe Auftrag). Keine Arme mehr — Wurfhand ist eine ungefähre Position
  // relativ zum Körper, nicht im Auftrag exakt beziffert.
  //
  // Release hängt an einem eigenen Timeout statt am frameTimer-Intervall: bei
  // ~120ms Wurf-Abstand (THROW_STAGGER_MS) überholt der nächste Wurf oft noch
  // vor Frame 2 (~166ms) und würde das Intervall kappen — der Klumpen des
  // vorigen Wurfs käme nie los. Das Intervall bleibt rein kosmetisch fürs Arm-Flackern.
  function throwOne(targetEl) {
    const rect = targetEl.getBoundingClientRect();
    const target = { x: rect.left, y: rect.top };
    const origin = { x: posX + DISPLAY * 0.5, y: posY + DISPLAY * 0.4 };
    const matched = !targetEl.classList.contains('loadgrid__sq--excluded');

    if (frameTimer) clearInterval(frameTimer);
    let i = 0;
    setFrame(body, 'throw', 0);
    frameTimer = setInterval(() => {
      i++;
      if (i >= FRAME_COUNTS.throw) {
        clearInterval(frameTimer); frameTimer = null;
        startFrameLoop('side');
        return;
      }
      setFrame(body, 'throw', i);
    }, THROW_FRAME_MS);

    timers.push(setTimeout(() => spawnFly(origin, target, matched, targetEl), 2 * THROW_FRAME_MS));
  }

  // Burst-Regel (anders als v1): kein Ignorieren mehr — jeder Job aus jedem
  // Event wird gesehen, mit ~120ms Abstand nacheinander geworfen (Auftrag).
  // Während der Anfahrt (busy) wartet die Queue, statt schon zu werfen.
  function queueThrows(elements) {
    const wasEmpty = throwQueue.length === 0;
    throwQueue.push(...elements);
    if (wasEmpty) drainThrowQueue();
  }

  function drainThrowQueue() {
    if (throwQueue.length === 0) {
      // Nachbau: der letzte Wurf muss noch fliegen und landen, bevor Tschobbo
      // sich abwendet — deshalb FLY_MS Nachlauf statt sofortigem endScrape.
      if (replaying) timers.push(setTimeout(endScrape, FLY_MS));
      return;
    }
    if (busy) { timers.push(setTimeout(drainThrowQueue, THROW_STAGGER_MS)); return; }
    const el = throwQueue.shift();
    throwOne(el);
    timers.push(setTimeout(drainThrowQueue, THROW_STAGGER_MS));
  }

  // Zurück zu 'front' über dieselbe Zwischenstufe wie beim Scrape-Start
  // (TURN_STEP_MIN/MAX), dann zurück in den Idle-Zyklus.
  function returnToIdle() {
    startFrameLoop('quarter');
    timers.push(setTimeout(() => {
      busy = false;
      startIdle();
    }, rand(TURN_STEP_MIN, TURN_STEP_MAX)));
  }

  // Seele-Beat 3: Freuden-Hüpfer bei Scrape-Ende, danach zurück in den Idle-Zyklus.
  function endScrape() {
    if (mode !== 'scrape') return;
    mode = 'idle';
    replaying = false;
    busy = true;
    const hop = () => new Promise(resolve => {
      const anim = root.animate(
        [{ transform: 'translateY(0)' }, { transform: 'translateY(-10px)' }, { transform: 'translateY(0)' }],
        { duration: HOP_MS, easing: 'ease-out' }
      );
      anim.onfinish = resolve;
    });
    hop().then(hop).then(returnToIdle);
  }

  function resetSilenceTimer() {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(endScrape, SCRAPE_SILENCE_MS);
  }

  // Pro Event: Stille-Timer zurücksetzen, beim allerersten zusätzlich anfahren.
  // Die Zeile kommt über event.detail.row (data-row-Attribut, siehe ui/app.tsx) —
  // "letzte .loadgrid__row im DOM" war nur richtig, solange eine einzige Section
  // scrapt. Bei paralleler Multi-Source-Scrape (maxConcurrent in scrape-runner.ts)
  // verschachteln sich die Events mehrerer Sections, DOM-Reihenfolge ist nach
  // Section gruppiert statt nach Event-Chronologie — "letzte Zeile" traf dann oft
  // die falsche (schon beworfene) Section (siehe docs/errors.md).
  function onGridUnit(e) {
    if (!enabledState) return;
    const rowKey = e.detail.row;
    const firstEvent = mode === 'idle';
    if (firstEvent) {
      clearTimers();
      mode = 'scrape';
      throwQueue = [];
      resetSilenceTimer();
      parkForScrape();
    } else {
      resetSilenceTimer();
    }
    requestAnimationFrame(() => {
      if (firstEvent) { layer.style.display = 'block'; positionPile(); clearPile(); clearStuck(); }
      const row = document.querySelector(`.loadgrid__row[data-row="${rowKey}"]`);
      if (!row) return;
      queueThrows(Array.from(row.querySelectorAll('.loadgrid__sq')));
    });
  }

  // Nachbau beim Betreten der Scrape-Ansicht nach einem Lauf (ui/app.tsx feuert
  // 'tschobbo:replay'): Die geworfenen Klumpen leben nicht im React-Baum und
  // wären beim Ansichtswechsel verloren — statt sie zu konservieren wirft
  // Tschobbo den fertigen Stand einfach neu auf, Quadrat für Quadrat. Ergebnis
  // ist derselbe Endzustand (geklebt bei matched, Haufen bei excluded), nur mit
  // wiederholter Animation.
  function onReplay() {
    if (!enabledState || mode === 'scrape') return;
    clearTimers();
    mode = 'scrape';
    replaying = true;
    throwQueue = [];
    parkForScrape();
    requestAnimationFrame(() => {
      layer.style.display = 'block';
      positionPile(); clearPile(); clearStuck();
      const squares = Array.from(document.querySelectorAll('.loadgrid__sq'));
      if (squares.length === 0) { replaying = false; endScrape(); return; }
      queueThrows(squares);
    });
  }

  // Ansichtswechsel (ui/app.tsx): Klumpen gehören zur Scrape-Ansicht. Beim
  // Verlassen alles wegräumen — die Klumpen-Ebene hängt an <body> und würde
  // sonst über Jobs/Kalender/… liegenbleiben; ein laufender Nachbau würde
  // ausserdem auf inzwischen entfernte Quadrate werfen.
  function onViewChange(e) {
    if (e.detail?.active) return;
    layer.style.display = 'none';
    throwQueue = [];
    replaying = false;
    clearPile();
    clearStuck();
    if (mode === 'scrape') {
      mode = 'idle';
      clearTimers();
      busy = true;
      returnToIdle();
    }
  }

  window.addEventListener('tschobbo:unit', onGridUnit);
  window.addEventListener('tschobbo:replay', onReplay);
  window.addEventListener('tschobbo:view', onViewChange);

  function setToggleLabel(on) {
    toggle.textContent = on ? 'Tschobbo: an' : 'Tschobbo: aus';
  }

  function enable() {
    localStorage.setItem(STORAGE_KEY, 'true');
    enabledState = true;
    setToggleLabel(true);
    root.style.display = '';
    mode = 'idle';
    busy = false;
    const spot = spawnSpot();
    setFrame(body, 'front', 0);

    place(spot.x + DISPLAY * 1.6, spot.y, 0);
    requestAnimationFrame(() => {
      place(spot.x, spot.y, ENTRANCE_MS);
      timers.push(setTimeout(startIdle, ENTRANCE_MS));
    });
  }

  function disable() {
    localStorage.setItem(STORAGE_KEY, 'false');
    enabledState = false;
    setToggleLabel(false);
    clearTimers();
    mode = 'idle';
    busy = false;
    replaying = false;
    throwQueue = [];
    clearPile();
    clearStuck();
    layer.style.display = 'none';
    root.style.display = 'none';
  }

  toggle.addEventListener('click', () => {
    const on = (localStorage.getItem(STORAGE_KEY) ?? 'true') === 'true';
    if (on) disable(); else enable();
  });

  if ((localStorage.getItem(STORAGE_KEY) ?? 'true') === 'true') enable(); else disable();

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimers();
      window.removeEventListener('tschobbo:unit', onGridUnit);
      window.removeEventListener('tschobbo:replay', onReplay);
      window.removeEventListener('tschobbo:view', onViewChange);
      root.remove();
      toggle.remove();
      style.remove();
      layer.remove();
    },
  };
}

initTschobbo();
