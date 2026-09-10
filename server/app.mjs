import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { openStore, id, digest, passwordHash, passwordCheck, redact } from './store.mjs';
import { HubError, assertSchema, jsonRequest, request } from './net.mjs';
import { catalog, provider } from './catalog.mjs';
import { connectorService } from './connectors.mjs';
import { authService } from './auth.mjs';
import { adminAssistant } from './admin-assistant.mjs';
import { vaultService } from './vault.mjs';
const pub = fileURLToPath(new URL('../public/', import.meta.url));
const cleanMcp = ({ secret, ...m }) => ({ ...m, hasCredential: !!secret });
const text = (v, max = 200) =>
  typeof v === 'string' && v.trim() && v.length <= max
    ? v.trim()
    : (() => {
        throw new HubError('Nội dung bắt buộc hoặc quá dài');
      })();
export function createHub({
  dir,
  origin = 'http://127.0.0.1:3080',
  connector,
  installationId = ''
}) {
  const base = new URL(origin);
  if (
    base.pathname !== '/' ||
    base.search ||
    base.hash ||
    !['http:', 'https:'].includes(base.protocol)
  )
    throw Error('PUBLIC_URL must be an origin');
  origin = base.origin;
  const store = openStore(dir),
    vault = vaultService(store),
    auth = authService(store, origin),
    up = connector || connectorService(store),
    limits = new Map();
  let inFlight = 0;
  const rate = (key, max, period = 60000) => {
    const now = Date.now(),
      r = limits.get(key);
    if (!r || r.until < now) {
      limits.set(key, { count: 1, until: now + period });
      return;
    }
    if (++r.count > max) throw new HubError('Quá nhiều yêu cầu, hãy thử lại sau', 429);
    if (limits.size > 10000) for (const [k, v] of limits) if (v.until < now) limits.delete(k);
  };
  const allowed = (a, m, t) =>
    a?.status === 'active' &&
    m?.on &&
    m?.status === 'connected' &&
    t?.published &&
    a.permissions.includes(m.id + ':' + t.name);
  function requirePin(pin, actor, operation, target) {
    try {
      const hash = store.get('security', 'pin')?.hash;
      if (!hash) throw new HubError('Owner cần đặt PIN trong Cài đặt trước khi thực hiện', 403);
      // One budget across web, admin tokens and targets; changing token cannot reset it.
      rate('destructive-pin', 5, 15 * 60000);
      if (typeof pin !== 'string' || !/^[0-9]{4,12}$/.test(pin) || !passwordCheck(pin, hash))
        throw new HubError('PIN không đúng', 403);
      limits.delete('destructive-pin');
    } catch (e) {
      store.audit(actor, 'hub', 'security.pin_check', 'denied', { operation, target }, {});
      throw e;
    }
  }
  const validateGrants = permissions => {
    if (!Array.isArray(permissions) || permissions.length > 2000)
      throw new HubError('Danh sách quyền không hợp lệ');
    for (const p of permissions) {
      if (typeof p !== 'string') throw new HubError('Quyền không hợp lệ');
      if (p.startsWith('vault:')) {
        if (!store.get('vault', p.slice(6))) throw new HubError('Secret không tồn tại');
        continue;
      }
      const [mid, name] = p.split(':');
      if (!store.get('mcp', mid)?.tools.some(t => t.name === name && t.published))
        throw new HubError('Tool chưa được công bố: ' + p);
    }
    return [...new Set(permissions)];
  };
  const audit = (tool, input, output = {}, mcp = 'hub') =>
    store.audit('owner', mcp, tool, 'success', redact(input), redact(output));
  async function body(req) {
    let size = 0;
    const parts = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 1024 * 1024) throw new HubError('Yêu cầu vượt 1 MiB', 413);
      parts.push(chunk);
    }
    const raw = Buffer.concat(parts).toString();
    try {
      return req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')
        ? Object.fromEntries(new URLSearchParams(raw))
        : raw
          ? JSON.parse(raw)
          : {};
    } catch {
      throw new HubError('JSON không hợp lệ');
    }
  }
  function send(res, status, data, headers = {}) {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers
    });
    res.end(data === undefined ? '' : typeof data === 'string' ? data : JSON.stringify(data));
  }
  function oauthCredential(m, b) {
    const current = m.secret ? store.unseal(m.secret) : {},
      oauth = provider(m.provider)?.oauth;
    if (!oauth) throw new HubError('Dịch vụ này dùng token');
    return {
      ...current,
      client_id: text(b.client_id || current.client_id),
      client_secret: text(b.client_secret || current.client_secret, 4000),
      oauth
    };
  }
  async function startOAuth(m, b, s) {
    const c = oauthCredential(m, b),
      state = id() + id(),
      verifier = randomBytes(32).toString('base64url');
    store.put('oauthstate', digest(state), {
      id: digest(state),
      mcp: m.id,
      session: s.id,
      credential: store.seal(c),
      verifier,
      expires: Date.now() + 10 * 60000
    });
    const u = new URL(c.oauth.authorize);
    u.search = new URLSearchParams({
      client_id: c.client_id,
      redirect_uri: origin + '/oauth/callback',
      response_type: 'code',
      scope: c.oauth.scope,
      state,
      ...(m.provider === 'drive'
        ? {
            access_type: 'offline',
            prompt: 'consent',
            code_challenge: createHash('sha256').update(verifier).digest('base64url'),
            code_challenge_method: 'S256'
          }
        : {})
    }).toString();
    return { url: u.href };
  }
  async function syncMcp(m) {
    const old = m.tools || [],
      tools = await up.sync(m);
    if (
      !Array.isArray(tools) ||
      tools.some(t => !/^[A-Za-z0-9_.-]{1,100}$/.test(t.name) || !t.inputSchema) ||
      new Set(tools.map(t => t.name)).size !== tools.length
    )
      throw new HubError('Schema hoặc tên tool từ MCP không hợp lệ', 502);
    const latest = store.get('mcp', m.id);
    if (!latest || (latest.credentialVersion || 0) !== (m.credentialVersion || 0))
      throw new HubError('Kết nối đã thay đổi; vui lòng thử lại', 409);
    latest.tools = tools.map(t => ({
      ...t,
      published: old.find(x => x.name === t.name)?.published ?? t.annotations?.readOnlyHint === true
    }));
    latest.status = 'connected';
    latest.lastError = null;
    latest.syncedAt = new Date().toISOString();
    store.put('mcp', m.id, latest);
    return cleanMcp(latest);
  }
  async function rpc(req, res, b) {
    let a;
    try {
      a = auth.bearer(req);
    } catch (e) {
      return send(
        res,
        401,
        { error: e.message },
        {
          'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`
        }
      );
    }
    rate('mcp:' + a.id, 240);
    if (req.method !== 'POST') return send(res, 405, { error: 'Sử dụng POST' }, { Allow: 'POST' });
    const rpcError = (code, message, status = 200) =>
      send(res, status, { jsonrpc: '2.0', id: b?.id ?? null, error: { code, message } });
    if (!b || b.jsonrpc !== '2.0' || Array.isArray(b) || typeof b.method !== 'string')
      return rpcError(-32600, 'Invalid Request', 400);
    const version = req.headers['mcp-protocol-version'];
    if (version && !['2025-03-26', '2025-06-18', '2025-11-25'].includes(version))
      return rpcError(-32600, 'Unsupported protocol version', 400);
    if (b.id === undefined) return send(res, 202);
    const result = r => send(res, 200, { jsonrpc: '2.0', id: b.id, result: r });
    if (b.method === 'initialize')
      return result({
        protocolVersion: ['2025-03-26', '2025-06-18', '2025-11-25'].includes(
          b.params?.protocolVersion
        )
          ? b.params.protocolVersion
          : '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'gen-hub', version: '0.1.0' },
        instructions: 'Chỉ sử dụng các công cụ được owner cấp quyền.'
      });
    if (b.method === 'ping') return result({});
    if (b.method === 'tools/list') {
      const tools = store
        .list('mcp')
        .flatMap(m =>
          m.tools
            .filter(t => allowed(a, m, t))
            .map(({ published, ...t }) => ({ ...t, name: m.id + '__' + t.name }))
        )
        .concat(vault.tools(a))
        .sort((x, y) => x.name.localeCompare(y.name));
      return result({ tools });
    }
    if (b.method !== 'tools/call') return rpcError(-32601, 'Method not found');
    const start = performance.now(),
      name = b.params?.name,
      args = b.params?.arguments ?? {};
    if (typeof name !== 'string') return rpcError(-32602, 'Missing tool name');
    if (name.startsWith('vault__')) {
      const sid = name.slice(7);
      if (!vault.canRead(a, sid)) {
        store.audit(a.id, 'vault', 'vault.read', 'denied', { id: sid }, {});
        return rpcError(-32602, 'Tool không khả dụng hoặc chưa được cấp quyền');
      }
      try {
        assertSchema({ properties: {}, additionalProperties: false }, args);
        const output = vault.read(sid, a.id);
        store.put('agent', a.id, { ...a, last: new Date().toISOString() });
        return result({
          content: [{ type: 'text', text: JSON.stringify(output) }],
          isError: false
        });
      } catch {
        store.audit(a.id, 'vault', 'vault.call', 'error', { id: sid }, {});
        return result({
          content: [{ type: 'text', text: 'Không thể đọc secret; kiểm tra tham số và nhật ký.' }],
          isError: true
        });
      }
    }
    const idx = name.indexOf('__'),
      mid = name.slice(0, idx),
      tn = name.slice(idx + 2),
      m = store.get('mcp', mid),
      t = m?.tools.find(t => t.name === tn);
    if (!allowed(a, m, t)) {
      store.audit(
        a.id,
        mid,
        tn,
        'denied',
        redact(args),
        {},
        0,
        'Tool không được cấp, không công bố hoặc kết nối chưa sẵn sàng'
      );
      return rpcError(-32602, 'Tool không khả dụng hoặc chưa được cấp quyền');
    }
    try {
      assertSchema(t.inputSchema, args);
      if (inFlight >= 32) throw new HubError('Hub đang bận, hãy thử lại', 429);
      inFlight++;
      let out;
      try {
        out = await up.call(m, tn, args);
      } finally {
        inFlight--;
      }
      const latest = store.get('agent', a.id);
      if (latest) {
        latest.last = new Date().toISOString();
        store.put('agent', a.id, latest);
      }
      store.audit(
        a.id,
        mid,
        tn,
        out.isError ? 'error' : 'success',
        redact(args),
        redact(out),
        performance.now() - start,
        'Agent được cấp quyền và tool đang được công bố'
      );
      return result(out);
    } catch (e) {
      if (e.status === 401) {
        const latest = store.get('mcp', mid);
        if (latest) {
          latest.status = 'expired';
          store.put('mcp', mid, latest);
        }
      }
      const message = e instanceof HubError ? e.message : 'Không thể hoàn tất yêu cầu đến dịch vụ';
      store.audit(
        a.id,
        mid,
        tn,
        'error',
        redact(args),
        { error: message },
        performance.now() - start,
        message
      );
      return result({ content: [{ type: 'text', text: message }], isError: true });
    }
  }
  async function ownerApi({ method, parts, b = {}, s, req, actor = 'owner' }) {
    const write = !['GET', 'HEAD'].includes(method);
    const [resource, mid, action] = parts;
    const respond = (status, data, headers) => ({ status, data, headers });
    const audit = (tool, input, output = {}, mcp = 'hub') =>
      store.audit(actor, mcp, tool, 'success', redact(input), redact(output));
    const m = mid ? store.get('mcp', mid) : null;
    if (resource === 'session')
      return respond(200, { csrf: s.csrf, owner: store.get('owner', 'main').username });
    if (resource === 'logout' && write)
      return respond(200, { ok: true }, { 'Set-Cookie': auth.logout(req) });
    if (resource === 'state' && !write) {
      store.clean();
      const mcps = store.list('mcp').map(cleanMcp),
        agents = store.list('agent').map(a => ({
          ...a,
          effective:
            mcps.reduce((n, m) => n + m.tools.filter(t => allowed(a, m, t)).length, 0) +
            vault.tools(a).length
        }));
      return respond(200, {
        mcps,
        vault: vault.list(),
        security: { pinConfigured: !!store.get('security', 'pin')?.hash },
        agents,
        logs: store.logs(200).map(redact),
        settings: store.get('settings', 'main') || {
          name: 'Gen-hub',
          retention: 30,
          onboarded: false
        },
        origin,
        endpoint: origin + '/mcp',
        catalog,
        adminAssistant: assistant.status(),
        owner: store.get('owner', 'main').username
      });
    }
    if (resource === 'vault') {
      if (!mid && method === 'GET') return respond(200, vault.list());
      if (!mid && method === 'POST') return respond(201, vault.create(b, actor));
      if (mid && !action && method === 'PATCH') return respond(200, vault.update(mid, b, actor));
      if (mid && !action && method === 'DELETE') {
        requirePin(b.pin, actor, 'vault.remove', mid);
        return respond(200, vault.remove(mid, actor));
      }
      if (mid && action === 'read' && method === 'POST')
        return respond(200, vault.read(mid, actor));
      if (mid && action === 'grants' && method === 'POST')
        return respond(200, vault.share(mid, b, actor));
      throw new HubError('Không tìm thấy API', 404);
    }
    if (resource === 'settings' && method === 'PATCH') {
      const old = store.get('settings', 'main') || {};
      if (b.name !== undefined) old.name = text(b.name, 60);
      if (b.retention !== undefined) {
        if (![7, 30, 90].includes(b.retention)) throw new HubError('Thời gian lưu không hợp lệ');
        old.retention = b.retention;
      }
      if (b.onboarded !== undefined) old.onboarded = !!b.onboarded;
      store.put('settings', 'main', old);
      audit('settings.update', b);
      return respond(200, old);
    }
    if (resource === 'password' && method === 'POST') {
      const o = store.get('owner', 'main');
      if (!passwordCheck(String(b.current || ''), o.password))
        throw new HubError('Mật khẩu hiện tại không đúng', 403);
      if (typeof b.password !== 'string' || b.password.length < 12 || b.password.length > 256)
        throw new HubError('Mật khẩu cần 12–256 ký tự');
      o.password = passwordHash(b.password);
      store.put('owner', 'main', o);
      for (const sess of store.list('session')) store.del('session', sess.id);
      audit('owner.password_changed', {});
      return respond(200, { ok: true });
    }
    if (resource === 'mcps' && method === 'POST' && !mid) {
      const template = provider(b.provider);
      if (!template && b.provider !== 'remote') throw new HubError('Dịch vụ không hợp lệ');
      const mid = randomBytes(12).toString('hex'),
        m = {
          id: mid,
          name: text(b.name || template?.name, 60),
          provider: b.provider,
          description: template?.description || 'MCP HTTP tùy chỉnh',
          on: true,
          status: 'disconnected',
          tools: template ? template.tools : [],
          auth: b.auth === 'none' ? 'none' : 'token',
          url: b.url || '',
          allowPrivate: !!b.allowPrivate,
          created: new Date().toISOString()
        };
      if (m.provider === 'remote') {
        if (m.url.length > 2048) throw new HubError('URL quá dài');
        const url = new URL(m.url);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
          throw new HubError('Địa chỉ không hợp lệ');
      }
      store.put('mcp', mid, m);
      audit('mcp.add', { name: m.name, provider: m.provider }, { id: mid }, mid);
      return respond(201, cleanMcp(m));
    }
    if (resource === 'mcps' && m) {
      if (method === 'DELETE' && !action) {
        requirePin(b.pin, actor, 'mcp.remove', mid);
        store.del('mcp', mid);
        for (const a of store.list('agent')) {
          a.permissions = a.permissions.filter(p => !p.startsWith(mid + ':'));
          store.put('agent', a.id, a);
        }
        audit('mcp.remove', { id: mid });
        return respond(200, { ok: true });
      }
      if (method === 'PATCH' && !action) {
        if (b.on !== undefined) m.on = !!b.on;
        if (b.name) m.name = text(b.name, 60);
        if (b.published) {
          if (
            !Array.isArray(b.published) ||
            b.published.some(n => !m.tools.some(t => t.name === n))
          )
            throw new HubError('Tool không hợp lệ');
          m.tools = m.tools.map(t => ({ ...t, published: b.published.includes(t.name) }));
        }
        store.put('mcp', mid, m);
        audit('mcp.update', b, {}, mid);
        return respond(200, cleanMcp(m));
      }
      if (action === 'credential' && method === 'POST') {
        if (m.provider === 'remote' && new URL(m.url).protocol !== 'https:' && !m.allowPrivate)
          throw new HubError('Dùng HTTPS để bảo vệ token');
        const token = text(b.token, 16000);
        m.credentialVersion = (m.credentialVersion || 0) + 1;
        m.secret = store.seal({ token });
        m.status = 'disconnected';
        store.put('mcp', mid, m);
        const result = await syncMcp(m);
        audit('connection.authorize', { mcp: mid }, { connected: true }, mid);
        return respond(200, result);
      }
      if (action === 'oauth' && method === 'POST') return respond(200, await startOAuth(m, b, s));
      if (action === 'sync' && method === 'POST') {
        const result = await syncMcp(m);
        audit('mcp.sync', {}, { toolCount: result.tools.length }, mid);
        return respond(200, result);
      }
      if (action === 'disconnect' && method === 'POST') {
        requirePin(b.pin, actor, 'connection.disconnect', mid);
        delete m.secret;
        m.credentialVersion = (m.credentialVersion || 0) + 1;
        m.status = 'disconnected';
        store.put('mcp', mid, m);
        audit('connection.disconnect', {}, {}, mid);
        return respond(200, { ok: true });
      }
    }
    if (resource === 'agents' && method === 'POST' && !mid) {
      const aid = id();
      store.put('agent', aid, {
        id: aid,
        name: text(b.name, 80),
        client: 'Manual',
        status: 'active',
        permissions: validateGrants(b.permissions || []),
        created: new Date().toISOString()
      });
      const raw = id() + id();
      store.put('token', digest(raw), {
        id: digest(raw),
        agent: aid,
        client: 'Manual',
        type: 'access',
        resource: origin + '/mcp',
        expires: Date.now() + 90 * 86400000
      });
      audit('agent.create', { name: b.name, permissions: b.permissions }, { id: aid });
      return respond(201, { id: aid, token: raw, expires_in: 90 * 86400 });
    }
    if (resource === 'agents' && mid && method === 'PATCH') {
      const a = store.get('agent', mid);
      if (!a) throw new HubError('Không tìm thấy agent', 404);
      if (b.name !== undefined) a.name = text(b.name, 80);
      if (b.permissions) a.permissions = validateGrants(b.permissions);
      if (b.status) {
        if (!['active', 'revoked'].includes(b.status))
          throw new HubError('Trạng thái không hợp lệ');
        a.status = b.status;
        if (b.status === 'revoked')
          for (const t of store.list('token')) if (t.agent === mid) store.del('token', t.id);
      }
      store.put('agent', mid, a);
      audit('agent.update', { id: mid, ...b });
      return respond(200, a);
    }
    if (resource === 'agents' && mid && !action && method === 'DELETE') {
      const a = store.get('agent', mid);
      if (!a) throw new HubError('Không tìm thấy agent', 404);
      if (a.status !== 'revoked') throw new HubError('Thu hồi agent trước khi xóa', 409);
      requirePin(b.pin, actor, 'agent.remove', mid);
      store.tx(() => {
        for (const type of ['token', 'code'])
          for (const record of store.list(type))
            if (record.agent === mid) store.del(type, record.id);
        store.del('agent', mid);
        audit('agent.remove', { id: mid, name: a.name });
      });
      return respond(200, { ok: true });
    }
    if (resource === 'flows' && mid) {
      const f = auth.flow(mid);
      if (method === 'GET')
        return respond(200, { id: f.id, name: f.name, redirect_uri: f.redirect_uri });
      if (method === 'POST')
        return respond(200, {
          redirect: auth.consent(
            mid,
            validateGrants(b.permissions || []),
            b.approve === true,
            b.approve === true && b.name !== undefined && b.name !== ''
              ? text(b.name, 80)
              : undefined,
            actor
          )
        });
    }
    if (resource === 'test' && method === 'POST') {
      const a = store.get('agent', b.agent),
        m = store.get('mcp', b.mcp),
        t = m?.tools.find(t => t.name === b.tool);
      return respond(200, {
        allowed: b.mcp === 'vault' ? !!vault.canRead(a, b.tool) : !!allowed(a, m, t),
        reason: (b.mcp === 'vault' ? vault.canRead(a, b.tool) : allowed(a, m, t))
          ? 'Agent được cấp quyền và tool khả dụng'
          : 'Agent chưa được cấp, MCP tạm dừng, kết nối lỗi hoặc tool chưa công bố'
      });
    }
    if (resource === 'logs' && !write) return respond(200, store.logs(5000).map(redact));
    throw new HubError('Không tìm thấy API', 404);
  }
  const assistant = adminAssistant(store, origin, ({ path, ...context }) =>
    ownerApi({ ...context, parts: path.split('/') })
  );
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'"
    );
    try {
      const u = new URL(req.url, origin),
        p = u.pathname;
      if (
        req.headers.host !== base.host &&
        !(
          p === '/healthz' &&
          ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
        )
      )
        throw new HubError('Host không hợp lệ', 403);
      if (req.headers.origin && req.headers.origin !== origin)
        throw new HubError('Origin không được cho phép', 403);
      if (p === '/healthz')
        return send(res, 200, {
          ok: true,
          installationId,
          initialized: !!store.get('owner', 'main')
        });
      if (!store.get('owner', 'main') && !['/healthz'].includes(p))
        return send(res, 503, { error: 'Hoàn tất tạo owner trong TUI trước khi sử dụng.' });
      if (
        [
          '/.well-known/oauth-protected-resource',
          '/.well-known/oauth-protected-resource/mcp'
        ].includes(p)
      )
        return send(res, 200, {
          resource: origin + '/mcp',
          authorization_servers: [origin],
          scopes_supported: ['mcp'],
          bearer_methods_supported: ['header']
        });
      if (p === '/.well-known/oauth-authorization-server') return send(res, 200, auth.metadata);
      if (p === '/oauth/register' && req.method === 'POST') {
        rate('register:' + req.socket.remoteAddress, 30, 3600000);
        return send(res, 201, auth.register(await body(req)));
      }
      if (p === '/oauth/authorize' && req.method === 'GET') {
        rate('authorize:' + req.socket.remoteAddress, 30);
        const flow = auth.authorize(Object.fromEntries(u.searchParams));
        return send(res, 302, undefined, { Location: '/#consent/' + flow });
      }
      if (p === '/oauth/token' && req.method === 'POST') {
        rate('token:' + req.socket.remoteAddress, 120);
        return send(res, 200, auth.exchange(await body(req)));
      }
      if (p === '/oauth/callback') {
        const key = digest(u.searchParams.get('state') || ''),
          s = auth.session(req),
          flow = store.get('oauthstate', key);
        if (!flow || !s || flow.session !== s.id || flow.expires < Date.now())
          throw new HubError('Phiên OAuth không hợp lệ', 403);
        store.del('oauthstate', key);
        if (u.searchParams.get('error')) throw new HubError('Người dùng từ chối kết nối');
        const code = u.searchParams.get('code');
        if (!code) throw new HubError('Thiếu OAuth code');
        const c = store.unseal(flow.credential),
          m = store.get('mcp', flow.mcp);
        if (!m) throw new HubError('MCP đã được gỡ', 404);
        const data = await jsonRequest(c.oauth.token, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json'
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            client_id: c.client_id,
            client_secret: c.client_secret,
            redirect_uri: origin + '/oauth/callback',
            ...(m.provider === 'drive' ? { code_verifier: flow.verifier } : {})
          }).toString()
        });
        if (!data.access_token) throw new HubError('Nhà cung cấp không trả access token', 502);
        m.credentialVersion = (m.credentialVersion || 0) + 1;
        m.secret = store.seal({
          ...c,
          ...data,
          expires_at: data.expires_in ? Date.now() + data.expires_in * 1000 : null
        });
        m.status = 'connected';
        store.put('mcp', m.id, m);
        try {
          await syncMcp(m);
        } catch (e) {
          m.lastError = e.message;
          store.put('mcp', m.id, m);
        }
        audit('connection.oauth', { mcp: m.id }, { connected: true }, m.id);
        return send(res, 302, undefined, { Location: '/#mcps' });
      }
      if (p === '/mcp') return await rpc(req, res, req.method === 'POST' ? await body(req) : {});
      if (p === '/api/login' && req.method === 'POST') {
        if (req.headers.origin !== origin) throw new HubError('Origin không hợp lệ', 403);
        rate('login:' + req.socket.remoteAddress, 10, 15 * 60000);
        const b = await body(req),
          r = auth.login(b.username, b.password);
        audit('owner.login', {});
        return send(res, 200, { csrf: r.csrf }, { 'Set-Cookie': r.cookie });
      }
      if (p === '/mcp/admin') {
        let actor;
        try {
          actor = assistant.authenticate(req);
        } catch (e) {
          return send(
            res,
            401,
            { error: e.message },
            { 'WWW-Authenticate': 'Bearer realm="gen-hub-admin"' }
          );
        }
        rate(actor, 120);
        const response = await assistant.rpc(
          req,
          req.method === 'POST' ? await body(req) : {},
          actor
        );
        return send(res, response.status, response.data, response.headers);
      }
      if (p.startsWith('/api/')) {
        const write = !['GET', 'HEAD'].includes(req.method),
          s = auth.owner(req, write);
        const b = write ? await body(req) : {};
        // PIN setup/reset is web-only and always needs the actual owner password.
        if (p === '/api/security/pin' && req.method === 'POST') {
          rate('pin-setup:owner', 5, 15 * 60000);
          if (
            typeof b.password !== 'string' ||
            b.password.length > 1024 ||
            !passwordCheck(b.password, store.get('owner', 'main').password)
          )
            throw new HubError('Mật khẩu owner không đúng', 403);
          if (typeof b.pin !== 'string' || !/^[0-9]{4,12}$/.test(b.pin))
            throw new HubError('PIN cần 4–12 chữ số');
          store.put('security', 'pin', { hash: passwordHash(b.pin) });
          limits.delete('destructive-pin');
          audit('security.pin_set', {});
          return send(res, 200, { pinConfigured: true });
        }
        if (p === '/api/admin-assistant') {
          if (req.method === 'GET') return send(res, 200, assistant.status());
          if (req.method === 'POST') {
            rate('admin-token:owner', 5, 15 * 60000);
            return send(res, 201, assistant.create(b.password));
          }
          if (req.method === 'DELETE') return send(res, 200, assistant.revoke());
          throw new HubError('Method not allowed', 405);
        }
        const response = await ownerApi({
          method: req.method,
          parts: p.split('/').slice(2),
          b,
          s,
          req
        });
        return send(res, response.status, response.data, response.headers);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD')
        throw new HubError('Method not allowed', 405);
      const files = {
        '/': 'index.html',
        '/app.js': 'app.js',
        '/connection-guides.js': 'connection-guides.js',
        '/styles.css': 'styles.css'
      };
      if (!files[p]) throw new HubError('Không tìm thấy trang', 404);
      const data = await readFile(join(pub, files[p]));
      res.setHeader(
        'Content-Type',
        p.endsWith('.js')
          ? 'text/javascript; charset=utf-8'
          : p.endsWith('.css')
            ? 'text/css; charset=utf-8'
            : 'text/html; charset=utf-8'
      );
      res.setHeader('Cache-Control', 'no-cache');
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (e) {
      if (!res.headersSent)
        send(res, e.status || 500, {
          error: e instanceof HubError ? e.message : 'Lỗi hệ thống. Kiểm tra nhật ký dịch vụ.'
        });
      else res.end();
      if (!(e instanceof HubError)) console.error('Request failure:', e.code || e.name);
    }
  });
  server.requestTimeout = 35000;
  server.headersTimeout = 15000;
  server.maxHeadersCount = 80;
  const timer = setInterval(() => store.clean(), 3600000);
  timer.unref();
  return {
    server,
    store,
    auth,
    allowed,
    close: () => {
      clearInterval(timer);
      server.close();
      store.close();
    }
  };
}
