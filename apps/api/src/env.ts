import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Repo-root .env loading for local dev; deployed hosts set real
// environment variables and this is a no-op there. Resolution is anchored
// at this file (apps/api/src or apps/api/dist), never at process.cwd(),
// so `npm run dev` works whether it is started from the repo root or from
// inside apps/api.
export function candidateEnvPaths(hereDir: string, cwd: string): string[] {
  return [
    resolve(hereDir, '..', '..', '..', '.env'),
    resolve(cwd, '.env'),
    resolve(cwd, '..', '..', '.env'),
  ];
}

export function loadServerEnv(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of candidateEnvPaths(here, process.cwd())) {
    if (!existsSync(candidate)) continue;
    try {
      process.loadEnvFile(candidate);
    } catch {
      // A malformed .env should not stop the server booting.
      continue;
    }
    stripBomKeys(process.env);
    return candidate;
  }
  return null;
}

// Some Windows editors save .env with a UTF-8 BOM, which makes the first
// key parse as "\uFEFFNAME" and silently drops it (this once lost
// SUPABASE_URL at boot). Normalize those keys after every load.
export function stripBomKeys(env: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(env)) {
    if (key.charCodeAt(0) !== 0xfeff) continue;
    const clean = key.slice(1);
    if (!(clean in env)) env[clean] = env[key];
    delete env[key];
  }
}
