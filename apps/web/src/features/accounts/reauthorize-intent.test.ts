import { describe, expect, it } from 'vitest';
import { buildAccountsReauthorizePath, findReauthorizeAccount, readReauthorizeAccountId } from './reauthorize-intent';

describe('account reauthorize intent', () => {
  it('builds and reads an account-scoped accounts path', () => {
    const path = buildAccountsReauthorizePath('account/1');

    expect(path).toBe('/accounts?reauthorize=account%2F1');
    expect(readReauthorizeAccountId('?reauthorize=account%2F1')).toBe('account/1');
  });

  it('does not create an intent without an account id and ignores unknown accounts', () => {
    expect(buildAccountsReauthorizePath()).toBe('/accounts');
    expect(readReauthorizeAccountId('')).toBeUndefined();
    expect(findReauthorizeAccount([{ id: 'account-1' }], 'missing')).toBeUndefined();
  });
});
