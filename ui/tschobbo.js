/* Tschobbo — Maskottchen-Sprite-Layer. Reines DOM/CSS/JS, kein React, kein
 * Build-Schritt. Idle-Verhalten (Driften, Drehen, Seele-Beats) lebt hier;
 * der Schub-Teil reagiert auf 'tschobbo:unit' (siehe ui/app.tsx, Hook im
 * /api/scrape/stream-Effect — nur dort wird das Event gefeuert, das ist die
 * ganze "v1 reagiert nur auf Scrape"-Beschränkung, siehe docs/architecture.md).
 *
 * z-Reihenfolge im Overlay: Arm-SVG < Koerper-Sprite (siehe tschobbo-arms.js).
 */

import { createArms, playPush } from './tschobbo-arms.js';

const FRAME = 96;
const DISPLAY = 72;
const SCALE = DISPLAY / FRAME;
const SHEET_W = 576 * SCALE;
const SHEET_H = 384 * SCALE;

const ROWS = { front: 0, side: 1, push: 2, quarter: 3 };
const FRAME_COUNTS = { front: 6, side: 6, push: 5, quarter: 6 };

const IDLE_FRAME_MS = 1000 / 8;
const DRIFT_WAIT_MIN = 6000, DRIFT_WAIT_MAX = 14000;
const DRIFT_TRAVEL_MIN = 3000, DRIFT_TRAVEL_MAX = 6000;
const TURN_WAIT_MIN = 8000, TURN_WAIT_MAX = 15000;
const TURN_STEP_MIN = 150, TURN_STEP_MAX = 200;
const ENTRANCE_MS = 400;
const SETTLE_MS = 180;
const MARGIN = 32;

const PUSH_EXTEND_MS = 180, PUSH_HOLD_MS = 60, PUSH_RETRACT_MS = 200;
const PUSH_BODY_FRAME_MS = 90;
const ROW_FOLLOW_MS = 150;
const PARK_TRAVEL_MS = 600; // nicht im Auftrag beziffert — an Entrance/Drift angelehnt
const SLIDE_MS = 260, SLIDE_STAGGER_MS = 30, SLIDE_OFFSET_PX = 340;
const HOP_MS = 160;
const SCRAPE_SILENCE_MS = 5000;

const STORAGE_KEY = 'tschobbo.enabled';

// Retimed Reveal fuer Quadrate, die Tschobbo gerade ins Grid stopft — eigene
// Klasse statt LoadGrid-Umbau, hoehere Spezifitaet als .loadgrid__sq ueberschreibt
// nur Erscheinen+Timing, --final-color/loadgrid-color (Zustandsfarbe) bleibt unberuehrt.
const TSCHOBBO_CSS = `
@keyframes tschobbo-slide-in { from { opacity:0; transform:translateX(${SLIDE_OFFSET_PX}px); } to { opacity:1; transform:translateX(0); } }
.loadgrid__sq.tschobbo-arrive {
  animation-name: tschobbo-slide-in, loadgrid-color;
  animation-duration: ${SLIDE_MS}ms, .3s;
  animation-timing-function: cubic-bezier(.2,1.4,.4,1), ease-out;
  animation-delay: var(--tschobbo-delay, 0ms), var(--tschobbo-delay, 0ms);
  animation-fill-mode: forwards, forwards;
}`;

function rand(min, max) { return min + Math.random() * (max - min); }

function edgeSpots() {
  const w = innerWidth, h = innerHeight;
  return [
    { x: MARGIN, y: MARGIN },
    { x: w - DISPLAY - MARGIN, y: MARGIN },
    { x: MARGIN, y: h - DISPLAY - MARGIN },
    { x: w - DISPLAY - MARGIN, y: h - DISPLAY - MARGIN },
    { x: w / 2 - DISPLAY / 2, y: MARGIN },
    { x: w / 2 - DISPLAY / 2, y: h - DISPLAY - MARGIN },
    { x: MARGIN, y: h / 2 - DISPLAY / 2 },
    { x: w - DISPLAY - MARGIN, y: h / 2 - DISPLAY / 2 },
  ];
}

function spawnSpot() {
  return { x: innerWidth - DISPLAY - MARGIN, y: innerHeight - DISPLAY - MARGIN };
}

