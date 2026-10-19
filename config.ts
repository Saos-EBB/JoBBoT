export const config = {
  // Welches LLM-Backend läuft (lib/llm/index.ts). Host/Modelle liest jeder Provider selbst.
  llmProvider: process.env.JOBBOT_LLM_PROVIDER ?? 'llamacpp',
  // llama.cpp-Router (scripts/llama-server.sh). Modellnamen = Preset-Namen aus
  // config/llama-models.ini.
  llamacppHost: process.env.LLAMACPP_HOST ?? 'http://127.0.0.1:8089',
  llamacppModelWriter: process.env.JOBBOT_LLAMACPP_MODEL ?? 'gemma4-26b-cpu',
  // Klassifizierer für filterMode "nimble" (lib/filter-nimble.ts, UI-Button "JEV") — eigenes
  // Prompt-Format, daher eigenes Preset. Vulkan: ~7 s/Job gegenüber ~50 s auf der CPU
  // bei gleichen Urteilen.
  llamacppModelNimble: process.env.JOBBOT_LLAMACPP_NIMBLE_MODEL ?? 'nimble-9b-vulkan',
  // Alle Pfade sind cwd-relativ, wie dataDir seit jeher. Bis August 2026 loesten die
  // Config-Loader modul-relativ auf (new URL('../config/…', import.meta.url)) und lasen
  // damit IMMER aus dem Repo, egal von wo der Prozess gestartet wurde — waehrend data/
  // dem Arbeitsverzeichnis folgte. Zwei Aufloesungsstrategien fuer benachbarte
  // Verzeichnisse, und lib/profile.ts machte es sogar innerhalb von config/ anders als
  // seine vier Nachbarn.
  configDir: 'config',
  dataDir: 'data/jobs',
  anschreibenDir: 'data/anschreiben',
  attachmentsDir: 'data/attachments',
  gmailUser: process.env.GMAIL_USER,
  gmailAppPassword: process.env.GMAIL_APP_PASSWORD,
  mailDryRun: process.env.MAIL_DRY_RUN === 'true',
};
