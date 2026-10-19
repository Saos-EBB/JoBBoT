## 2026-10-19 — Gmail-Sync erkennt 0 von 358 gesendeten Bewerbungen

**Symptom:** Nach dem Sync hatte kein Job `sentAt`, obwohl alle Bewerbungen in Gmail gelabelt sind.
**Ursache:** `istBewerbung` verglich den Label-Namen exakt; Kevins Label ist verschachtelt (`Bewerbungen/Beworben`) und kam über IMAP mit vollem Pfad.
**Fix:** Vergleich auf das letzte Pfadsegment, zusätzlich „Bewerbung" im Betreff ohne Antwort-/Weiterleitungs-Präfix.

## 2026-10-19 — ~190 doppelte „ohne Job"-Mail-Events nach dem Sync

**Symptom:** Nach dem Erkennungs-Fix landeten fast alle Bewerbungsmails zusätzlich als job-lose Events im Kalender/Nachweis.
**Ursache:** Die Zuordnung (`matchSent`) betrachtet nur Jobs ohne `sentAt` — eine Mail zu einem schon datierten Job fand dort keinen Job und galt als „ohne Job".
**Fix:** Vor dem Eintragen per `gehoertZuJob` (`lib/mail-match.ts`) gegen alle Jobs prüfen.

## 2026-10-19 — Sync-Test startet das echte JEV und schreibt in data/reply-kinds.json

**Symptom:** Nach `npm test` stand ein Eintrag der Testfirma „acme" im echten Antwort-Cache, Tests liefen spürbar länger.
**Ursache:** `runGmailSync` nimmt standardmäßig den JEV-Klassifizierer mit dem echten Cache-Pfad; die Sync-Tests gaben keinen eigenen mit.
**Fix:** Alle Sync-Tests injizieren `regexReplyClassifier`; der falsche Cache-Eintrag wurde überschrieben.

## 2026-10-18 — JEV-Filter braucht ~90 s pro Job

