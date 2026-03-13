import { describe, it, expect, vi } from 'vitest';
import { JwtProvider } from './jwt-provider';
import type { AttestClient } from './attest-client';

function makeJwt(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  return `${header}.${payload}.fakesig`;
}

function mockAttestClient(tokenFn: () => Promise<string>): AttestClient {
  return { attest: vi.fn(tokenFn) } as unknown as AttestClient;
}

describe('JwtProvider', () => {
  const futureExp = Math.floor(Date.now() / 1000) + 3600;
  const nearExp = Math.floor(Date.now() / 1000) + 10;

  it('fetches token on first call', async () => {
    const token = makeJwt(futureExp);
    const client = mockAttestClient(async () => token);
    const provider = new JwtProvider(client);

    const result = await provider.getToken();
    expect(result).toBe(token);
    expect(client.attest).toHaveBeenCalledTimes(1);
  });

  it('returns cached token when not expired', async () => {
    const token = makeJwt(futureExp);
    const client = mockAttestClient(async () => token);
    const provider = new JwtProvider(client);

    await provider.getToken();
    await provider.getToken();
    await provider.getToken();
    expect(client.attest).toHaveBeenCalledTimes(1);
  });

  it('refreshes when token is near expiry', async () => {
    const nearExpiryToken = makeJwt(nearExp);
    const freshToken = makeJwt(futureExp);
    let callCount = 0;
    const client = mockAttestClient(async () => {
      callCount++;
      return callCount === 1 ? nearExpiryToken : freshToken;
    });
    const provider = new JwtProvider(client, 30);

    const first = await provider.getToken();
    expect(first).toBe(nearExpiryToken);

    const second = await provider.getToken();
    expect(second).toBe(freshToken);
    expect(client.attest).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent requests', async () => {
    let resolveAttest: (token: string) => void;
    const client = mockAttestClient(
      () => new Promise<string>((resolve) => { resolveAttest = resolve; }),
    );
    const provider = new JwtProvider(client);

    const p1 = provider.getToken();
    const p2 = provider.getToken();
    const p3 = provider.getToken();

    const token = makeJwt(futureExp);
    resolveAttest!(token);

    const results = await Promise.all([p1, p2, p3]);
    expect(results).toEqual([token, token, token]);
    expect(client.attest).toHaveBeenCalledTimes(1);
  });

  it('retries after error', async () => {
    const token = makeJwt(futureExp);
    let callCount = 0;
    const client = mockAttestClient(async () => {
      callCount++;
      if (callCount === 1) throw new Error('network error');
      return token;
    });
    const provider = new JwtProvider(client);

    await expect(provider.getToken()).rejects.toThrow('network error');
    const result = await provider.getToken();
    expect(result).toBe(token);
    expect(client.attest).toHaveBeenCalledTimes(2);
  });

  it('clears pending promise on error so concurrent waiters also fail', async () => {
    let rejectAttest: (err: Error) => void;
    const client = mockAttestClient(
      () => new Promise<string>((_, reject) => { rejectAttest = reject; }),
    );
    const provider = new JwtProvider(client);

    const p1 = provider.getToken();
    const p2 = provider.getToken();

    rejectAttest!(new Error('fail'));

    await expect(p1).rejects.toThrow('fail');
    await expect(p2).rejects.toThrow('fail');
  });
});
