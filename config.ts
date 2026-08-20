export const config = {
  ollamaHost: process.env.OLLAMA_HOST ?? 'http://localhost:11434',
  modelFilter: process.env.JOBBOT_MODEL_FILTER ?? 'mistral-small3.2:latest',
  modelWriter: process.env.JOBBOT_MODEL_WRITER ?? 'mistral-small3.2:latest',
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
