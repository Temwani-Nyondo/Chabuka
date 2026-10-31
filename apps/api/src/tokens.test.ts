import { describe, expect, it } from 'vitest';
import { hashToken, mintToken } from './tokens.js';

describe('agent tokens', () => {
  it('mints chb_agent_ tokens with 32 hex chars', () => {
    const token = mintToken();
    expect(token).toMatch(/^chb_agent_[0-9a-f]{32}$/);
  });

  it('hashes deterministically to 64-char hex', () => {
    expect(hashToken('chb_agent_test')).toBe(hashToken('chb_agent_test'));
    expect(hashToken('chb_agent_test')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken('chb_agent_test')).not.toBe(hashToken('chb_agent_other'));
  });
});
