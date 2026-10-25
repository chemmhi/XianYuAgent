import net from 'node:net';
import { randomBytes } from 'node:crypto';

function parsePort(value, name) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return port;
}

function canListen(port, host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE') resolve(false);
      else reject(error);
    });
    server.listen({ host, port }, () => {
      server.close((error) => error ? reject(error) : resolve(true));
    });
  });
}

export async function findAvailablePort(startPort, { host = '0.0.0.0', exclude = [] } = {}) {
  const start = parsePort(startPort, 'Starting port');
  const excluded = new Set(exclude);
  for (let port = start; port <= 65535; port += 1) {
    if (excluded.has(port) || !await canListen(port, host)) continue;
    // Windows permits a wildcard bind alongside an existing loopback bind.
    // Probe the advertised local address too, or browsers reach that owner.
    if (host === '0.0.0.0' && !await canListen(port, '127.0.0.1')) continue;
    return port;
  }
  throw new Error(`No available port between ${start} and 65535 on ${host}.`);
}

export async function resolveDevPorts(env = process.env) {
  const apiStart = parsePort(env.PORT ?? 8080, 'PORT');
  const webStart = parsePort(env.VITE_PORT ?? 5173, 'VITE_PORT');
  const apiPort = await findAvailablePort(apiStart, { host: env.HOST ?? '0.0.0.0' });
  const webPort = await findAvailablePort(webStart, { exclude: [apiPort] });
  return { apiPort, webPort };
}

export function createDevEnvironment({ apiPort, webPort }, env = process.env) {
  const origins = new Set((env.WS_ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean));
  for (const port of [apiPort, webPort]) {
    origins.add(`http://localhost:${port}`);
    origins.add(`http://127.0.0.1:${port}`);
  }
  return {
    ...env,
    // One launch shares an RPC secret across API/Worker. Keep the persisted
    // credential-encryption key unchanged when a developer has not set one.
    XIANYU_IM_OWNER_SECRET: env.XIANYU_IM_OWNER_SECRET?.trim() || randomBytes(32).toString('hex'),
    PORT: String(apiPort),
    VITE_PORT: String(webPort),
    VITE_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
    WS_ALLOWED_ORIGINS: [...origins].join(','),
  };
}
