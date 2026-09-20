export interface HttpClientOptions {
  baseUrl?: string;
  getToken?: () => string | null;
  getCsrfToken?: () => string | null;
  credentials?: RequestCredentials;
}

const NETWORK_RETRY_DELAYS_MS = [100, 300, 800] as const;
const RETRYABLE_PROXY_STATUSES = new Set([502, 503, 504]);

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

function isRetryableMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD';
}

function isRetryableNetworkError(error: unknown, signal?: AbortSignal | null): boolean {
  return !signal?.aborted && error instanceof TypeError;
}

function waitForRetry(delayMs: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('The request was aborted', 'AbortError'));
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(signal?.reason ?? new DOMException('The request was aborted', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
  });
}

async function fetchWithRetry(input: RequestInfo | URL, init: RequestInit, method: string): Promise<Response> {
  const canRetry = isRetryableMethod(method);
  let retryIndex = 0;

  while (true) {
    try {
      const response = await fetch(input, init);
      const shouldRetryResponse = canRetry && RETRYABLE_PROXY_STATUSES.has(response.status);
      if (!shouldRetryResponse || retryIndex >= NETWORK_RETRY_DELAYS_MS.length) return response;
      await response.body?.cancel();
      await waitForRetry(NETWORK_RETRY_DELAYS_MS[retryIndex], init.signal);
      retryIndex += 1;
    } catch (error) {
      if (!canRetry || !isRetryableNetworkError(error, init.signal) || retryIndex >= NETWORK_RETRY_DELAYS_MS.length) throw error;
      await waitForRetry(NETWORK_RETRY_DELAYS_MS[retryIndex], init.signal);
      retryIndex += 1;
    }
  }
}

export function createHttpClient(options: HttpClientOptions = {}) {
  const baseUrl = options.baseUrl ?? '';

  function readCookie(name: string): string | null {
    if (typeof document === 'undefined') return null;
    const prefix = `${name}=`;
    const raw = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
    return raw ? decodeURIComponent(raw.slice(prefix.length)) : null;
  }

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    if (init.body && typeof init.body === 'string' && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const token = options.getToken?.();
    if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);

    const method = (init.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && !headers.has('X-CSRF-Token')) {
      const csrfToken = options.getCsrfToken?.() ?? readCookie('csrf_token');
      if (csrfToken) headers.set('X-CSRF-Token', csrfToken);
    }

    const response = await fetchWithRetry(
      joinUrl(baseUrl, path),
      { ...init, headers, credentials: options.credentials ?? 'include' },
      method,
    );
    const contentType = response.headers.get('content-type') ?? '';
    const payload = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const message = typeof payload === 'object' && payload && 'message' in payload
        ? String((payload as { message?: unknown }).message ?? '请求失败')
        : `请求失败（${response.status}）`;
      throw new ApiError(message, response.status, payload);
    }

    return payload as T;
  }

  function encodeBody(body: unknown): BodyInit | undefined {
    if (body === undefined) return undefined;
    if (typeof body === 'string' || body instanceof FormData || body instanceof Blob || body instanceof URLSearchParams || body instanceof ArrayBuffer) return body as BodyInit;
    return JSON.stringify(body);
  }

  return {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body?: unknown, init: RequestInit = {}) => request<T>(path, {
      ...init,
      method: 'POST',
      body: encodeBody(body),
    }),
    patch: <T>(path: string, body?: unknown, init: RequestInit = {}) => request<T>(path, {
      ...init,
      method: 'PATCH',
      body: encodeBody(body),
    }),
    put: <T>(path: string, body?: unknown, init: RequestInit = {}) => request<T>(path, {
      ...init,
      method: 'PUT',
      body: encodeBody(body),
    }),
    delete: <T>(path: string, init: RequestInit = {}) => request<T>(path, { ...init, method: 'DELETE' }),
  };
}
