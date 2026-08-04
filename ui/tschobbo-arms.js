/* Tschobbo-Arme zur Laufzeit.
 *
 * Die Stopf-Zeile im Sprite-Sheet enthaelt nur den Koerper (push_body).
 * Die Arme werden hier als SVG gezeichnet, damit ihre Spitze exakt die
 * Endposition des Quadrats erreicht - egal wie weit die entfernt ist.
 *
 * z-Reihenfolge: Grid < Arme < Koerper-Sprite. Der Koerper verdeckt den
 * Ansatz, deshalb braucht es keine Naht-Behandlung.
 */

const OUTLINE = '#43105E';
const BODY = '#9B3ACF';

// Ansatzpunkte im lokalen 96er-Koordinatensystem des Sprites (Seitenansicht).
// curl = Bogen des Arms, alternierend fuer einen faecherartigen Schub.
const ANCHORS = [
  { x: 36, y: 44, curl: -0.13, w: 11 },
  { x: 33, y: 54, curl: 0.05, w: 11 },
  { x: 37, y: 63, curl: 0.16, w: 10 },
];

/** Tapered Tentakel von (x0,y0) nach (ex,ey). Gleiche Bauweise wie im Generator. */
export function armPath(x0, y0, ex, ey, curl, w0) {
  const dx = ex - x0, dy = ey - y0;
  const L = Math.hypot(dx, dy) || 1;
  const ax = dx / L, ay = dy / L;      // Richtung
  const px = -ay, py = ax;             // Normale
  const bow = curl * L;                // Bogen skaliert mit der Distanz

  // Lange Arme werden duenner - gestreckter Schleim
  const w = Math.max(5, w0 - L * 0.006);
  const h = w / 2;

  const c1x = x0 + ax * L * 0.45 + px * bow * 0.8;
  const c1y = y0 + ay * L * 0.45 + py * bow * 0.8;
  const c2x = x0 + ax * L * 0.8 + px * bow;
  const c2y = y0 + ay * L * 0.8 + py * bow;

  // Ansatz nach hinten verlaengert, damit er unter dem Koerper verschwindet
  const bx = x0 - ax * 8, by = y0 - ay * 8;

  return `M ${bx + px * h * 1.15} ${by + py * h * 1.15}` +
    ` C ${c1x + px * h * 0.55} ${c1y + py * h * 0.55}` +
    ` ${c2x + px * h * 0.22} ${c2y + py * h * 0.22} ${ex} ${ey}` +
    ` C ${c2x - px * h * 0.22} ${c2y - py * h * 0.22}` +
    ` ${c1x - px * h * 0.55} ${c1y - py * h * 0.55}` +
    ` ${bx - px * h * 1.15} ${by - py * h * 1.15} Z`;
}

/** Legt die drei Arm-Pfade an und gibt eine update()-Funktion zurueck. */
export function createArms(svg) {
  const paths = ANCHORS.map(() => {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('fill', BODY);
    p.setAttribute('stroke', OUTLINE);
    p.setAttribute('stroke-width', '4.4');
    p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);
    return p;
  });

  /**
   * @param origin {x,y}  Position des Sprites in Screen-Koordinaten (linke obere Ecke)
   * @param scale         Anzeigegroesse / 96
   * @param target {x,y}  Endposition des Quadrats in Screen-Koordinaten
   * @param p             0..1 Streckung (0 = eingezogen, 1 = Spitze am Ziel)
   * @param spread        vertikale Faecherung der Spitzen in px
   */
  return function update(origin, scale, target, p, spread = 14) {
    const ease = 1 - Math.pow(1 - p, 3);           // easeOutCubic
    paths.forEach((el, i) => {
      const a = ANCHORS[i];
      const x0 = origin.x + a.x * scale;
      const y0 = origin.y + a.y * scale;
      const ty = target.y + (i - (ANCHORS.length - 1) / 2) * spread;
      // Spitze faehrt vom Koerper zum Ziel
      const ex = x0 + (target.x - x0) * ease;
      const ey = y0 + (ty - y0) * ease;
      el.setAttribute('d', armPath(x0, y0, ex, ey, a.curl, a.w * scale));
      el.style.opacity = p < 0.02 ? '0' : '1';
    });
  };
}

/**
 * Ein Schub: ausfahren, kurz halten, einziehen.
 * onContact() feuert am Umkehrpunkt - dort startet der Slide der Quadrate.
 */
export function playPush(update, ctx, { extend = 180, hold = 60, retract = 200, onContact }) {
  const t0 = performance.now();
  let fired = false;
  function step(now) {
    const t = now - t0;
    let p;
    if (t < extend) p = t / extend;
    else if (t < extend + hold) p = 1;
    else p = Math.max(0, 1 - (t - extend - hold) / retract);

    if (!fired && t >= extend) { fired = true; onContact && onContact(); }
    update(ctx.origin(), ctx.scale, ctx.target(), p);
    if (t < extend + hold + retract) requestAnimationFrame(step);
    else update(ctx.origin(), ctx.scale, ctx.target(), 0);
  }
  requestAnimationFrame(step);
}
