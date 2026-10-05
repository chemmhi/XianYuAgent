import assert from 'node:assert/strict';
import test from 'node:test';
import { startAllRecoverableListenersBestEffort } from '../src/app.js';

test('startup keepalive scans every admin account page with an active login', async () => {
  const started: string[] = [];
  const pageOne = Array.from({ length: 100 }, (_, index) => ({ id: `account-${index + 1}`, status: index === 0 ? 'expired' : 'connected' }));
  const pageTwo = [{ id: 'account-101', status: 'degraded' }];
  const runtime = {
    store: {
      listAdminIds: async () => ['admin-1', 'admin-2'],
      getCredential: async (_adminId: string, accountId: string) => accountId === 'account-2' || accountId === 'account-101'
        ? { status: 'revoked', cookieHeader: 'revoked-cookie' }
        : { status: 'active', cookieHeader: `cookie-${accountId}` },
    },
    accounts: {
      list: async (adminId: string, query: { page?: number }) => {
        if (adminId === 'admin-1' && query.page === 1) return { items: pageOne, page: 1, pageSize: 100, total: 101, totalPages: 2 };
        if (adminId === 'admin-1' && query.page === 2) return { items: pageTwo, page: 2, pageSize: 100, total: 101, totalPages: 2 };
        return { items: [{ id: 'account-200', status: 'degraded' }], page: 1, pageSize: 1, total: 1, totalPages: 1 };
      },
    },
    xianyuIm: {
      startListener: async (adminId: string, accountId: string) => { started.push(`${adminId}:${accountId}`); },
    },
  } as any;

  await startAllRecoverableListenersBestEffort(runtime);

  assert.equal(started.length, 100);
  assert.equal(started.includes('admin-1:account-101'), false);
  assert.equal(started.includes('admin-2:account-200'), true);
  assert.equal(started.includes('admin-1:account-1'), true);
});
