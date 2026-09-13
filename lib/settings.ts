import { config } from '../config.ts';
import { loadJsonConfig } from './load-json-config.ts';

export type FilterMode = 'llm' | 'regex';

// Ollama-Inferenz-Parameter, an EINER Stelle konfigurierbar (config/settings.json)
// statt an den Call-Sites verstreut. think:false unterdrückt den versteckten
// Reasoning-Anteil bei qwen3-Modellen (bei gemma/mistral wirkungslos); numCtx ist das
// Kontextfenster; die zwei Temperaturen trennen determiniertes Filtern (0) vom etwas
// freieren Schreiben.
export interface InferenceSettings {
  think: boolean;
  numCtx: number;
  filterTemperature: number;
  writerTemperature: number;
}

export interface Settings {
  filterMode: FilterMode;
  filterModel: string;
  inference: InferenceSettings;
}

const INFERENCE_DEFAULTS: InferenceSettings = {
  think: false,
  numCtx: 4096,
  filterTemperature: 0,
  writerTemperature: 0.3,
};

export function loadSettings(configDir: string = config.configDir): Settings {
  const parsed = loadJsonConfig<Partial<Settings>>(configDir, 'settings.json', {
    onMissing: () => 'config/settings.json fehlt.',
  });
  return {
    filterMode: parsed.filterMode ?? 'regex',
    filterModel: parsed.filterModel ?? 'mistral-small3.2:latest',
    inference: { ...INFERENCE_DEFAULTS, ...(parsed.inference ?? {}) },
  };
}
