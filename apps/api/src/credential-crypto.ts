import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const VERSION = 'v1';

function keyFromSecret(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

/** Encrypts a credential value for persistence. The returned value is safe to store as text/base64. */
export function encryptCredentialValue(secret: string, encryptionKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFromSecret(encryptionKey), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

/** Decrypts a persisted credential value for server-side use only. */
export function decryptCredentialValue(encoded: string, encryptionKey: string): string {
  const [version, ivEncoded, tagEncoded, ciphertextEncoded] = encoded.split('.');
  if (version !== VERSION || !ivEncoded || !tagEncoded || !ciphertextEncoded) throw new Error('CREDENTIAL_CIPHERTEXT_INVALID');
  const decipher = createDecipheriv('aes-256-gcm', keyFromSecret(encryptionKey), Buffer.from(ivEncoded, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextEncoded, 'base64url')), decipher.final()]).toString('utf8');
}

export function credentialFingerprint(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 16);
}
