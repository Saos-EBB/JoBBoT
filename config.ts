export const config = {
  ollamaHost: process.env.OLLAMA_HOST ?? 'http://localhost:11434',
  modelFilter: process.env.JOBBOT_MODEL_FILTER ?? 'qwen2.5:3b',
  modelWriter: process.env.JOBBOT_MODEL_WRITER ?? 'qwen2.5:7b',
  dataDir: 'data/jobs',
  anschreibenDir: 'data/anschreiben',
};
