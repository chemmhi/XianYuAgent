import { Server } from 'node:http';
import { syncBuiltinESMExports } from 'node:module';

export function installHttpRecording(store) {
  const pending = new Set();
  const track = (task) => {
    pending.add(task);
    task.catch((error) => store.event('recording.error', { scope: 'http-body', error })).finally(() => pending.delete(task));
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const id = store.id();
    // Clone for observation; send the original arguments without reconstruction.
    const request = new Request(input, init);
    store.event('fetch.request', { id, method: request.method, url: request.url, headers: [...request.headers], redirect: request.redirect });
    track(request.clone().arrayBuffer().then((body) => store.event('fetch.request.body', { id, body: store.blob(Buffer.from(body)) })));
    try {
      const response = await originalFetch(input, init);
      store.event('fetch.response', { id, url: response.url, status: response.status, statusText: response.statusText, headers: [...response.headers], setCookie: response.headers.getSetCookie(), redirected: response.redirected });
      track(response.clone().arrayBuffer().then((body) => store.event('fetch.response.body', { id, body: store.blob(Buffer.from(body)) })));
      return response;
    } catch (error) {
      store.event('fetch.error', { id, error });
      throw error;
    }
  };
  const originalEmit = Server.prototype.emit;
  Server.prototype.emit = function (name, ...args) {
    if (name === 'request') {
      const [request, response] = args;
      const id = store.id();
      const input = [];
      const output = [];
      store.event('http.request', { id, method: request.method, url: request.url, headers: request.rawHeaders, remoteAddress: request.socket.remoteAddress });
      // Observing emit avoids putting the request in flowing mode before the app reads it.
      const emit = request.emit;
      request.emit = function (event, ...values) {
        if (event === 'data') input.push(Buffer.from(values[0]));
        if (event === 'end' || event === 'aborted') store.event('http.request.body', { id, complete: event === 'end', body: store.blob(Buffer.concat(input)) });
        return emit.call(this, event, ...values);
      };
      const write = response.write;
      const end = response.end;
      response.write = function (chunk, encoding, callback) {
        if (chunk != null) output.push(Buffer.from(chunk, typeof encoding === 'string' ? encoding : undefined));
        return write.call(this, chunk, encoding, callback);
      };
      response.end = function (chunk, encoding, callback) {
        if (chunk != null && typeof chunk !== 'function') output.push(Buffer.from(chunk, typeof encoding === 'string' ? encoding : undefined));
        return end.call(this, chunk, encoding, callback);
      };
      let complete = false;
      response.once('finish', () => { complete = true; store.event('http.response', { id, status: response.statusCode, headers: response.getHeaders(), body: store.blob(Buffer.concat(output)), complete }); });
      response.once('close', () => { if (!complete) store.event('http.response', { id, status: response.statusCode, headers: response.getHeaders(), body: store.blob(Buffer.concat(output)), complete: false }); });
    }
    return originalEmit.call(this, name, ...args);
  };
  syncBuiltinESMExports();
  return async () => { await Promise.allSettled([...pending]); };
}

export async function installWebSocketRecording(store) {
  const { default: WebSocket } = await import('ws');
  const originalSend = WebSocket.prototype.send;
  const originalEmit = WebSocket.prototype.emit;
  const ids = new WeakMap();
  const idFor = (socket) => { if (!ids.has(socket)) ids.set(socket, store.id()); return ids.get(socket); };
  const payload = (data) => store.blob(Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : data instanceof ArrayBuffer ? Buffer.from(data) : ArrayBuffer.isView(data) ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : String(data));
  WebSocket.prototype.send = function (data, ...args) {
    store.event('ws.send', { id: idFor(this), url: this.url, payload: payload(data), options: typeof args[0] === 'object' ? args[0] : undefined });
    return originalSend.call(this, data, ...args);
  };
  WebSocket.prototype.emit = function (name, ...args) {
    if (name === 'message') store.event('ws.message', { id: idFor(this), url: this.url, isBinary: args[1], payload: payload(args[0]) });
    else if (['open', 'close', 'error', 'upgrade'].includes(name)) store.event(`ws.${name}`, { id: idFor(this), url: this.url, detail: name === 'upgrade' ? { status: args[0].statusCode, headers: args[0].rawHeaders } : name === 'error' ? args[0] : args.map((item) => Buffer.isBuffer(item) ? item.toString() : item) });
    return originalEmit.call(this, name, ...args);
  };
}
