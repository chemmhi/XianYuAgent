/** A reload may resume its controller; a duplicated tab must use a new identity. */
export async function acquireVerificationClient(): Promise<{ id: string; close(): void }> {
  const key = 'xianyu-verification-client';
  let id: string = crypto.randomUUID();
  try { id = sessionStorage.getItem(key) || id; } catch { /* Storage is optional. */ }
  if (typeof BroadcastChannel === 'undefined') return { id: crypto.randomUUID(), close() {} };
  const channel = new BroadcastChannel('xianyu-verification-clients');
  const nonce = crypto.randomUUID(); let ready = false;
  channel.onmessage = event => {
    const message = event.data;
    if (!message || message.id !== id || message.nonce === nonce) return;
    if (message.type === 'probe') {
      if (ready) channel.postMessage({ type: 'occupied', id, nonce, target: message.nonce });
      else if (message.nonce < nonce) id = crypto.randomUUID();
      else channel.postMessage({ type: 'occupied', id, nonce, target: message.nonce });
    } else if (message.type === 'occupied' && message.target === nonce && !ready) id = crypto.randomUUID();
  };
  channel.postMessage({ type: 'probe', id, nonce });
  await new Promise(resolve => setTimeout(resolve, 120));
  ready = true;
  try { sessionStorage.setItem(key, id); } catch { /* Identity remains valid for this page. */ }
  return { id, close: () => channel.close() };
}
