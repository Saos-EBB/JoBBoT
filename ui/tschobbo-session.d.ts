export type ScrapeSession = {
  readonly generation: number;
  readonly active: boolean;
  isCurrent(gen: number): boolean;
  begin(): number;
  finish(): void;
  abort(): void;
};

export function createScrapeSession(): ScrapeSession;
