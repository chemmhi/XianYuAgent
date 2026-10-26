import type { AccountConnectionStatus, AccountStatus, AccountVM } from './types';

export const accountStatusLabels: Record<AccountStatus, string> = {
  pending: '等待账号授权', connected: '账号正常', degraded: '部分功能异常', disconnected: '消息服务已断开',
  expired: '账号授权已过期', verification_required: '需要安全验证', disabled: '账号已停用',
};
export const messageConnectionLabels: Record<AccountConnectionStatus, string> = {
  online: '消息已连接', offline: '消息未连接', connecting: '正在连接消息服务', expired: '需授权后连接消息', unknown: '消息连接未确认',
};

export function accountStatusDescription(account: AccountVM): string {
  if (account.status === 'degraded') {
    const descriptions: Record<string, string> = {
      im: '最近消息操作未成功。', im_listener: '消息监听出现异常。',
      'mtop.taobao.idlemessage.pc.login.token': '消息授权请求未成功。',
      'mtop.taobao.idle.web.xyh.item.list': '商品读取出现异常。',
      'mtop.taobao.idle.web.trade.bought.list': '订单读取出现异常。',
    };
    const source = account.degradedSource ?? '';
    return Object.hasOwn(descriptions, source) ? descriptions[source] : '最近账号操作异常，具体原因未记录。';
  }
  if (account.status === 'verification_required') return '请完成安全验证，随后将复查账号状态。';
  if (account.status === 'expired') return '请重新授权闲鱼账号。';
  if (account.status === 'pending') return '完成账号授权后才能收发闲鱼消息。';
  if (account.status === 'disconnected') return '实时收发闲鱼消息暂不可用。';
  if (account.status === 'disabled') return '此账号已停止使用。';
  return '账号授权正常。';
}

export function autoReplyLabel(enabled: boolean | undefined) {
  return enabled === undefined ? '未读取' : enabled ? '已启用' : '未启用';
}