**Symptom:** Nimble 9B rechnete bei jedem Aufruf den kompletten Prompt neu, obwohl Schema und System-Prompt gleich blieben.
**Ursache:** Nimble ist ein hybrides/rekurrentes Modell — llama-server kann den Präfix-Cache dort nur über Kontext-Checkpoints nutzen, und die entstehen nur kurz vor dem Prompt-Ende und erst ab einer Mindestschrittweite.
**Fix:** Presets mit `checkpoint-min-step = 0`, `batch-size`/`ubatch-size = 32`; pro Lauf einmal den gemeinsamen Präfix allein schicken („Priming"), damit ein Checkpoint genau am Präfix-Ende liegt. Danach ~7 s/Job (Vulkan).

## 2026-10-09 — Modell-Download bricht still ab, curl meldet Erfolg

**Symptom:** Download von `gemma-4-26B_q4_0-it.gguf` (13,4 GB) endete nach 278 MB mit Exit-Code 0 und HTTP 200, die Datei war einfach zu kurz.
**Ursache:** Ursache unklar — die Verbindung endete, ohne dass curl einen Fehler meldete. Die Leitung schafft insgesamt nur ~1–1,4 MB/s, eine zweite parallele Verbindung bringt nichts.
**Fix:** Download-Schleife mit `curl -C -` (fortsetzen) und `--speed-limit/--speed-time`, bis die Dateigröße exakt der HF-API-Angabe entspricht, danach `sha256sum -c` gegen den LFS-Hash.

## 2026-10-09 — llama.cpp lädt Ollamas mistral-small3.2-Datei nicht

**Symptom:** `llama-server -m /usr/share/ollama/.ollama/models/blobs/sha256-41a5…` bricht ab: `done_getting_tensors: wrong number of tensors; expected 585, got 363`.
**Ursache:** Ollamas Blob ist zwar GGUF (Magic stimmt), aber in Ollamas eigenem Layout für dieses Modell (Vision-Teil im selben File, andere Tensor-Aufteilung) — kein Standard-GGUF, das llama.cpp erwartet.
**Fix:** Standard-GGUF neu laden (`unsloth/Mistral-Small-3.2-24B-Instruct-2506-GGUF`, Q4_K_M). Merke: Ollama-Blobs nicht als Abkürzung für llama.cpp einplanen, zumindest nicht bei multimodalen Modellen.

## 2026-08-06 — Klumpenwurf landet auf falschen Quadraten bei paralleler Multi-Source-Scrape

**Symptom:** Kevin meldete: Wurf-Animation feuert laufend ("spammt Würfe"), aber es tauchen keine sichtbaren Klumpen auf. Kein Fehler in der Konsole, per Playwright-Einzeltest (siehe Eintrag zu `3473dfe` unten) war das Feature vorher verifiziert.
**Ursache:** `onGridUnit()` in `ui/tschobbo.js` nahm kein Event-Argument entgegen und griff sich stattdessen die letzte `.loadgrid__row` im DOM ("ist schon die, die gerade dazukam"). Das stimmt nur bei einer aktiven Section. `runScrape()` (`lib/scrape-runner.ts`) läuft mit `maxConcurrent = 2`, die UI übergibt keinen Override — bei ≥2 ausgewählten Quellen verschachteln sich die SSE-Events zweier Sections. React rendert `sections.map` aber komplett section-weise, nicht chronologisch: alle Zeilen von Section 1 stehen im DOM vor allen Zeilen von Section 2, unabhängig davon, welche Section gerade ein neues Event schickt. Traf ein Event von Section 1 ein, während Section 2 (später begonnen, daher später im Array) bereits eine Zeile hatte, griff `rows[rows.length-1]` fälschlich die letzte Zeile von Section 2 — meist eine, die schon beworfen war. Der Wurf feuerte (Arm-Animation kümmert sich nicht ums Ziel), die Klumpen landeten aber auf dem falschen, oft schon vollen Quadrat statt auf dem frisch erschienenen — der Bug steckte schon seit dem ursprünglichen Wurf-Feature (`2d39706`), fiel nur nie auf, weil der Verifikations-Test nur eine Section hatte.
**Fix:** `ui/app.tsx` gibt jeder `.loadgrid__row` ein `data-row={r.key}`-Attribut. `onGridUnit(e)` liest `e.detail.row` (aus dem CustomEvent-Payload, der schon vorher mitgeschickt, aber ignoriert wurde) und sucht die Zeile gezielt per `querySelector('[data-row="…"]')` statt zu raten.

## 2026-08-06 — Geklebte Klumpen unsichtbar, nachdem sie DOM-Kinder ihres Quadrats wurden

**Symptom:** Nach dem Scroll-Tracking-Fix (Klumpen wird `appendChild`-Kind des Zielquadrats statt eigenständig `position:fixed`) waren alle geklebten Klumpen komplett unsichtbar — nicht nur beim Scrollen, sofort.
**Ursache:** `.loadgrid__sq--ghost` versteckte die Quadrate über `opacity:0 !important`. `opacity` ist keine reine Style-Vererbung, sondern eine Compositing-Eigenschaft: das Element und sein kompletter Subtree werden als eine Ebene mit dieser Deckkraft gerendert. Ein Kind mit eigenem `opacity:1` kann sich davon nicht befreien — es erbt zwangsläufig die 0-Deckkraft der Elternebene. Solange der geklebte Klumpen eigenständig `position:fixed` außerhalb des Quadrats positioniert war, fiel das nicht auf; sobald er ein echtes Kind des (unsichtbaren) Quadrats wurde, verschwand er mit.
**Fix:** Ghost-Regel von `opacity:0 !important` auf `visibility:hidden` umgestellt. Anders als `opacity` lässt sich `visibility` pro Nachfahre zurücksetzen (`visibility:visible` an einem Kind hebt ein `visibility:hidden` am Vorfahren gezielt für dieses Kind wieder auf) — `stick()` nutzt genau das. Merke für künftige "unsichtbarer Elternknoten, sichtbares Kind"-Fälle: `visibility`, nicht `opacity`, ist das Werkzeug dafür.

## 2026-08-06 — Klumpenwurf: nur der letzte Wurf einer Serie kommt an

**Symptom:** Bei mehreren Jobs in einem GridUnitEvent (6 Würfe in der Testrunde) landete nur ein einziger Klumpen als `stick` — alle anderen verschwanden spurlos, ohne Fehler in der Konsole.
**Ursache:** `throwOne()` löste den Blob-Release (`spawnFly`) aus dem Callback des `frameTimer`-`setInterval` heraus, bei Frame-Index 2 (~166ms nach Wurfstart). `drainThrowQueue()` startet aber alle `THROW_STAGGER_MS` (120ms) den nächsten Wurf, und jeder neue Wurf räumt zuerst das laufende `frameTimer`-Intervall weg (`clearInterval`), um sein eigenes Arm-Frame-Stepping zu starten. Bei 120ms Abstand < 166ms bis Frame 2 wurde das Intervall des vorigen Wurfs fast immer schon gekappt, bevor dessen Release-Frame je erreicht wurde — der Klumpen löste sich nie.
**Fix:** Release an einen eigenen `setTimeout(() => spawnFly(...), 2 * THROW_FRAME_MS)` gehängt, unabhängig vom `frameTimer`-Intervall. Das Intervall bleibt rein kosmetisch fürs Arm-Frame-Flackern und darf beliebig unterbrochen werden, ohne den Wurf selbst zu beeinflussen.
