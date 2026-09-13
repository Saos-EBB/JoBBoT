import { config } from '../config.ts';
import { loadJsonConfig } from './load-json-config.ts';

export interface ProfileData {
  name: string;
  job_title: string;
  quereinstieg: { bootcamp: string; abschluss: string; hintergrund: string; story_url?: string };
  skills: { sprachen: string[]; frontend: string[]; backend: string[]; datenbanken: string[]; tools: string[] };
  sprachkenntnisse: string[];
  links?: { website?: string; github?: string };
  projekte: Array<{ name: string; beschreibung: string; tech?: string[]; anchor?: boolean }>;
}

// Über config.configDir wie die vier Nachbar-Loader. Vorher stand der Pfad hier als
// einziger fest verdrahtet — heute derselbe Ort, weil configDir genau "config" ist,
// aber ein anderer Wert hätte profile.json still woanders gesucht als den Rest.
export function loadProfile(configDir: string = config.configDir): ProfileData {
  return loadJsonConfig<ProfileData>(configDir, 'profile.json', {
    onMissing: path => `${path} fehlt — kopiere profile.example.json daneben und fülle es aus`,
    wrapParseErrors: true,
  });
}
