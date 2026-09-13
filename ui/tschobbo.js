/* Tschobbo — Maskottchen-Sprite-Layer. Reines DOM/CSS/JS, kein React, kein
 * Build-Schritt. Idle-Verhalten (Driften, Drehen, Seele-Beats) lebt hier;
 * der Scrape-Teil reagiert auf 'tschobbo:unit' (siehe ui/app.tsx, Hook im
 * /api/scrape/stream-Effect — nur dort wird das Event gefeuert, das ist die
 * ganze "v1 reagiert nur auf Scrape"-Beschränkung, siehe docs/architecture.md).
 * Dazu drei weitere Events aus ui/app.tsx bzw. ui/hooks/scrape-run.ts:
 * 'tschobbo:view' ({active}) blendet die Klumpen mit der Scrape-Ansicht ein/
 * aus, 'tschobbo:replay' wirft den fertigen Stand beim Zurückkommen neu auf,
 * 'tschobbo:scrape-done' meldet das echte scrapeStatus=done/error (statt nur
 * aus 5s Event-Stille zu raten, wann ein Lauf vorbei ist).
 *
 * Session-Zustand (Generation-Zähler statt loser 'mode'-Variable) sitzt in
 * tschobbo-session.js, Klumpen-Flug/-Fall/-Haufen in tschobbo-blobs.js — beide
 * DOM-frei bzw. ohne Scrape-Wissen, damit ein bereits losgelassener Klumpen
 * oder eine verspätet auflösende Timeout-Kette erkennen kann, dass die Session,
 * für die sie gestartet wurde, nicht mehr die aktuelle ist (siehe review.html,
 * Durchlauf 3).
 */

import { createScrapeSession } from './tschobbo-session.js';
import { createBlobField, BLOB_FRAME, FLY_MS } from './tschobbo-blobs.js';

const FRAME = 96;
const DISPLAY = 72;
const SCALE = DISPLAY / FRAME;
const SHEET_W = 576 * SCALE;
const SHEET_H = 384 * SCALE;

const ROWS = { front: 0, side: 1, quarter: 2, throw: 3 };
const FRAME_COUNTS = { front: 6, side: 6, quarter: 6, throw: 4 };

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

const STORAGE_KEY = 'tschobbo.enabled';

