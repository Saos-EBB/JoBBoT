import { config } from '../config.ts';
import { loadJsonConfig } from './load-json-config.ts';

export const FILTER_MODES = ['regex', 'nimble'] as const;
export type FilterMode = typeof FILTER_MODES[number];

export function isFilterMode(v: unknown): v is FilterMode {
  return (FILTER_MODES as readonly unknown[]).includes(v);
}

// LLM-Inferenz-Parameter (backend-neutral, siehe lib/llm/types.ts), an EINER Stelle konfigurierbar (config/settings.json)
// statt an den Call-Sites verstreut. think:false unterdrückt den versteckten
// Reasoning-Anteil bei Modellen, die das können; writerTemperature gilt fürs Anschreiben
// (der JEV-Filter fragt fest mit 0). Modell und Kontextfenster
// stehen nicht hier, sondern im llama.cpp-Preset (config/llama-models.ini).
export interface InferenceSettings {
  think: boolean;
  writerTemperature: number;
}

// filterMode "nimble" (lib/filter-nimble.ts): welche Stellen überhaupt in Frage kommen.
// Geht wörtlich in die Frage ans Modell — hier tunen statt im Code.
export interface NimbleSettings {
  // Support-Rollen: nie brutal wegen Berufserfahrung, höchstens offstack.
  supportJobs: string[];
  // Alle anderen gewollten Bereiche.
  wantedJobs: string[];
}

export interface Settings {
  filterMode: FilterMode;
  inference: InferenceSettings;
  nimble: NimbleSettings;
}

const INFERENCE_DEFAULTS: InferenceSettings = {
  think: false,
  writerTemperature: 0.3,
};

const NIMBLE_DEFAULTS: NimbleSettings = {
  supportJobs: [
    'IT-Support, Helpdesk, Service Desk, technischer Support, Application Support, Applikationsbetreuung, Application Management, Ticketmanagement, 1st/2nd/3rd Level',
  ],
  wantedJobs: [
    'alles mit Coding: Softwareentwicklung, Programmierung, Web, App, Embedded, SPS/Automatisierung, Test/QA, Low-Code',
    'alles mit Technik/IT: IT-Techniker, Systemtechnik, Field Service, Systemadministration, Netzwerk, Cloud, DevOps, OT, IT-Security, Daten, KI, Digitalisierung, ERP/SAP, IT-Consulting',
    'Lehre, Praktikum, Trainee oder Werkstudent in einem dieser Bereiche oder im Support',
  ],
};

export function loadSettings(configDir: string = config.configDir): Settings {
  const parsed = loadJsonConfig<Partial<Settings>>(configDir, 'settings.json', {
    onMissing: () => 'config/settings.json fehlt.',
  });
  return {
    filterMode: parsed.filterMode ?? 'regex',
    inference: { ...INFERENCE_DEFAULTS, ...(parsed.inference ?? {}) },
    nimble: { ...NIMBLE_DEFAULTS, ...(parsed.nimble ?? {}) },
  };
}
