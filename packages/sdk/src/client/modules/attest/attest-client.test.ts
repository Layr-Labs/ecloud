import { describe, it, expect, vi } from 'vitest';
import { AttestClient } from './attest-client';
import http from 'node:http';
import { EventEmitter } from 'node:events';

function makeMockHttp(responseData: Buffer, statusCode = 200) {
  const mockRes = new EventEmitter() as any;
  mockRes.statusCode = statusCode;
  const mockReq = new EventEmitter() as any;
  const capturedBodies: string[] = [];
  mockReq.write = (body: string) => { capturedBodies.push(body); };
  mockReq.end = () => {
    setTimeout(() => {
      mockRes.emit('data', responseData);
      mockRes.emit('end');
    }, 0);
  };
  return { mockRes, mockReq, capturedBodies };
}

describe('AttestClient extraData', () => {
  it('passes extra_data to TEE server when extraData is provided', async () => {
    const { mockRes, mockReq, capturedBodies } = makeMockHttp(Buffer.from('fake-attestation-bytes'));
    vi.spyOn(http, 'request').mockImplementation((_opts: any, cb: any) => { cb(mockRes); return mockReq; });
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { encryptedToken: 'fake-jwe' }, signature: Buffer.from('fake-sig').toString('base64') }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new AttestClient({ kmsServerURL: 'http://localhost:8080', kmsPublicKey: 'fake-key', audience: 'test' });
    const extraData = Buffer.alloc(32, 0xab);

    try { await client.attest(extraData); } catch { /* signature will fail */ }

    expect(capturedBodies.length).toBeGreaterThan(0);
    const teeBody = JSON.parse(capturedBodies[0]);
    expect(teeBody.extra_data).toBe(extraData.toString('hex'));

    vi.restoreAllMocks();
  });

  it('omits extra_data when extraData is not provided', async () => {
    const { mockRes, mockReq, capturedBodies } = makeMockHttp(Buffer.from('fake-attestation-bytes'));
    vi.spyOn(http, 'request').mockImplementation((_opts: any, cb: any) => { cb(mockRes); return mockReq; });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { encryptedToken: 'fake-jwe' }, signature: Buffer.from('fake-sig').toString('base64') }),
    }));

    const client = new AttestClient({ kmsServerURL: 'http://localhost:8080', kmsPublicKey: 'fake-key', audience: 'test' });
    try { await client.attest(); } catch { /* expected */ }

    const teeBody = JSON.parse(capturedBodies[0]);
    expect(teeBody.extra_data).toBeUndefined();

    vi.restoreAllMocks();
  });

  it('passes extra_data to KMS when extraData is provided', async () => {
    const { mockRes, mockReq } = makeMockHttp(Buffer.from('fake-attestation-bytes'));
    vi.spyOn(http, 'request').mockImplementation((_opts: any, cb: any) => { cb(mockRes); return mockReq; });

    const kmsCapture: string[] = [];
    const mockFetch = vi.fn().mockImplementation(async (_url: string, opts: any) => {
      kmsCapture.push(opts.body);
      return { ok: true, json: async () => ({ data: { encryptedToken: 'fake-jwe' }, signature: Buffer.from('fake-sig').toString('base64') }) };
    });
    vi.stubGlobal('fetch', mockFetch);

    const client = new AttestClient({ kmsServerURL: 'http://localhost:8080', kmsPublicKey: 'fake-key', audience: 'test' });
    const extraData = Buffer.alloc(32, 0xcd);
    try { await client.attest(extraData); } catch { /* expected */ }

    expect(kmsCapture.length).toBeGreaterThan(0);
    const kmsBody = JSON.parse(kmsCapture[0]);
    expect(kmsBody.extra_data).toBe(extraData.toString('hex'));

    vi.restoreAllMocks();
  });

  it('throws if extraData exceeds 64 bytes', async () => {
    const client = new AttestClient({ kmsServerURL: 'http://localhost:8080', kmsPublicKey: 'fake-key', audience: 'test' });
    const tooLarge = Buffer.alloc(65);
    await expect(client.attest(tooLarge)).rejects.toThrow('extraData exceeds 64-byte hardware limit');
  });
});
