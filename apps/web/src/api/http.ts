export interface HttpClientOptions {
  baseUrl?: string;
  getToken?: () => string | null;
  getCsrfToken?: () => string | null;
  credentials?: RequestCredentials;
}

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

    const response = await fetch(joinUrl(baseUrl, path), { ...init, headers, credentials: options.credentials ?? 'include' });
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
