## 2026-07-17 — chore(data): clear data/jobs/sicher and unsicher (intentional, per Kevin)
**Was:** 145 Job-JSONs aus `data/jobs/sicher/` und `data/jobs/unsicher/` entfernt (144 Deletes + 1 zuvor modifizierte Datei). Verursacht durch mehrere parallel laufende `ui-server.ts`-Prozesse (3 gleichzeitig, seit 11:23 bzw. 11:49) — auf Nachfrage bestätigt: gewollt, nicht versehentlich. Zwei überzählige Prozesspaare beendet, ein sauberer Lauf bleibt aktiv.
**Nicht gebaut:** —

## 2026-07-17 — refactor(anschreiben): extract shared runner, wire into UI server, fix stale test assertions
**Was:** `lib/anschreiben-runner.ts` extrahiert den Anschreiben-Generierungs-Loop aus `scripts/run-anschreiben.ts`, damit `scripts/ui-server.ts` ihn über `POST /api/anschreiben` + `GET /api/anschreiben/status` wiederverwenden kann statt ihn zu duplizieren. `lib/anschreiben.ts` persistiert den `generated`-Status jetzt via `storage.update()` statt `storage.save(job)` (Merge auf aktuellen Diskstand statt Überschreiben — Generierung dauert 3-4 Min, in denen ein Browser-Edit passieren kann). Drei Tests in `test/anschreiben.test.ts` prüften noch das dadurch nicht mehr mutierte lokale `job`-Objekt statt den Storage-Stand — korrigiert.
**Nicht gebaut:** kein Frontend-UI (Button/Polling) für den neuen Endpoint — `ui/app.tsx` hat nur die State-Typen, keine Bedienelemente.
