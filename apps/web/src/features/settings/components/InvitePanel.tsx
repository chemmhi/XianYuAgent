import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../shared/ui/Button';
import { InputField } from '../../../shared/ui/InputField';
import { useToast } from '../../../shared/ui/ToastProvider';
import type { InviteApi, InviteVM } from '../api';
import { InviteRenewModal } from './InviteRenewModal';
import { InviteTable, type InvitePending } from './InviteTable';
import './invite-panel.css';

export function InvitePanel({ api }: { api: InviteApi }) {
  const [items, setItems] = useState<InviteVM[]>([]);
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<InvitePending | null>(null);
  const [loading, setLoading] = useState(true);
  const reading = useRef(true);
  const [creationDays, setCreationDays] = useState('7');
  const [creationError, setCreationError] = useState<string | null>(null);
  const [renewingInvite, setRenewingInvite] = useState<InviteVM | null>(null);
  const locked = useRef(false);
  const { showToast, dismissToast } = useToast();
  const feedback = (message: string, tone: 'success' | 'error' | 'info' = 'error') => showToast({ id: 'invite-feedback', tone, message });

  async function reload() {
    if (reading.current) return;
    reading.current = true;
    setLoading(true);
    try { setItems((await api.list()).items); }
    finally { reading.current = false; setLoading(false); }
  }
  function loadError() {
    showToast({ id: 'invite-feedback', tone: 'error', message: '邀请码列表读取失败，请重试', actions: [{ label: '重试', onClick: () => { void reload().then(() => dismissToast('invite-feedback'), loadError); } }] });
  }
  useEffect(() => {
    let current = true;
    reading.current = true;
    setLoading(true);
    void api.list().then(result => { if (current) setItems(result.items); }, () => { if (current) loadError(); })
      .finally(() => { if (current) { reading.current = false; setLoading(false); } });
    return () => { current = false; };
  }, [api]);

  async function perform(action: InvitePending, operation: () => Promise<void>) {
    if (locked.current || reading.current) return;
    locked.current = true;
    setPending(action);
    dismissToast('invite-feedback');
    try { await operation(); }
    catch (error) { feedback(error instanceof Error ? error.message : '操作失败，请重试'); }
    finally { locked.current = false; setPending(null); }
  }

  async function refreshed(message: string) {
    try { await reload(); feedback(message, 'success'); }
    catch { showToast({ id: 'invite-feedback', tone: 'info', message: `${message}，列表刷新失败`, actions: [{ label: '刷新列表', onClick: () => { void reload().then(() => dismissToast('invite-feedback'), loadError); } }] }); }
  }

  async function create() {
    const days = Number(creationDays);
    if (!Number.isInteger(days) || days < 1 || days > 30) { setCreationError('有效期需为 1-30 天的整数'); return; }
    setCreationError(null);
    await perform({ id: '', action: 'create' }, async () => {
      const { invite } = await api.create({ requestKey: `invite-${crypto.randomUUID()}`, days });
      setNewIds(current => new Set(current).add(invite.id));
      setItems(current => [invite, ...current]);
      feedback('邀请码已生成', 'success');
    });
  }

  async function status(item: InviteVM, next: 'active' | 'disabled') {
    await perform({ id: item.id, action: next === 'active' ? 'enable' : 'disable' }, async () => {
      await api.setStatus(item.id, next);
      await refreshed(next === 'active' ? '邀请码已启用' : '邀请码已禁用');
    });
  }

  async function copy(item: InviteVM) {
    if (!item.code) return;
    try { await navigator.clipboard.writeText(item.code); feedback('邀请码已复制', 'success'); }
    catch { feedback('复制失败，请手动选择邀请码复制'); }
  }

  async function renew(days: number) {
    if (!renewingInvite || locked.current || reading.current) throw new Error('操作进行中，请稍候');
    locked.current = true;
    setPending({ id: renewingInvite.id, action: 'renew' });
    try {
      const result = await api.renew(renewingInvite.id, days);
      setItems(current => current.map(item => item.id !== renewingInvite.id ? item : { ...item, expiresAt: result.expiresAt, status: item.status === 'expired' ? 'active' : item.status }));
      feedback('邀请码已续期', 'success');
    } finally { locked.current = false; setPending(null); }
  }

  async function remove(item: InviteVM) {
    const used = item.status === 'used' || Boolean(item.usedAt);
    if (used) { if (!window.confirm('该邀请码已激活账号，删除将清空该用户的全部数据，是否继续？')) return; if (!window.confirm('这是不可恢复的危险操作，请再次确认删除并清空该用户数据。')) return; }
    else if (!window.confirm('确认删除该邀请码？')) return;
    await perform({ id: item.id, action: 'delete' }, async () => { await api.revoke(item.id, used); setItems(current => current.filter(candidate => candidate.id !== item.id)); feedback(used ? '邀请码及激活用户数据已删除' : '邀请码已删除', 'success'); });
  }

  return <div className="settings-content">
    <article className="card panel settings-hero"><div><p className="eyebrow">Invitation Codes</p><h2>邀请码管理</h2><p>邀请码为注册凭证，完整邀请码仅管理员可见，数据库使用加密保存。</p></div></article>
    <article className="card panel invite-table-card"><div className="panel-head"><div><h2>邀请码列表</h2><p>状态、到期日期和激活账号均来自服务端。</p></div><div className="invite-toolbar-actions">
      <label className="invite-expiry-input">生成有效期（天）<InputField aria-label="生成有效期（天）" type="number" min="1" max="30" value={creationDays} disabled={Boolean(pending) || loading} aria-invalid={Boolean(creationError) || undefined} aria-describedby={creationError ? 'invite-creation-error' : undefined} onChange={event => { setCreationDays(event.target.value); setCreationError(null); }} /><span>天</span>{creationError && <span className="invite-expiry-validation" id="invite-creation-error">{creationError}</span>}</label>
      <Button variant="primary" type="button" disabled={Boolean(pending) || loading} onClick={() => void create()}>{pending?.action === 'create' ? '生成中…' : loading ? '读取中…' : '生成邀请码'}</Button>
    </div></div><InviteTable items={items} newIds={newIds} pending={pending} loading={loading} onCopy={item => void copy(item)} onStatus={(item, next) => void status(item, next)} onRenew={setRenewingInvite} onDelete={item => void remove(item)} /></article>
    {renewingInvite && <InviteRenewModal invite={renewingInvite} onClose={() => setRenewingInvite(null)} onRenew={renew} />}
  </div>;
}
