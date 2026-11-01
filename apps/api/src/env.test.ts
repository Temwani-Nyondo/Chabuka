import { describe, expect, it } from 'vitest';
import { candidateEnvPaths, stripBomKeys } from './env.js';

function tail(path: string | undefined): string {
  return (path ?? '').split(/[\\/]/).slice(-2).join('/');
}

describe('candidateEnvPaths', () => {
  it('anchors the repo-root .env at the module location, not the cwd', () => {
    const paths = candidateEnvPaths('/repo/apps/api/src', '/elsewhere');
    expect(tail(paths[0])).toBe('repo/.env');
  });

  it('still falls back to cwd-based candidates', () => {
    const paths = candidateEnvPaths('/repo/apps/api/src', '/elsewhere');
    expect(paths).toHaveLength(3);
    expect(tail(paths[1])).toBe('elsewhere/.env');
  });

  it('recovers BOM-prefixed keys from Windows-saved .env files', () => {
    const bomKey = String.fromCharCode(0xfeff) + 'FAKE_ENV_TEST_KEY';
    const env: NodeJS.ProcessEnv = { [bomKey]: 'yes' };
    stripBomKeys(env);
    expect(env['FAKE_ENV_TEST_KEY']).toBe('yes');
    expect(bomKey in env).toBe(false);
  });
});