// Macht die Scrape-Quadrate unsichtbar (Klumpen übernehmen die Anzeige), ohne
// LoadGrids Layout/Pop-Timing anzufassen — Quadrate bleiben im Fluss (Tschobbo
// braucht ihre Positionen als Wurfziele), nur Sichtbarkeit + Interaktion aus.
// visibility statt opacity: geklebte Klumpen sind echte DOM-Kinder des Quadrats
// (siehe stick() in tschobbo-blobs.js) — opacity:0 würde die ganze Kind-Subbaum-Ebene
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
  const session = createScrapeSession();
  const field = createBlobField({ layer, pile, session });

  // `busy` ist die Burst-Sperre: laeuft eine Anfahrt oder ein Schub, wird ein
  // eintreffendes Event ignoriert (keine Queue, kein Nachholen — siehe
  // docs/architecture.md). session.active ersetzt die frühere lose 'mode'-
  // Variable (siehe tschobbo-session.js).
  let busy = false;
  let silenceTimer = null;
  let throwQueue = [];
  // Wiederholung beim Betreten der Scrape-Ansicht (siehe onReplay): dieselben
  // Würfe, aber ohne Stille-Timer — hier ist die Queue selbst das Ende-Signal,
  // sonst würde ein langer Nachbau nach 5s mittendrin abgebrochen.
  let replaying = false;
  // Gesetzt vom echten scrapeStatus=done/error ('tschobbo:scrape-done', siehe
  // onScrapeDone) statt nur aus 5s Event-Stille geraten — der Stille-Timer
  // bleibt als Fallback, ist aber nicht mehr der einzige Signalgeber.
  let runConfirmedDone = false;

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
    // Erfasst beim Start der Anfahrt, welche Session das war — ein Klumpen-
    // fremder, aber strukturell gleicher Fall wie in tschobbo-blobs.js: löst
    // sich der Timeout erst auf, nachdem eine neue Session begonnen hat, soll
    // er `busy` nicht mehr freigeben (siehe Modulkommentar oben).
    const gen = session.generation;
    const finishPark = () => {
      requestAnimationFrame(() => {
        const gridRect = document.querySelector('.loadgrid')?.getBoundingClientRect();
        const spot = parkSpot(gridRect ? gridRect.top : posY);
        place(spot.x, spot.y, PARK_TRAVEL_MS);
        timers.push(setTimeout(() => { if (session.isCurrent(gen)) busy = false; }, PARK_TRAVEL_MS));
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

    timers.push(setTimeout(() => field.throwBlob(origin, target, matched, targetEl), 2 * THROW_FRAME_MS));
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
      // Nachbau bzw. echtes scrapeStatus=done: der letzte Wurf muss noch
      // fliegen und landen, bevor Tschobbo sich abwendet — deshalb FLY_MS
      // Nachlauf statt sofortigem endScrape.
      if (replaying || runConfirmedDone) timers.push(setTimeout(endScrape, FLY_MS));
      return;
    }
    if (busy) { timers.push(setTimeout(drainThrowQueue, THROW_STAGGER_MS)); return; }
    const el = throwQueue.shift();
    throwOne(el);
    timers.push(setTimeout(drainThrowQueue, THROW_STAGGER_MS));
  }

  // Zurück zu 'front' über dieselbe Zwischenstufe wie beim Scrape-Start
  // (TURN_STEP_MIN/MAX), dann zurück in den Idle-Zyklus. `gen` ist die Session-
  // Generation zum Zeitpunkt, als dieser Rücksprung ausgelöst wurde (siehe
  // endScrape/onViewChange) — hat inzwischen eine neue Session begonnen
  // (session.begin()), bricht der Rücksprung ab, statt busy/den frisch
  // begonnenen Wurf-Zyklus zu kappen (review.html, Durchlauf 3).
  function returnToIdle(gen) {
    if (!session.isCurrent(gen)) return;
    startFrameLoop('quarter');
    timers.push(setTimeout(() => {
      if (!session.isCurrent(gen)) return;
      busy = false;
      startIdle();
    }, rand(TURN_STEP_MIN, TURN_STEP_MAX)));
  }

  // Seele-Beat 3: Freuden-Hüpfer bei Scrape-Ende, danach zurück in den Idle-Zyklus.
  function endScrape() {
    if (!session.active) return;
    const gen = session.generation;
    session.finish();
    replaying = false;
    runConfirmedDone = false;
    busy = true;
    const hop = () => new Promise(resolve => {
      const anim = root.animate(
        [{ transform: 'translateY(0)' }, { transform: 'translateY(-10px)' }, { transform: 'translateY(0)' }],
        { duration: HOP_MS, easing: 'ease-out' }
      );
      anim.onfinish = resolve;
    });
    hop().then(hop).then(() => returnToIdle(gen));
  }

  // Signal aus ui/hooks/scrape-run.ts: der echte Scrape-Lauf ist fertig
  // (scrapeStatus.status === 'done'/'error'), unabhängig von Event-Stille.
  // Ersetzt den 5s-Stille-Timer als primären Auslöser (der bleibt als
  // Fallback bestehen) — löst das in review.html Durchlauf 3 beschriebene
  // Verfrüht-Feiern bei einer echten Pause >5s zwischen zwei Quellen.
  function onScrapeDone() {
    if (!enabledState || !session.active) return;
    runConfirmedDone = true;
    if (throwQueue.length === 0 && !busy) endScrape();
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
    const firstEvent = !session.active;
    if (firstEvent) {
      clearTimers();
      session.begin();
      throwQueue = [];
      runConfirmedDone = false;
      resetSilenceTimer();
      parkForScrape();
    } else {
      resetSilenceTimer();
    }
    requestAnimationFrame(() => {
      if (firstEvent) { layer.style.display = 'block'; field.positionPile(); field.clearPile(); field.clearStuck(); }
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
    if (!enabledState || session.active) return;
    clearTimers();
    session.begin();
    replaying = true;
    throwQueue = [];
    parkForScrape();
    requestAnimationFrame(() => {
      layer.style.display = 'block';
      field.positionPile(); field.clearPile(); field.clearStuck();
      const squares = Array.from(document.querySelectorAll('.loadgrid__sq'));
      if (squares.length === 0) { replaying = false; endScrape(); return; }
      queueThrows(squares);
    });
  }

  // Ansichtswechsel (ui/app.tsx): Klumpen gehören zur Scrape-Ansicht. Beim
  // Verlassen alles wegräumen — die Klumpen-Ebene hängt an <body> und würde
  // sonst über Jobs/Kalender/… liegenbleiben; ein laufender Nachbau würde
  // ausserdem auf inzwischen entfernte Quadrate werfen. session.abort() (statt
  // finish()) bumpt die Generation, damit ein zu diesem Zeitpunkt noch
  // fliegender/fallender Klumpen (tschobbo-blobs.js) nicht mehr auf das gerade
  // versteckte/entfernte DOM zugreift.
  function onViewChange(e) {
    if (e.detail?.active) return;
    layer.style.display = 'none';
    throwQueue = [];
    replaying = false;
    field.clearPile();
    field.clearStuck();
    if (session.active) {
      session.abort();
      const gen = session.generation;
      clearTimers();
      busy = true;
      returnToIdle(gen);
    }
  }

  window.addEventListener('tschobbo:unit', onGridUnit);
  window.addEventListener('tschobbo:replay', onReplay);
  window.addEventListener('tschobbo:view', onViewChange);
  window.addEventListener('tschobbo:scrape-done', onScrapeDone);

  function setToggleLabel(on) {
    toggle.textContent = on ? 'Tschobbo: an' : 'Tschobbo: aus';
  }

  function enable() {
    localStorage.setItem(STORAGE_KEY, 'true');
    enabledState = true;
    setToggleLabel(true);
    root.style.display = '';
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
    session.abort();
    busy = false;
    replaying = false;
    throwQueue = [];
    field.clearPile();
    field.clearStuck();
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
      session.abort();
      clearTimers();
      window.removeEventListener('tschobbo:unit', onGridUnit);
      window.removeEventListener('tschobbo:replay', onReplay);
      window.removeEventListener('tschobbo:view', onViewChange);
      window.removeEventListener('tschobbo:scrape-done', onScrapeDone);
      root.remove();
      toggle.remove();
      style.remove();
      layer.remove();
    },
  };
}

initTschobbo();
