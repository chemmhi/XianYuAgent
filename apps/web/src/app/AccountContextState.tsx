import { useAccountContext } from './account-context';
import { Button } from '../shared/ui/Button';
import { PageState } from '../shared/ui/PageState';

export function AccountContextState() {
  const { accountsLoading, accountsError, refreshAccounts } = useAccountContext();
  const loading = accountsLoading;
  const error = !loading && Boolean(accountsError);

  function chooseAccount() {
    window.history.pushState({}, '', '/accounts');
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  return <div className="account-context-state">
    <PageState
      title={loading ? '正在加载账号…' : error ? '账号加载失败' : '请先连接或选择闲鱼账号'}
      message={loading ? '正在读取可用账号，请稍候。' : error ? '暂时无法读取账号信息，请重试。' : '请在账号管理中添加闲鱼账号，或选择一个可用账号后继续。'}
      error={error}
      loading={loading}
      action={loading ? undefined : <Button variant="primary" type="button" onClick={error ? () => void refreshAccounts() : chooseAccount}>{error ? '重新加载' : '前往账号管理'}</Button>}
    />
  </div>;
}
