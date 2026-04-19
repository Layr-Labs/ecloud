import type { AttestClient } from './attest-client';

export class JwtProvider {
  private attestClient: AttestClient;
  private bufferSeconds: number;
  private cachedToken?: string;
  private expiresAt?: number;
  private pending?: Promise<string>;
  private pendingExtraData = new Map<string, Promise<string>>();

  constructor(attestClient: AttestClient, bufferSeconds: number = 30) {
    this.attestClient = attestClient;
    this.bufferSeconds = bufferSeconds;
  }

  async getToken(extraData?: Buffer): Promise<string> {
    // When extraData is provided, bypass long-lived cache but deduplicate
    // concurrent requests for the same extraData to avoid thundering herd
    // on TEE hardware calls.
    if (extraData && extraData.length > 0) {
      const key = extraData.toString('hex');
      const existing = this.pendingExtraData.get(key);
      if (existing) return existing;
      const promise = this.attestClient.attest(extraData).finally(() => {
        this.pendingExtraData.delete(key);
      });
      this.pendingExtraData.set(key, promise);
      return promise;
    }

    if (this.cachedToken && !this.isExpiringSoon()) {
      return this.cachedToken;
    }

    if (this.pending) {
      return this.pending;
    }

    this.pending = this.attestClient
      .attest()
      .then((token) => {
        this.cachedToken = token;
        this.expiresAt = this.decodeJwtExp(token);
        return token;
      })
      .finally(() => {
        this.pending = undefined;
      });

    return this.pending;
  }

  private isExpiringSoon(): boolean {
    if (!this.expiresAt) return true;
    return Date.now() / 1000 >= this.expiresAt - this.bufferSeconds;
  }

  private decodeJwtExp(jwt: string): number | undefined {
    const payload = jwt.split('.')[1];
    if (!payload) return undefined;

    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return decoded.exp;
  }
}
