import { secret, uniqueId, digest, passwordCheck } from './store.mjs';
import { createHash } from 'node:crypto';
import { HubError } from './net.mjs';
export function authService(store, origin) {
  const cookieName = origin.startsWith('https:') ? '__Host-genhub' : 'genhub';
  function session(req) {
    const raw = req.headers.cookie
      ?.split(';')
      .map(s => s.trim())
      .find(s => s.startsWith(cookieName + '='))
      ?.slice(cookieName.length + 1);
    const s = raw ? store.get('session', digest(raw)) : null;
    return s && s.expires > Date.now() ? s : null;
  }
  const owner = (req, write = false) => {
    const s = session(req);
    if (!s) throw new HubError('Hãy đăng nhập', 401);
    if (write && (req.headers.origin !== origin || req.headers['x-csrf-token'] !== s.csrf))
      throw new HubError('Phiên yêu cầu không hợp lệ', 403);
    return s;
  };
  const cookie = (v, maxAge) =>
    `${cookieName}=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${origin.startsWith('https:') ? '; Secure' : ''}`;
  function login(username, password) {
    const o = store.get('owner', 'main');
    if (
      !o ||
      typeof password !== 'string' ||
      password.length > 1024 ||
      !passwordCheck(password, o.password) ||
      username !== o.username
    )
      throw new HubError('Tên đăng nhập hoặc mật khẩu không đúng', 401);
    const raw = secret() + secret(),
      s = { id: digest(raw), csrf: secret(), expires: Date.now() + 12 * 3600000 };
    store.put('session', s.id, s);
    return { cookie: cookie(raw, 43200), csrf: s.csrf };
  }
  function issue(agent, client, resource) {
    const access = secret('token') + secret(),
      refresh = secret('refresh') + secret();
    const t = {
      id: digest(access),
      agent,
      client,
      resource,
      expires: Date.now() + 3600000,
      type: 'access'
    };
    store.put('token', t.id, t);
    store.put('token', digest(refresh), {
      ...t,
      id: digest(refresh),
      type: 'refresh',
      expires: Date.now() + 30 * 86400000
    });
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'mcp'
    };
  }
  function bearer(req) {
    const raw = req.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
    const t = raw ? store.get('token', digest(raw)) : null;
    const a = t ? store.get('agent', t.agent) : null;
    if (
      !t ||
      t.type !== 'access' ||
      t.resource !== origin + '/mcp' ||
      t.expires < Date.now() ||
      !a ||
      a.status !== 'active'
    )
      throw new HubError('Agent chưa xác thực hoặc quyền đã bị thu hồi', 401);
    return a;
  }
  function register(b) {
    if (!Array.isArray(b.redirect_uris) || !b.redirect_uris.length || b.redirect_uris.length > 10)
      throw new HubError('Thiếu redirect_uris');
    for (const u of b.redirect_uris) {
      let x;
      try {
        x = new URL(u);
      } catch {
        throw new HubError('redirect_uri không hợp lệ');
      }
      if (
        x.hash ||
        x.username ||
        x.password ||
        !(
          x.protocol === 'https:' ||
          (x.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(x.hostname))
        )
      )
        throw new HubError('Chỉ chấp nhận HTTPS hoặc HTTP loopback');
    }
    if (b.token_endpoint_auth_method && !['none'].includes(b.token_endpoint_auth_method))
      throw new HubError('Dùng token_endpoint_auth_method=none và PKCE');
    const cid = uniqueId(store, 'client', 'client');
    const c = {
      id: cid,
      client_id: cid,
      client_name: String(b.client_name || 'MCP client').slice(0, 80),
      redirect_uris: b.redirect_uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      expires: Date.now() + 90 * 86400000
    };
    store.put('client', cid, c);
    return c;
  }
  function authorize(q) {
    const c = store.get('client', q.client_id);
    if (!c || c.expires < Date.now() || !c.redirect_uris.includes(q.redirect_uri))
      throw new HubError('Client hoặc redirect_uri chưa đăng ký');
    if (
      q.response_type !== 'code' ||
      q.code_challenge_method !== 'S256' ||
      !/^[A-Za-z0-9_-]{43}$/.test(q.code_challenge || '') ||
      q.resource !== origin + '/mcp' ||
      (q.scope && q.scope !== 'mcp')
    )
      throw new HubError('Yêu cầu code + PKCE S256 + resource MCP hợp lệ');
    const fid = secret('flow');
    store.put('flow', fid, {
      ...q,
      id: fid,
      name: c.client_name,
      expires: Date.now() + 10 * 60000
    });
    return fid;
  }
  function flow(fid) {
    const f = store.get('flow', fid);
    if (!f || f.expires < Date.now()) throw new HubError('Yêu cầu kết nối đã hết hạn');
    return f;
  }
  function consent(fid, permissions, approve, name, actor = 'owner', options = {}) {
    return store.tx(() => {
      const f = flow(fid);
      store.del('flow', fid);
      const redirect = new URL(f.redirect_uri);
      if (f.state) redirect.searchParams.set('state', f.state);
      if (!approve) {
        redirect.searchParams.set('error', 'access_denied');
        return redirect.href;
      }
      let isAdmin = false;
      if (options.isAdmin === true) {
        const ownerRecord = store.get('owner', 'main');
        const pwd = typeof options.password === 'string' ? options.password : '';
        if (
          !pwd ||
          pwd.length > 1024 ||
          !ownerRecord?.password ||
          !passwordCheck(pwd, ownerRecord.password)
        ) {
          throw new HubError('Mật khẩu owner không đúng khi cấp quyền quản trị', 403);
        }
        isAdmin = true;
      }
      const agentId = uniqueId(store, 'agent', 'agent'),
        code = secret('code') + secret();
      const agentRecord = {
        id: agentId,
        name: name || f.name,
        client: f.client_id,
        status: 'active',
        permissions,
        created: new Date().toISOString(),
        last: null
      };
      if (isAdmin) agentRecord.isAdmin = true;
      store.put('agent', agentId, agentRecord);
      store.put('code', digest(code), {
        ...f,
        id: digest(code),
        agent: agentId,
        expires: Date.now() + 60000
      });
      redirect.searchParams.set('code', code);
      store.audit(
        actor,
        'hub',
        'agent.authorize',
        'success',
        { agent: agentId, name: name || f.name, permissions, isAdmin },
        { approved: true, isAdmin }
      );
      return redirect.href;
    });
  }
  function exchange(b) {
    return store.tx(() => {
      if (b.grant_type === 'authorization_code') {
        const key = digest(String(b.code || '')),
          c = store.get('code', key);
        if (
          !c ||
          c.expires < Date.now() ||
          c.client_id !== b.client_id ||
          c.redirect_uri !== b.redirect_uri ||
          c.resource !== b.resource ||
          !/^[A-Za-z0-9._~-]{43,128}$/.test(b.code_verifier || '')
        )
          throw new HubError('invalid_grant');
        if (createHash('sha256').update(b.code_verifier).digest('base64url') !== c.code_challenge)
          throw new HubError('invalid_grant');
        store.del('code', key);
        return issue(c.agent, c.client_id, c.resource);
      }
      if (b.grant_type === 'refresh_token') {
        const key = digest(String(b.refresh_token || '')),
          t = store.get('token', key),
          a = t && store.get('agent', t.agent);
        if (
          !t ||
          t.type !== 'refresh' ||
          t.expires < Date.now() ||
          t.client !== b.client_id ||
          t.resource !== b.resource ||
          a?.status !== 'active'
        )
          throw new HubError('invalid_grant');
        store.del('token', key);
        return issue(t.agent, t.client, t.resource);
      }
      throw new HubError('unsupported_grant_type');
    });
  }
  return {
    session,
    owner,
    login,
    bearer,
    register,
    authorize,
    flow,
    consent,
    exchange,
    issue,
    logout: req => {
      const s = session(req);
      if (s) store.del('session', s.id);
      return cookie('', 0);
    },
    metadata: {
      issuer: origin,
      authorization_endpoint: origin + '/oauth/authorize',
      token_endpoint: origin + '/oauth/token',
      registration_endpoint: origin + '/oauth/register',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['mcp']
    }
  };
}
