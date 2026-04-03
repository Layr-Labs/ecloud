import type { AttestClient } from './attest-client';

export class JwtProvider {
  private attestClient: AttestClient;
  private bufferSeconds: number;
  private cachedToken?: string;
  private expiresAt?: number;
  private pending?: Promise<string>;

  constructor(attestClient: AttestClient, bufferSeconds: number = 30) {
    this.attestClient = attestClient;
    this.bufferSeconds = bufferSeconds;
  }

  async getToken(): Promise<string> {
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
