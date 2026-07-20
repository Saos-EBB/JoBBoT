import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// Eine einzige CC-Adresse (oder kommagetrennte Liste, nodemailer/MailComposer nehmen
// das "cc"-Feld roh entgegen) für ALLE Mails — kein Pro-Job-CC, gleiche Scope-Entscheidung
// wie beim Anhang (siehe lib/attachment.ts): kein Adressbuch, eine Konstante statt Verwaltung.
export const CC_PATH = 'data/cc.json';

export async function loadCc(path = CC_PATH): Promise<string | null> {
  try {
    const raw = await readFile(path, 'utf8');
    const email = (JSON.parse(raw) as { email?: string }).email?.trim();
    return email || null;
  } catch {
    return null;
  }
}

export async function saveCc(email: string, path = CC_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ email: email.trim() }, null, 2), 'utf8');
}

export async function clearCc(path = CC_PATH): Promise<void> {
  await unlink(path).catch(() => {});
}
