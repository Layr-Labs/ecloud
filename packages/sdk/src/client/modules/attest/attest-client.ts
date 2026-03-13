import { generateKeyPairSync, createHash, verify } from 'node:crypto';
import http from 'node:http';
import { compactDecrypt } from 'jose';

export interface AttestClientConfig {
  kmsServerURL: string;
  kmsPublicKey: string;
  audience: string;
  socketPath?: string;
}

const DEFAULT_SOCKET_PATH = '/run/container_launcher/teeserver.sock';
const CHALLENGE_PREFIX = 'COMPUTE_APP_JWT_REQUEST_RSA_KEY_V1';
const SIGNATURE_PREFIX = 'COMPUTE_APP_KMS_SIGNATURE_V1';
const NULL_BYTE = Buffer.from([0x00]);

export class AttestClient {
  private config: AttestClientConfig;

  constructor(config: AttestClientConfig) {
    this.config = config;
  }

  async attest(): Promise<string> {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: { type: 'spki', format: 'pem' } as const,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' } as const,
    });

    const challengeHash = createHash('sha256')
      .update(CHALLENGE_PREFIX)
      .update(NULL_BYTE)
      .update(publicKey)
      .digest();

    const socketPath = this.config.socketPath ?? DEFAULT_SOCKET_PATH;
    const attestationBytes = await this.getAttestation(socketPath, challengeHash);
    const attestResponse = await this.postAttest(attestationBytes, publicKey);

    this.verifySignature(JSON.stringify(attestResponse.data), attestResponse.signature);

    const rsaPrivateKey = await crypto.subtle.importKey(
      'pkcs8',
      pemToBuffer(privateKey),
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['decrypt'],
    );

    const { plaintext } = await compactDecrypt(
      attestResponse.data.encryptedToken,
      rsaPrivateKey,
    );

    const decrypted = JSON.parse(new TextDecoder().decode(plaintext));
    return decrypted.token;
  }

  private verifySignature(
    dataJson: string,
    signature: string,
  ): void {
    const message = Buffer.concat([
      Buffer.from(SIGNATURE_PREFIX),
      NULL_BYTE,
      Buffer.from(dataJson),
    ]);

    const valid = verify(
      'sha256',
      message,
      this.config.kmsPublicKey,
      Buffer.from(signature, 'base64'),
    );

    if (!valid) {
      throw new Error('KMS response signature verification failed');
    }
  }

  private getAttestation(socketPath: string, challenge: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ challenge: challenge.toString('base64') });

      const req = http.request(
        {
          socketPath,
          path: '/v1/bound_evidence',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            if (res.statusCode !== 200) {
              reject(new Error(`TEE attestation failed (${res.statusCode}): ${Buffer.concat(chunks).toString()}`));
              return;
            }
            resolve(Buffer.concat(chunks));
          });
        },
      );

      req.on('error', (err) => reject(new Error(`TEE attestation request failed: ${err.message}`)));
      req.write(body);
      req.end();
    });
  }

  private async postAttest(
    attestationBytes: Buffer,
    rsaPublicKey: string,
  ): Promise<{ data: { encryptedToken: string }; signature: string }> {
    const url = `${this.config.kmsServerURL}/auth/attest`;
    const body = JSON.stringify({
      version: 3,
      attestation: attestationBytes.toString('base64'),
      rsaKey: rsaPublicKey,
      audience: this.config.audience,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`KMS attest failed (${response.status}): ${text}`);
    }

    return response.json() as Promise<{ data: { encryptedToken: string }; signature: string }>;
  }
}

function pemToBuffer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s/g, '');
  const buf = Buffer.from(b64, 'base64');

  // Copy to a fresh ArrayBuffer to avoid offset issues with Buffer's shared pool
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}
