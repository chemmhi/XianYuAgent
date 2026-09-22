export interface AuthApiTransport {
  get<T>(path: string): Promise<T>;
  post?<T>(path: string, body?: unknown, init?: RequestInit): Promise<T>;
}

export interface AdminProfile {
  id: string;
  email: string;
  displayName: string;
  role: string;
}

export interface AuthSessionView {
  authenticated: boolean;
  bootstrapRequired: boolean;
  session?: { id: string; expiresAt: string };
  admin?: AdminProfile;
}

export interface AuthApi {
  getSession(): Promise<AuthSessionView>;
  login(input: { email: string; password: string }): Promise<AuthSessionView>;
  bootstrap(input: { email: string; password: string; displayName: string }): Promise<AuthSessionView>;
  logout(): Promise<void>;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  message?: string | null;
  error?: { code?: string };
}

interface AuthMutationOutput {
  session: { id: string; expiresAt: string };
  profile: AdminProfile;
}

function unwrap<T>(payload: T | ApiEnvelope<T>): T {
  if (payload && typeof payload === 'object' && 'success' in payload && 'data' in payload) {
    const envelope = payload as ApiEnvelope<T>;
    if (!envelope.success || envelope.data === null) {
      throw new Error(envelope.message ?? envelope.error?.code ?? 'AUTH_REQUEST_FAILED');
    }
    return envelope.data;
  }
  return payload as T;
}

function requirePost(transport: AuthApiTransport): NonNullable<AuthApiTransport['post']> {
  if (!transport.post) throw new Error('AUTH_MUTATION_UNAVAILABLE');
  return transport.post.bind(transport);
}

export function createAuthApi(transport: AuthApiTransport): AuthApi {
  return {
    async getSession() {
      return unwrap(await transport.get<AuthSessionView | ApiEnvelope<AuthSessionView>>('/api/v1/auth/session'));
    },
    async login(input) {
      const post = requirePost(transport);
      return normalizeMutation(unwrap(await post<AuthMutationOutput | ApiEnvelope<AuthMutationOutput>>('/api/v1/auth/password-login', input)));
    },
    async bootstrap(input) {
      const post = requirePost(transport);
      return normalizeMutation(unwrap(await post<AuthMutationOutput | ApiEnvelope<AuthMutationOutput>>('/api/v1/auth/bootstrap', input, {
        headers: { 'Idempotency-Key': `auth-bootstrap-${Date.now()}` },
      })));
    },
    async logout() {
      const post = requirePost(transport);
      unwrap(await post<{ loggedOut: boolean } | ApiEnvelope<{ loggedOut: boolean }>>('/api/v1/auth/logout'));
    },
  };
}

function normalizeMutation(output: AuthMutationOutput): AuthSessionView {
  return { authenticated: true, bootstrapRequired: false, session: output.session, admin: output.profile };
}
