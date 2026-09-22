export type AccountLoginMethod = 'qr' | 'password' | 'cookie';

const methods: Array<{ id: AccountLoginMethod; title: string; description: string; badge?: string }> = [
  { id: 'qr', title: '扫码登录', description: '使用闲鱼 App 扫描二维码，扫码后自动同步账号资料', badge: '推荐' },
  { id: 'password', title: '账号密码', description: '输入闲鱼账号与密码，按提示完成验证' },
  { id: 'cookie', title: '手动输入 Cookie', description: '粘贴完整 Cookie，适合已登录浏览器会话' },
];

export function LoginMethodSelector({ value, onChange }: { value: AccountLoginMethod; onChange: (value: AccountLoginMethod) => void }) {
  return (
    <div className="account-login-methods" role="tablist" aria-label="闲鱼登录方式">
      {methods.map((method) => (
        <button key={method.id} data-login-method={method.id} className={`account-login-method ${value === method.id ? 'active' : ''}`} type="button" role="tab" aria-selected={value === method.id} onClick={() => onChange(method.id)}>
          <span className="account-login-method-title">{method.title}{method.badge && <em>{method.badge}</em>}</span>
          <span className="account-login-method-description">{method.description}</span>
        </button>
      ))}
    </div>
  );
}
