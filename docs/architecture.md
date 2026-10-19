# Architektur

## Überblick

Job-Application-Automation-Bot: Scrapen → Filtern (Regex oder JEV) → Anschreiben generieren → Review/Versand. `scripts/ui-server.ts` ist ein plain-Node-`http`-Server, server-gerendertes HTML-Grundgerüst, das eine React-SPA (`ui/app.tsx`, per `esbuild` zu `ui/dist/app.js` gebaut) lädt. Fortschritt für Scrape/Filter/Anschreiben läuft über SSE (`GridUnitEvent`), gerendert im `LoadGrid`.

## Module

- `scripts/ui-server.ts` — HTTP-Routen (`/api/*`), SSE-Kanäle, statische Auslieferung von `app.js` (aus `ui/dist/`) und den Tschobbo-Assets (aus `ui/`, siehe unten).
- `ui/app.tsx` — die gesamte React-UI in einer Datei (Sidebar, Job-Liste/-Detail, LoadGrid, Kalender). Kein Router, `view`-State schaltet zwischen Vollbild-Modi.
- `ui/tschobbo.js`, `ui/tschobbo-arms.js`, `ui/tschobbo-sheet.png` — Maskottchen-Sprite-Layer, siehe eigener Abschnitt.
- `lib/llm/` — LLM-Backend hinter einer Schnittstelle, siehe eigener Abschnitt.
- `lib/filter-nimble.ts` + `lib/nimble-client.ts` + `lib/filter-judgment.ts` — JEV-Filter (Bespoke Nimble 9B, `filterMode: nimble`): ein Feld pro Aufruf, Ein-Buchstaben-Antwort hinter einem gemeinsamen, einmal pro Lauf geprimten Schema-Präfix. `wanted_job` (Support / anderer Wunschbereich / keiner, Listen in `config/settings.json` → `nimble`) bekommt Titel + Beschreibungsanfang, die Erfahrungsfrage nur Sätze mit Mengenangabe. `nimble-client.ts` ist der gemeinsame JEV-Client (auch für die Antwort-Art), `filter-judgment.ts` mappt das Urteil auf matched/uncertain/filtered_out.
- `lib/gmail-sync.ts` + `lib/reply-kind-jev.ts` + `lib/reply-kind.ts` — Gmail-Sync (read-only gegenüber Gmail): erkennt Bewerbungen im Gesendet-Ordner (`istBewerbung` in `mail/gmail.ts`: Label, auch verschachtelt, oder „Bewerbung" im Betreff; Mails nur an die eigene Adresse zählen nicht), trägt `sentAt`/`replyReceivedAt` nach, schiebt Postausgang-Jobs nach `gesendet`, sobald ihr Entwurf im Gesendet-Ordner auftaucht (einzige Statusänderung des Syncs), und lässt JEV die Texte zugeordneter Antworten in `job.replyKind` einordnen (`eingang` < `antwort` < `datenschutz`/`plattform` < `zusage` < `absage`; Cache `data/reply-kinds.json`, kein Urteil → bleibt offen). Der Regex aus `lib/reply-kind.ts` ist nur noch `regexReplyClassifier` für Tests. Der Kalender zeigt Absagen als eigenen Typ.
- `lib/nachweis.ts` + `scripts/routes/nachweis.ts` — Bewerbungsnachweis fürs AMS: `GET /nachweis?von=&bis=` liefert eine eigene druckfertige HTML-Seite (nicht Teil der SPA) aus gesendeten Jobs + job-losen Gmail-Bewerbungsmails, mit Antwort-Art aus dem Gmail-Sync (`lib/reply-kind.ts`).

## Tschobbo (Maskottchen-Sprite)

Reines DOM/CSS/JS-Overlay (`position:fixed`, `pointer-events:none`), kein React, kein Build-Schritt — ES-Module direkt im Browser geladen (`<script type="module" src="/tschobbo.js">` neben `<script type="module" src="/app.js">`). Ein Modul (`initTschobbo()` → `{ destroy() }`), ein Hook in `ui/app.tsx`, zwei Assets. Rückbau: Dateien + Hook-Zeile löschen = Feature weg.

**Entscheidungen** (Datum, neue oben):

- **2026-08-04 — Quadrat-Zielposition: volle Choreografie (Regel 1 = Geht).** `LoadGrid` (`ui/app.tsx`) hängt neue `.loadgrid__sq`-Elemente bereits beim Eintreffen des SSE-Events ins DOM, an ihrer finalen Grid-Position — sichtbar werden sie nur durch CSS-`animation-delay` (`opacity:0 → 1`, `loadgrid-pop`/`loadgrid-color`), nicht durch nachträgliches Verschieben. `getBoundingClientRect()` auf dem frisch gemounteten Quadrat liefert damit sofort die echte Endposition. Tschobbos Arme strecken sich exakt dorthin, kein Fallback nötig.
- **2026-08-04 — Statische Auslieferung: eigener Whitelist-Handler (Regel 2 = Nein).** `ui-server.ts` liefert bisher nur eine einzige hartkodierte Route (`GET /app.js` liest `ui/dist/app.js`), kein generischer Static-File-Server. Drei neue Routen nach demselben Muster: `GET /tschobbo-sheet.png`, `GET /tschobbo-arms.js`, `GET /tschobbo.js`, alle aus `ui/` (unbundled, Geschwisterordner von `app.tsx`).
- **2026-08-04 — Script-Muster: ES-Module (Regel 3).** Die Index-Route bindet `app.js` bereits als `type="module"` ein. `tschobbo-arms.js`/`tschobbo.js` bleiben bei `export function`/`import` wie im Auftrag vorgegeben, zweiter `<script type="module">`-Tag in der Index-Route.
- **2026-08-04 — Scrape-Zustand: aus GridUnitEvents ableiten (Regel 4 = Nein).** Es gibt zwar `scrapeStatus`/`scrapeStarting` in `JobbotUI`, aber das ist React-`useState`, nicht außerhalb der Komponente erreichbar — Tschobbo lebt bewusst außerhalb des React-Baums. Der eine Hook: im bestehenden `useEffect` für `/api/scrape/stream` (nach `setScrapeSections(...)`) feuert `ui/app.tsx` zusätzlich `window.dispatchEvent(new CustomEvent('tschobbo:unit', { detail: event }))`. Tschobbo selbst filtert nicht nach `section` — die Beschränkung "nur Scrape reagiert" sitzt strukturell allein darin, dass aktuell nur der Scrape-Effekt den Hook auslöst. Filter/Anschreiben bekommen später denselben Einzeiler in ihren jeweiligen Effects, ohne Tschobbo selbst anzufassen. Start = erstes empfangenes Event, Ende = 5s ohne Event (Timer im Modul).

**Beobachtung (kein Entscheidungspunkt, zur Kenntnis):** `docs/build-log.md` (2026-07-31, "quadrate erscheinen einzeln gestaffelt") dokumentiert, dass Kevins GNOME-Setup `prefers-reduced-motion: reduce` systemweit meldet (Bedienungshilfen-Einstellung, nicht bewusste Bewegungsempfindlichkeit) und die `loadgrid-pop`-Animation deshalb bereits einmal komplett totgeschaltet war — die Media-Query wurde dort daraufhin entfernt. Der Tschobbo-Auftrag verlangt `prefers-reduced-motion`-Handling als Pflichtteil; das wird wie vorgegeben gebaut, aber: falls Kevins System weiterhin `reduce` meldet, steht Tschobbo beim Live-Test in der echten Umgebung von Anfang an still (Idle/Drift/Seele-Beats aus), bis das OS-Flag umgestellt oder im DevTools-Override auf "no preference" gesetzt wird. Kein Bug, aber derselbe Stolperstein wie beim LoadGrid — für den Verifizieren-Schritt gemeldet statt stillschweigend gebaut.

## LLM-Backend (`lib/llm/`)

Filter (`lib/filter-nimble.ts`, JEV), Anschreiben (`lib/anschreiben.ts`), Runner, Health-Checks (`run.ts`, `scripts/check-llm.ts`) und der Bench sprechen nur mit `getProvider()` (`lib/llm/index.ts`) — nie direkt mit einem Backend. `getProvider()` wählt per `JOBBOT_LLM_PROVIDER` (Default `llamacpp`, derzeit einziger Eintrag) aus einer Registry; unbekannter Name wirft.

- `lib/llm/types.ts` — `LlmProvider` (`chat`, `ensureReady`, `check`, `resolveModels`, `missingHint`, optional `unload`) und das neutrale `ChatRequest` (`json`, `think`, `temperature`, `host`).
- `lib/llm/llamacpp.ts` — llama.cpp: `llama-server` im Router-Modus (`scripts/llama-server.sh`, Presets `config/llama-models.ini`, Log `data/llama-server.log`). Modellname = Preset-Name; Threads, Kontext und GPU-Offload stehen im Preset, nicht im Request.
- `lib/llm/openai-compat.ts` — gemeinsamer Client für OpenAI-kompatible `/v1/chat/completions` (SSE-Stream), von llama.cpp genutzt.
- `lib/llm/local-server.ts` — gemeinsamer "lokalen Server bei Bedarf starten"-Ablauf (von llama.cpp genutzt).

Retry/Regenerierung bleiben beim Aufrufer (parse-spezifisch), der Provider wirft nur bei Netzwerk-/HTTP-Fehlern.

**Entscheidungen** (neue oben):

- **2026-10-19 — Antwort-Art per JEV statt Regex.** Der Regex kannte nur Absage/Eingang/Antwort und übersah Formulierungen; Kevin will zusätzlich Zusage, Datenschutz-Zustimmung und Portal-Aufforderung. Im Bench auf 90 echten Mails lag JEV klar vorn. Der Regex bleibt im Code (`regexReplyClassifier`), damit Tests ohne Modell laufen.
- **2026-10-19 — LLM-Filter (Gemma, JSON-Urteil) entfernt, JEV (Bespoke Nimble 9B) ist der einzige Modell-Filter.** Im Bench (`data/filter-bench/`) traf Nimble mit Ein-Buchstaben-Antworten pro Kriterium 92 % bei ~7 s/Job (Vulkan). `filterMode` kennt nur noch `regex` und `nimble`; `JOBBOT_LLAMACPP_FILTER_MODEL` und `filterTemperature` sind weg, der `filter`-Slot des Providers zeigt auf `JOBBOT_LLAMACPP_NIMBLE_MODEL`.
- **2026-10-09 — Ollama entfernt, llama.cpp ist das einzige Backend.** Ollama war nicht mehr installiert, und der Vergleich ergab gemma-4-26B auf llama.cpp (CPU) als Anschreiben-Modell. Mit Ollama fielen `OLLAMA_HOST`, `JOBBOT_MODEL_WRITER/FILTER`, `settings.filterModel`, `settings.inference.numCtx` und die `num_thread`-Abstufung pro Retry weg (Kontext und Threads stehen im Preset). Die `LlmProvider`-Schnittstelle bleibt, obwohl sie nur noch eine Implementierung hat.
- **2026-10-09 — llama.cpp im Router-Modus statt ein Server pro Modell.** Ein Prozess, Modelle per Request-Name, `--models-max 1` → laden bei Bedarf, entladen per `/models/unload`, und CPU vs. Vulkan lässt sich als zwei Presets desselben GGUF im selben Bench vergleichen. Binary und GGUFs liegen außerhalb des Repos (`~/.local/opt/llama.cpp/current`, `~/.local/share/llama-models`).
- **2026-10-09 — Provider-Wahl per env, Modelle pro Provider.** Jedes Backend liest Host und Modellnamen selbst (llama.cpp: `LLAMACPP_HOST`, `JOBBOT_LLAMACPP_MODEL`, `JOBBOT_LLAMACPP_NIMBLE_MODEL`).
