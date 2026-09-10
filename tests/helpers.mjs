import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { createHub } from '../server/app.mjs';
import { passwordHash } from '../server/store.mjs';

export async function fixture(t, connector, options = {}) {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const dir = mkdtempSync(join(tmpdir(), 'genhub-regression-'));
  const origin = 'http://127.0.0.1:' + port;
  const hub = createHub({ dir, origin, connector, ...options });
  hub.store.put('owner', 'main', {
    username: 'owner',
    password: passwordHash('owner-password-123')
  });
  await new Promise(resolve => hub.server.listen(port, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => hub.server.close(resolve));
    hub.store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  let cookie = '',
    csrf = '';
  async function call(path, method = 'GET', body, headers = {}) {
    const response = await fetch(origin + path, {
      method,
      redirect: 'manual',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        Cookie: cookie,
        'X-CSRF-Token': csrf,
        ...headers
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      data: text ? JSON.parse(text) : undefined
    };
  }
  const login = await call('/api/login', 'POST', {
    username: 'owner',
    password: 'owner-password-123'
  });
  cookie = login.headers.get('set-cookie').split(';')[0];
  csrf = login.data.csrf;
  return { hub, origin, dir, call };
}
