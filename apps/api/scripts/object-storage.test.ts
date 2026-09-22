import test from 'node:test';
import assert from 'node:assert/strict';
import { S3CompatibleObjectStorage } from '../src/object-storage.js';

test('signs bucket bootstrap and object upload without persisting bytes in the database', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ method: string; url: string; headers: Headers; body?: Uint8Array }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ method: init?.method ?? 'GET', url: String(input), headers: new Headers(init?.headers), body: init?.body ? new Uint8Array(await new Response(init.body).arrayBuffer()) : undefined });
    if (requests.length === 1) return new Response(null, { status: 404 });
    if (requests.length === 2) return new Response(null, { status: 200 });
    return new Response(null, { status: 200, headers: { etag: '"etag-1"' } });
  };
  try {
    const storage = new S3CompatibleObjectStorage({ endpoint: 'http://storage.example:9000', publicEndpoint: 'http://localhost:19000', accessKey: 'access', secretKey: 'secret', bucket: 'assets' });
    const result = await storage.putObject({ key: 'products/p1/image.jpg', body: Buffer.from([1, 2, 3]), contentType: 'image/jpeg' });
    assert.equal(result.key, 'products/p1/image.jpg');
    assert.equal(result.etag, 'etag-1');
    assert.equal(result.publicUrl, 'http://localhost:19000/assets/products/p1/image.jpg');
    assert.equal(requests.length, 3);
    assert.equal(requests[0]?.method, 'HEAD');
    assert.equal(requests[1]?.method, 'PUT');
    assert.equal(requests[2]?.method, 'PUT');
    assert.match(requests[2]?.headers.get('authorization') ?? '', /^AWS4-HMAC-SHA256 Credential=access\//);
    assert.equal(requests[2]?.headers.get('x-amz-content-sha256')?.length, 64);
    assert.deepEqual([...(requests[2]?.body ?? [])], [1, 2, 3]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
