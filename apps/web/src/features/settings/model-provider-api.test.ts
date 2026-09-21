import { describe, expect, it } from 'vitest';
import { createModelProviderApi } from './model-provider-api';

describe('model provider API', () => {
  it('loads models lazily through the provider-backed endpoint', async () => {
    const calls: string[] = [];
    const api = createModelProviderApi({
      get: async <T>(path: string) => {
        calls.push(path);
        return { success: true, data: { accountId: 'acct-1', configId: 'cred-1', provider: 'openai-compatible', models: [{ id: 'provider-model-1' }] } } as T;
      },
    });
    await expect(api.list({ accountId: 'acct-1', configId: 'cred-1' })).resolves.toMatchObject({ models: [{ id: 'provider-model-1' }] });
    expect(calls).toEqual(['/api/v1/settings/openai/models?accountId=acct-1&configId=cred-1']);
  });

  it('surfaces provider errors without fabricating model ids', async () => {
    const api = createModelProviderApi({ get: async <T>() => ({ success: false, data: null, message: 'provider unavailable' }) as T });
    await expect(api.list({ accountId: 'acct-1', configId: 'cred-1' })).rejects.toThrow('provider unavailable');
  });
});
