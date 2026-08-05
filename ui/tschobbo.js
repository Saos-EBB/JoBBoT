/* Tschobbo — Maskottchen-Sprite-Layer. Reines DOM/CSS/JS, kein React, kein
 * Build-Schritt. Idle-Verhalten (Driften, Drehen, Seele-Beats) lebt hier;
 * der Scrape-Teil reagiert auf 'tschobbo:unit' (siehe ui/app.tsx, Hook im
 * /api/scrape/stream-Effect — nur dort wird das Event gefeuert, das ist die
 * ganze "v1 reagiert nur auf Scrape"-Beschränkung, siehe docs/architecture.md).
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

const STORAGE_KEY = 'tschobbo.enabled';

// Macht die Scrape-Quadrate unsichtbar (Klumpen übernehmen die Anzeige), ohne
// LoadGrids Layout/Pop-Timing anzufassen — Quadrate bleiben im Fluss (Tschobbo
// braucht ihre Positionen als Wurfziele), nur Sichtbarkeit + Interaktion aus.
// !important noetig: loadgrid-pop animiert opacity selbst auf 1, eine normale
// Klassenregel wuerde die laufende Animation nicht schlagen.
const TSCHOBBO_CSS = `
.loadgrid__sq--ghost { opacity:0 !important; pointer-events:none; }`;

function rand(min, max) { return min + Math.random() * (max - min); }

// Idle-Driftziel: fest rechter Rand, vertikal mittig — kein Rand-Sampling mehr.
function rightMidSpot() {
  return { x: innerWidth - DISPLAY - MARGIN, y: innerHeight / 2 - DISPLAY / 2 };
}

function spawnSpot() {
  return { x: innerWidth - DISPLAY - MARGIN, y: innerHeight - DISPLAY - MARGIN };
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

function buildDom() {
  const root = document.createElement('div');
  root.className = 'tschobbo';
  root.style.cssText = `position:fixed; left:0; top:0; width:${DISPLAY}px; height:${DISPLAY}px; pointer-events:none; z-index:40;`;

  const body = document.createElement('div');
  body.style.cssText = `position:absolute; inset:0; width:${DISPLAY}px; height:${DISPLAY}px; background-image:url(/tschobbo-sheet.png); background-repeat:no-repeat; background-size:${SHEET_W}px ${SHEET_H}px;`;

  root.appendChild(body);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.style.cssText = 'position:fixed; right:12px; bottom:12px; z-index:41; pointer-events:auto; font-family:var(--sans, sans-serif); font-size:11px; font-weight:600; letter-spacing:.02em; padding:4px 9px; border-radius:20px; border:1px solid var(--line, #2A323F); background:var(--panel, #1B212B); color:var(--muted, #8A94A6); cursor:pointer;';

  const style = document.createElement('style');
  style.textContent = TSCHOBBO_CSS;

  document.head.appendChild(style);
  document.body.appendChild(root);
  document.body.appendChild(toggle);
  return { root, body, toggle, style };
}

export function initTschobbo() {
  const { root, body, toggle, style } = buildDom();

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
  let throwQueue = [];

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
  // als kurze Zwischenstufe, 150–200ms, TURN_STEP_MIN/MAX), fährt an den rechten
  // Rand des Viewports und parkt halb draußen. Zaehlt als busy, bis geparkt ist —
  // das erste Event triggert nur die Anfahrt, der erste Schub kommt erst mit dem
  // naechsten.
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

  // Ein Klumpen fliegt auf einer Parabel (Formel, keine Physik-Engine) von der
  // Wurfhand zum Ziel und rotiert dabei durch seine 4 fly-Frames. Bleibt am Ziel
  // hängen (stick) — der Fallen-Fall kommt erst in Step 3.
  function spawnFly(origin, target) {
    const el = makeBlobEl();
    document.body.appendChild(el);
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
      else {
        setBlobFrame(el, 'stick', 0);
        el.style.left = `${target.x}px`;
        el.style.top = `${target.y}px`;
      }
    }
    requestAnimationFrame(step);
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

    timers.push(setTimeout(() => spawnFly(origin, target), 2 * THROW_FRAME_MS));
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
    if (throwQueue.length === 0) return;
    if (busy) { timers.push(setTimeout(drainThrowQueue, THROW_STAGGER_MS)); return; }
    const el = throwQueue.shift();
    throwOne(el);
    timers.push(setTimeout(drainThrowQueue, THROW_STAGGER_MS));
  }

  // Seele-Beat 3: Freuden-Hüpfer bei Scrape-Ende, danach zurück zu 'front' über
  // dieselbe Zwischenstufe wie beim Scrape-Start (TURN_STEP_MIN/MAX), dann
  // zurück in den Idle-Zyklus.
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

  // Pro Event: Stille-Timer zurücksetzen, beim allerersten zusätzlich anfahren.
  // Die Quadrate der zuletzt angehängten Zeile (React braucht einen Frame zum
  // Rendern, daher rAF — gleiches Muster wie das alte doPush) sind die Wurfziele,
  // auch für das erste Event ("wir wollen alle Jobs sehen", Auftrag-Burst-Regel).
  function onGridUnit() {
    if (!enabledState) return;
    if (mode === 'idle') {
      clearTimers();
      mode = 'scrape';
      throwQueue = [];
      resetSilenceTimer();
      parkForScrape();
    } else {
      resetSilenceTimer();
    }
    requestAnimationFrame(() => {
      const rows = document.querySelectorAll('.loadgrid__row');
      const row = rows[rows.length - 1];
      if (!row) return;
      queueThrows(Array.from(row.querySelectorAll('.loadgrid__sq')));
    });
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
