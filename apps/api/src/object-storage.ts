import { createHash, createHmac } from 'node:crypto';

export interface ObjectStoragePutInput {
  key: string;
  body: Buffer;
  contentType: string;
}

export interface ObjectStoragePutResult {
  key: string;
  etag?: string;
  publicUrl?: string;
}

export interface ObjectStorageGetResult {
  key: string;
  body: Buffer;
  contentType: string;
  etag?: string;
}

export interface ObjectStorage {
  deletePrefix(prefix: string): Promise<void>;
  putObject(input: ObjectStoragePutInput): Promise<ObjectStoragePutResult>;
  getObject(key: string): Promise<ObjectStorageGetResult | undefined>;
  publicUrl(key: string): string | undefined;
}

/** Test-only in-memory implementation; production uses the S3-compatible adapter below. */
export class MemoryObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  async deletePrefix(prefix: string): Promise<void> {
    if (!prefix.endsWith('/')) throw new Error('OBJECT_STORAGE_PREFIX_INVALID');
    for (const key of this.objects.keys()) if (key.startsWith(prefix)) this.objects.delete(key);
  }

  async putObject(input: ObjectStoragePutInput): Promise<ObjectStoragePutResult> {
    this.objects.set(input.key, { body: Buffer.from(input.body), contentType: input.contentType });
    return { key: input.key };
  }

  async getObject(key: string): Promise<ObjectStorageGetResult | undefined> {
    const object = this.objects.get(key);
    if (!object) return undefined;
    return { key, body: Buffer.from(object.body), contentType: object.contentType };
  }

  publicUrl(_key: string): string | undefined { return undefined; }
}

/**
 * Minimal AWS Signature V4 client for MinIO/S3. Keeping this local avoids
 * pulling a second storage SDK into the API package while still storing image
 * bytes in the existing object-storage service instead of PostgreSQL.
 */
export class S3CompatibleObjectStorage implements ObjectStorage {
  private bucketReady?: Promise<void>;

  constructor(private readonly options: {
    endpoint: string;
    accessKey: string;
    secretKey: string;
    bucket: string;
    region?: string;
    publicEndpoint?: string;
  }) {}

