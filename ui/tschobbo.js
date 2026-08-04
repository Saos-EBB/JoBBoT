/* Tschobbo — Maskottchen-Sprite-Layer. Reines DOM/CSS/JS, kein React, kein
 * Build-Schritt. Idle-Verhalten (Driften, Drehen, Seele-Beats) lebt hier;
 * der Schub-Teil (Arme/GridUnitEvents) baut auf denselben Zustand auf.
 *
 * z-Reihenfolge im Overlay: Arm-SVG < Koerper-Sprite (siehe tschobbo-arms.js).
 */

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

const STORAGE_KEY = 'tschobbo.enabled';

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

  document.body.appendChild(root);
  document.body.appendChild(toggle);
  return { root, svg, body, toggle };
}

export function initTschobbo() {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const { root, svg, body, toggle } = buildDom();

  let timers = [];
  let frameTimer = null;
  let atFront = true;
  let destroyed = false;

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
    if (frameTimer) { clearInterval(frameTimer); frameTimer = null; }
  }

  function place(x, y, durationMs) {
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

  function setToggleLabel(on) {
    toggle.textContent = on ? 'Tschobbo: an' : 'Tschobbo: aus';
  }

  function enable() {
    localStorage.setItem(STORAGE_KEY, 'true');
    setToggleLabel(true);
    root.style.display = '';
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
    setToggleLabel(false);
    clearTimers();
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
      root.remove();
      toggle.remove();
    },
  };
}

initTschobbo();
