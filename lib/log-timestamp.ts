export function logTimestamp(): string {
  return new Date().toISOString().slice(0, 16).replace('T', ' ');
}