  async deletePrefix(input: string): Promise<void> {
    const prefix = normalizeKey(input);
    if (!prefix.endsWith('/')) throw new Error('OBJECT_STORAGE_PREFIX_INVALID');
    let continuation: string | undefined;
    do {
      const params: Record<string, string> = { 'encoding-type': 'url', 'list-type': '2', prefix };
      if (continuation) params['continuation-token'] = continuation;
      const query = Object.entries(params).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
      const response = await this.request('GET', `/${encodePathSegment(this.options.bucket)}?${query}`, Buffer.alloc(0), undefined, sha256(Buffer.alloc(0)));
      if (response.status === 404) return;
      if (!response.ok) throw new Error(`OBJECT_STORAGE_LIST_FAILED:${response.status}`);
      const xml = await response.text();
      for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) {
        const key = decodeURIComponent(match[1]);
        if (!key.startsWith(prefix)) throw new Error('OBJECT_STORAGE_PREFIX_MISMATCH');
        const removed = await this.request('DELETE', `/${encodePathSegment(this.options.bucket)}/${encodeKey(key)}`, Buffer.alloc(0), undefined, sha256(Buffer.alloc(0)));
        if (!removed.ok && removed.status !== 404) throw new Error(`OBJECT_STORAGE_DELETE_FAILED:${removed.status}`);
      }
      continuation = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1]?.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'");
      if (/<IsTruncated>true<\/IsTruncated>/.test(xml) && !continuation) throw new Error('OBJECT_STORAGE_LIST_INCOMPLETE');
    } while (continuation);
  }

  async putObject(input: ObjectStoragePutInput): Promise<ObjectStoragePutResult> {
    await this.ensureBucket();
    const key = normalizeKey(input.key);
    const bodyHash = sha256(input.body);
    const path = `/${encodePathSegment(this.options.bucket)}/${encodeKey(key)}`;
    const response = await this.request('PUT', path, input.body, input.contentType, bodyHash);
    if (!response.ok) throw new Error(`OBJECT_STORAGE_PUT_FAILED:${response.status}:${await response.text()}`);
    const etag = response.headers.get('etag')?.replace(/^"|"$/g, '') || undefined;
    return { key, etag, publicUrl: this.publicUrl(key) };
  }

  async getObject(inputKey: string): Promise<ObjectStorageGetResult | undefined> {
    const key = normalizeKey(inputKey);
    const path = `/${encodePathSegment(this.options.bucket)}/${encodeKey(key)}`;
    const response = await this.request('GET', path, Buffer.alloc(0), undefined, sha256(Buffer.alloc(0)));
    if (response.status === 404) return undefined;
    if (!response.ok) throw new Error(`OBJECT_STORAGE_GET_FAILED:${response.status}:${await response.text()}`);
    return {
      key,
      body: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type')?.split(';', 1)[0]?.trim() || 'application/octet-stream',
      etag: response.headers.get('etag')?.replace(/^"|"$/g, '') || undefined,
    };
  }

  publicUrl(key: string): string | undefined {
    const base = this.options.publicEndpoint?.trim() || this.options.endpoint.trim();
    if (!base) return undefined;
    return `${base.replace(/\/$/, '')}/${encodePathSegment(this.options.bucket)}/${encodeKey(normalizeKey(key))}`;
  }

  private async ensureBucket(): Promise<void> {
    this.bucketReady ??= (async () => {
      const path = `/${encodePathSegment(this.options.bucket)}`;
      const head = await this.request('HEAD', path, Buffer.alloc(0), undefined, sha256(Buffer.alloc(0)));
      if (head.ok || head.status === 403) return;
      const created = await this.request('PUT', path, Buffer.alloc(0), undefined, sha256(Buffer.alloc(0)));
      if (!created.ok && created.status !== 409) throw new Error(`OBJECT_STORAGE_BUCKET_FAILED:${created.status}`);
    })();
    try {
      await this.bucketReady;
    } catch (error) {
      this.bucketReady = undefined;
      throw error;
    }
  }

  private async request(method: string, path: string, body: Buffer, contentType: string | undefined, bodyHash: string): Promise<Response> {
    const endpoint = new URL(this.options.endpoint);
    const now = new Date();
    const amzDate = formatAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const region = this.options.region ?? 'us-east-1';
    const host = endpoint.host;
    // Canonical headers must be emitted in lexicographic order, matching the
    // signedHeaders list and the headers MinIO/S3 canonicalizes server-side.
    const canonicalHeaders = `${contentType ? `content-type:${contentType}\n` : ''}host:${host}\nx-amz-content-sha256:${bodyHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = contentType ? 'content-type;host;x-amz-content-sha256;x-amz-date' : 'host;x-amz-content-sha256;x-amz-date';
    const [canonicalPath, canonicalQuery = ''] = path.split('?', 2);
    const canonicalRequest = [method, canonicalPath, canonicalQuery, canonicalHeaders, signedHeaders, bodyHash].join('\n');
    const scope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${this.options.secretKey}`, dateStamp), region), 's3'), 'aws4_request');
    const signature = hmac(signingKey, stringToSign).toString('hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${this.options.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const headers: Record<string, string> = {
      host,
      'x-amz-content-sha256': bodyHash,
      'x-amz-date': amzDate,
      authorization,
    };
    if (contentType) headers['content-type'] = contentType;
    return fetch(new URL(path, endpoint), { method, headers, body: method === 'PUT' ? new Uint8Array(body) : undefined });
  }
}

function normalizeKey(value: string): string {
  const normalized = value.trim().replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) throw new Error('OBJECT_STORAGE_KEY_INVALID');
  return normalized;
}

function encodePathSegment(value: string): string { return encodeURIComponent(value).replace(/%2F/gi, '/'); }
function encodeKey(value: string): string { return value.split('/').map(encodeURIComponent).join('/'); }
function sha256(value: Buffer | string): string { return createHash('sha256').update(value).digest('hex'); }
function hmac(key: Buffer | string, value: string): Buffer { return createHmac('sha256', key).update(value).digest(); }
function formatAmzDate(value: Date): string {
  const iso = value.toISOString();
  return `${iso.slice(0, 10).replace(/-/g, '')}T${iso.slice(11, 19).replace(/:/g, '')}Z`;
}
