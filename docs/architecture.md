# Architektur

## Überblick

Job-Application-Automation-Bot: Scrapen → Filtern (LLM/Regex) → Anschreiben generieren → Review/Versand. `scripts/ui-server.ts` ist ein plain-Node-`http`-Server, server-gerendertes HTML-Grundgerüst, das eine React-SPA (`ui/app.tsx`, per `esbuild` zu `ui/dist/app.js` gebaut) lädt. Fortschritt für Scrape/Filter/Anschreiben läuft über SSE (`GridUnitEvent`), gerendert im `LoadGrid`.

## Module

- `scripts/ui-server.ts` — HTTP-Routen (`/api/*`), SSE-Kanäle, statische Auslieferung von `app.js` (aus `ui/dist/`) und den Tschobbo-Assets (aus `ui/`, siehe unten).
- `ui/app.tsx` — die gesamte React-UI in einer Datei (Sidebar, Job-Liste/-Detail, LoadGrid, Kalender). Kein Router, `view`-State schaltet zwischen Vollbild-Modi.
- `ui/tschobbo.js`, `ui/tschobbo-arms.js`, `ui/tschobbo-sheet.png` — Maskottchen-Sprite-Layer, siehe eigener Abschnitt.

## Tschobbo (Maskottchen-Sprite)

Reines DOM/CSS/JS-Overlay (`position:fixed`, `pointer-events:none`), kein React, kein Build-Schritt — ES-Module direkt im Browser geladen (`<script type="module" src="/tschobbo.js">` neben `<script type="module" src="/app.js">`). Ein Modul (`initTschobbo()` → `{ destroy() }`), ein Hook in `ui/app.tsx`, zwei Assets. Rückbau: Dateien + Hook-Zeile löschen = Feature weg.

**Entscheidungen** (Datum, neue oben):

- **2026-08-04 — Quadrat-Zielposition: volle Choreografie (Regel 1 = Geht).** `LoadGrid` (`ui/app.tsx`) hängt neue `.loadgrid__sq`-Elemente bereits beim Eintreffen des SSE-Events ins DOM, an ihrer finalen Grid-Position — sichtbar werden sie nur durch CSS-`animation-delay` (`opacity:0 → 1`, `loadgrid-pop`/`loadgrid-color`), nicht durch nachträgliches Verschieben. `getBoundingClientRect()` auf dem frisch gemounteten Quadrat liefert damit sofort die echte Endposition. Tschobbos Arme strecken sich exakt dorthin, kein Fallback nötig.
- **2026-08-04 — Statische Auslieferung: eigener Whitelist-Handler (Regel 2 = Nein).** `ui-server.ts` liefert bisher nur eine einzige hartkodierte Route (`GET /app.js` liest `ui/dist/app.js`), kein generischer Static-File-Server. Drei neue Routen nach demselben Muster: `GET /tschobbo-sheet.png`, `GET /tschobbo-arms.js`, `GET /tschobbo.js`, alle aus `ui/` (unbundled, Geschwisterordner von `app.tsx`).
- **2026-08-04 — Script-Muster: ES-Module (Regel 3).** Die Index-Route bindet `app.js` bereits als `type="module"` ein. `tschobbo-arms.js`/`tschobbo.js` bleiben bei `export function`/`import` wie im Auftrag vorgegeben, zweiter `<script type="module">`-Tag in der Index-Route.
- **2026-08-04 — Scrape-Zustand: aus GridUnitEvents ableiten (Regel 4 = Nein).** Es gibt zwar `scrapeStatus`/`scrapeStarting` in `JobbotUI`, aber das ist React-`useState`, nicht außerhalb der Komponente erreichbar — Tschobbo lebt bewusst außerhalb des React-Baums. Der eine Hook: im bestehenden `useEffect` für `/api/scrape/stream` (nach `setScrapeSections(...)`) feuert `ui/app.tsx` zusätzlich `window.dispatchEvent(new CustomEvent('tschobbo:unit', { detail: event }))`. Tschobbo selbst filtert nicht nach `section` — die Beschränkung "nur Scrape reagiert" sitzt strukturell allein darin, dass aktuell nur der Scrape-Effekt den Hook auslöst. Filter/Anschreiben bekommen später denselben Einzeiler in ihren jeweiligen Effects, ohne Tschobbo selbst anzufassen. Start = erstes empfangenes Event, Ende = 5s ohne Event (Timer im Modul).

**Beobachtung (kein Entscheidungspunkt, zur Kenntnis):** `docs/build-log.md` (2026-07-31, "quadrate erscheinen einzeln gestaffelt") dokumentiert, dass Kevins GNOME-Setup `prefers-reduced-motion: reduce` systemweit meldet (Bedienungshilfen-Einstellung, nicht bewusste Bewegungsempfindlichkeit) und die `loadgrid-pop`-Animation deshalb bereits einmal komplett totgeschaltet war — die Media-Query wurde dort daraufhin entfernt. Der Tschobbo-Auftrag verlangt `prefers-reduced-motion`-Handling als Pflichtteil; das wird wie vorgegeben gebaut, aber: falls Kevins System weiterhin `reduce` meldet, steht Tschobbo beim Live-Test in der echten Umgebung von Anfang an still (Idle/Drift/Seele-Beats aus), bis das OS-Flag umgestellt oder im DevTools-Override auf "no preference" gesetzt wird. Kein Bug, aber derselbe Stolperstein wie beim LoadGrid — für den Verifizieren-Schritt gemeldet statt stillschweigend gebaut.
