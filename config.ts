export const config = {
  ollamaHost: process.env.OLLAMA_HOST ?? 'http://localhost:11434',
  modelFilter: process.env.JOBBOT_MODEL_FILTER ?? 'mistral-small3.2:latest',
  modelWriter: process.env.JOBBOT_MODEL_WRITER ?? 'mistral-small3.2:latest',
  dataDir: 'data/jobs',
  anschreibenDir: 'data/anschreiben',
  attachmentsDir: 'data/attachments',
  gmailUser: process.env.GMAIL_USER,
  gmailAppPassword: process.env.GMAIL_APP_PASSWORD,
};