function setFrame(body, view, frame) {
  body.style.backgroundPosition = `-${frame * DISPLAY}px -${ROWS[view] * DISPLAY}px`;
}

function buildDom() {
  const root = document.createElement('div');
  root.className = 'tschobbo';
  root.style.cssText = `position:fixed; left:0; top:0; width:${DISPLAY}px; height:${DISPLAY}px; pointer-events:none; z-index:40;`;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(DISPLAY));
  svg.setAttribute('height', String(DISPLAY));
  svg.style.cssText = 'position:absolute; inset:0; overflow:visible;';

  const body = document.createElement('div');
  body.style.cssText = `position:absolute; inset:0; width:${DISPLAY}px; height:${DISPLAY}px; background-image:url(/tschobbo-sheet.png); background-repeat:no-repeat; background-size:${SHEET_W}px ${SHEET_H}px;`;

  root.appendChild(svg);
  root.appendChild(body);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.style.cssText = 'position:fixed; right:12px; bottom:12px; z-index:41; pointer-events:auto; font-family:var(--sans, sans-serif); font-size:11px; font-weight:600; letter-spacing:.02em; padding:4px 9px; border-radius:20px; border:1px solid var(--line, #2A323F); background:var(--panel, #1B212B); color:var(--muted, #8A94A6); cursor:pointer;';

  const style = document.createElement('style');
  style.textContent = TSCHOBBO_CSS;

  document.head.appendChild(style);
  document.body.appendChild(root);
  document.body.appendChild(toggle);
  return { root, svg, body, toggle, style };
}

export function initTschobbo() {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const { root, svg, body, toggle, style } = buildDom();
  const updateArms = createArms(svg);

  let timers = [];
  let frameTimer = null;
  let atFront = true;
  let destroyed = false;
  let enabledState = true;
  let posX = 0, posY = 0;

  // 'idle' | 'scrape' — 'scrape' deckt sowohl die Anfahrt an den Grid-Rand als
  // auch die eigentlichen Schübe ab. `busy` ist die Burst-Sperre: laeuft eine
  // Anfahrt oder ein Schub, wird ein eintreffendes Event ignoriert (keine
  // Queue, kein Nachholen — siehe docs/architecture.md).
  let mode = 'idle';
  let busy = false;
  let silenceTimer = null;

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
      const spots = edgeSpots();
      const target = spots[Math.floor(Math.random() * spots.length)];
      const travel = rand(DRIFT_TRAVEL_MIN, DRIFT_TRAVEL_MAX);
      place(target.x, target.y, travel);
      timers.push(setTimeout(() => { settleSquash(); scheduleDrift(); }, travel));
    }, wait));
  }

  // Kette front -> quarter -> side und zurück, nie direkt front -> side —
  // quarter ist die kurze Zwischenstufe (150–200ms), front/side sind die
  // Ruhezustände zwischen zwei Dreh-Ticks (8–15s).
  function scheduleTurn() {
    const wait = rand(TURN_WAIT_MIN, TURN_WAIT_MAX);
    timers.push(setTimeout(() => {
      const holdMs = rand(TURN_STEP_MIN, TURN_STEP_MAX);
      startFrameLoop('quarter');
      timers.push(setTimeout(() => {
        atFront = !atFront;
        startFrameLoop(atFront ? 'front' : 'side');
        scheduleTurn();
      }, holdMs));
    }, wait));
  }

  function startIdle() {
    atFront = true;
    startFrameLoop('front');
    scheduleDrift();
    scheduleTurn();
  }

  // Scrape-Beginn: dreht über die normale Dreh-Kette auf 'side' (kein Sonderfall,
  // gleiche Zwischenstufe/Timing wie scheduleTurn), fährt an den rechten Rand des
  // Viewports und parkt halb draußen. Zaehlt als busy, bis geparkt ist — das erste
  // Event triggert nur die Anfahrt, der erste Schub kommt erst mit dem naechsten.
  function parkForScrape() {
    busy = true;
    const finishPark = () => {
      requestAnimationFrame(() => {
        const gridRect = document.querySelector('.loadgrid')?.getBoundingClientRect();
        const parkX = innerWidth - DISPLAY / 2;
        const parkY = gridRect ? gridRect.top : posY;
        place(parkX, parkY, PARK_TRAVEL_MS);
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

  // Körper-Frames 0→4 einmal durchschalten (~90ms/Frame), parallel zur
  // Armstreckung. Läuft im selben frameTimer-Slot wie die Idle-Loops — die
  // 'side'-Loop danach wieder aufzunehmen ist Aufgabe des Aufrufers.
  function playBodyPushFrames() {
    if (frameTimer) clearInterval(frameTimer);
    let i = 0;
    setFrame(body, 'push', 0);
    frameTimer = setInterval(() => {
      i++;
      if (i >= FRAME_COUNTS.push) { clearInterval(frameTimer); frameTimer = null; return; }
      setFrame(body, 'push', i);
    }, PUSH_BODY_FRAME_MS);
  }

  // Ein Schub für eine fertige Grid-Zeile: Quadrate erst unsichtbar einfrieren
  // (LoadGrids eigene Pop-Animation würde sonst parallel mitlaufen), Arme
  // strecken sich zur Zeilenposition, am Umkehrpunkt (onContact) übernimmt der
  // Slide mit Stagger die Quadrate von LoadGrid.
  function doPush() {
    busy = true;
    requestAnimationFrame(() => {
      const rows = document.querySelectorAll('.loadgrid__row');
      const row = rows[rows.length - 1];
      const squares = row ? Array.from(row.querySelectorAll('.loadgrid__sq')) : [];
      if (!row || squares.length === 0) { busy = false; return; }

      squares.forEach(sq => { sq.style.animation = 'none'; sq.style.opacity = '0'; });

      const rowRect = row.getBoundingClientRect();
      const target = { x: rowRect.left + 6, y: rowRect.top + rowRect.height / 2 };
      place(posX, target.y, ROW_FOLLOW_MS);
      playBodyPushFrames();

      playPush(updateArms, { origin: () => ({ x: posX, y: posY }), scale: SCALE, target: () => target }, {
        extend: PUSH_EXTEND_MS,
        hold: PUSH_HOLD_MS,
        retract: PUSH_RETRACT_MS,
        onContact: () => {
          squares.forEach((sq, i) => {
            sq.style.removeProperty('animation');
            sq.style.setProperty('--tschobbo-delay', `${i * SLIDE_STAGGER_MS}ms`);
            sq.classList.add('tschobbo-arrive');
          });
        },
      });

      timers.push(setTimeout(() => {
        startFrameLoop('side');
        busy = false;
      }, PUSH_EXTEND_MS + PUSH_HOLD_MS + PUSH_RETRACT_MS));
    });
  }

  // Seele-Beat 3: Freuden-Hüpfer bei Scrape-Ende, danach zurück zu 'front' über
  // dieselbe Zwischenstufe wie scheduleTurn, dann zurück in den Idle-Zyklus.
  function endScrape() {
    if (mode !== 'scrape') return;
    mode = 'idle';
    busy = true;
    const hop = () => new Promise(resolve => {
      const anim = root.animate(
        [{ transform: 'translateY(0)' }, { transform: 'translateY(-10px)' }, { transform: 'translateY(0)' }],
        { duration: HOP_MS, easing: 'ease-out' }
      );
      anim.onfinish = resolve;
    });
    hop().then(hop).then(() => {
      startFrameLoop('quarter');
      timers.push(setTimeout(() => {
        busy = false;
        startIdle();
      }, rand(TURN_STEP_MIN, TURN_STEP_MAX)));
    });
  }

  function resetSilenceTimer() {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(endScrape, SCRAPE_SILENCE_MS);
  }

  function onGridUnit() {
    if (!enabledState || reduced) return;
    if (mode === 'idle') {
      clearTimers();
      mode = 'scrape';
      resetSilenceTimer();
      parkForScrape();
      return;
    }
    resetSilenceTimer();
    if (busy) return; // Burst-Regel: laufender Schub/Anfahrt schluckt das Event
    doPush();
  }

  window.addEventListener('tschobbo:unit', onGridUnit);

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

    if (reduced) {
      // Seele-Beat 1 (Reinschlüpfen) entfällt: höchstens statisch am Rand.
      place(spot.x, spot.y, 0);
      return;
    }

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
      root.remove();
      toggle.remove();
      style.remove();
    },
  };
}

initTschobbo();
