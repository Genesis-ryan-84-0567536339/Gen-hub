import { jsonRequest, request, HubError } from './net.mjs';
import { provider } from './catalog.mjs';
import { isMcp, githubTools, githubCall, githubEndpoint } from './github-mcp.mjs';
import { giteaTools, giteaCall, giteaBaseUrl, isDefaultGiteaUrl } from './gitea-mcp.mjs';
const enc = encodeURIComponent;
const query = o => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') q.set(k, v);
  return q.toString();
};
export function checkToolPermissions(m, tools = [], { headers = {}, credential = {} } = {}) {
  const providerId = m?.provider || m?.id;

  if (providerId === 'github') {
    const scopeHeader = headers['x-oauth-scopes'];
    if (scopeHeader !== undefined && scopeHeader !== null) {
      const tokenScopes = scopeHeader
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);
      return tools.map(t => {
        const required = t.scopes || [];
        if (required.length === 0) {
          return { ...t, permission: { status: 'ok', reason: 'Khả dụng' } };
        }
        const hasScope = required.some(req => tokenScopes.includes(req.toLowerCase()));
        if (hasScope) {
          return { ...t, permission: { status: 'ok', reason: 'Khả dụng' } };
        }
        const needed = required[0];
        return {
          ...t,
          permission: {
            status: 'missing',
            reason: `Thiếu quyền: cần scope ${needed}`
          }
        };
      });
    }
    return tools.map(t => ({
      ...t,
      permission: {
        status: 'unknown',
        reason: 'Không xác định được (fine-grained token hoặc provider không trả scope)'
      }
    }));
  }

  if (providerId === 'github-mcp' || providerId === 'gitea-mcp') {
    const scopeHeader = headers['x-oauth-scopes'] || credential.scope;
    if (scopeHeader !== undefined && scopeHeader !== null) {
      const tokenScopes = (typeof scopeHeader === 'string' ? scopeHeader.split(/[\s,]+/) : [])
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);
      return tools.map(t => {
        const required = t.scopes || [];
        if (required.length === 0) {
          return { ...t, permission: { status: 'ok', reason: 'Khả dụng' } };
        }
        const hasScope = required.some(req => tokenScopes.includes(req.toLowerCase()));
        if (hasScope) {
          return { ...t, permission: { status: 'ok', reason: 'Khả dụng' } };
        }
        const needed = required[0];
        return {
          ...t,
          permission: {
            status: 'missing',
            reason: `Thiếu quyền: cần scope ${needed}`
          }
        };
      });
    }
    return tools.map(t => ({
      ...t,
      permission: t.permission || { status: 'ok', reason: 'Khả dụng' }
    }));
  }

  if (providerId === 'slack') {
    const scopeHeader = headers['x-oauth-scopes'] || credential.scope;
    if (scopeHeader !== undefined && scopeHeader !== null) {
      const tokenScopes = (typeof scopeHeader === 'string' ? scopeHeader.split(/[\s,]+/) : [])
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);
      return tools.map(t => {
        const required = t.scopes || [];
        if (required.length === 0) {
          return { ...t, permission: { status: 'ok', reason: 'Khả dụng' } };
        }
        const hasScope = required.some(req => tokenScopes.includes(req.toLowerCase()));
        if (hasScope) {
          return { ...t, permission: { status: 'ok', reason: 'Khả dụng' } };
        }
        const needed = required[0];
        return {
          ...t,
          permission: {
            status: 'missing',
            reason: `Thiếu quyền: cần scope ${needed}`
          }
        };
      });
    }
    return tools.map(t => ({
      ...t,
      permission: {
        status: 'unknown',
        reason: 'Không xác định được (provider không trả scope)'
      }
    }));
  }

  if (providerId === 'drive') {
    const scopeHeader = headers['x-oauth-scopes'] || credential.scope;
    if (scopeHeader !== undefined && scopeHeader !== null) {
      const tokenScopes = (typeof scopeHeader === 'string' ? scopeHeader.split(/[\s,]+/) : [])
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);
      return tools.map(t => {
        const required = t.scopes || [];
        if (required.length === 0) {
          return { ...t, permission: { status: 'ok', reason: 'Khả dụng' } };
        }
        const hasScope = required.some(req => tokenScopes.includes(req.toLowerCase()));
        if (hasScope) {
          return { ...t, permission: { status: 'ok', reason: 'Khả dụng' } };
        }
        const isWriteTool = t.annotations?.destructiveHint || !t.annotations?.readOnlyHint;
        const reason = isWriteTool
          ? 'Thiếu quyền: cần scope ghi Drive (hiện chỉ có readonly)'
          : `Thiếu quyền: cần scope ${required[0]}`;
        return {
          ...t,
          permission: {
            status: 'missing',
            reason
          }
        };
      });
    }
    return tools.map(t => ({
      ...t,
      permission: {
        status: 'unknown',
        reason: 'Không xác định được (provider không trả scope)'
      }
    }));
  }

  if (providerId === 'telegram') {
    return tools.map(t => ({
      ...t,
      permission: { status: 'ok', reason: 'Khả dụng' }
    }));
  }

  if (providerId === 'discord') {
    return tools.map(t => ({
      ...t,
      permission: {
        status: 'unknown',
        reason: 'Không xác định được (quyền Discord phân cấp theo server)'
      }
    }));
  }

  if (providerId === 'figma') {
    return tools.map(t => ({
      ...t,
      permission: {
        status: 'unknown',
        reason: 'Không xác định được (Figma PAT không trả scope)'
      }
    }));
  }

  return tools.map(t => ({
    ...t,
    permission: t.permission || {
      status: 'unknown',
      reason: 'Không xác định được'
    }
  }));
}
export function connectorService(store, { mcpRequest = request, serviceRequest = request } = {}) {
  const locks = new Map();
  async function doRequest(url, options) {
    const r = await serviceRequest(url, options);
    if (r.status < 200 || r.status >= 300)
      throw new HubError(
        `Dịch vụ trả HTTP ${r.status}`,
        r.status === 401 ? 401 : r.status === 403 ? 403 : 502
      );
    if (r.json?.ok === false || r.json?.error) {
      const isMissingScope = r.json?.error === 'missing_scope';
      const errText = isMissingScope
        ? `Dịch vụ từ chối: thiếu scope ${r.json.needed || ''}`.trim()
        : 'Dịch vụ từ chối: ' +
          String(r.json.error?.message || r.json.error || r.json.description).slice(0, 300);
      throw new HubError(errText, isMissingScope ? 403 : 502);
    }
    return r;
  }
  async function credential(m) {
    let c = m.secret ? store.unseal(m.secret) : {};
    if (c.refresh_token && c.expires_at && c.expires_at < Date.now() + 60000) {
      if (locks.has(m.id)) return locks.get(m.id);
      const promise = (async () => {
        const config = provider(m.provider)?.oauth || c.oauth;
        if (!config) throw new HubError('Cần kết nối lại dịch vụ', 401);
        const payload = {
          grant_type: 'refresh_token',
          refresh_token: c.refresh_token,
          client_id: c.client_id,
          client_secret: c.client_secret
        };
        try {
          const result = await jsonRequest(config.token, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'application/json'
            },
            body: query(payload)
          });
          if (!result.access_token) throw new Error();
          c = { ...c, ...result, expires_at: Date.now() + (result.expires_in || 3600) * 1000 };
          const latest = store.get('mcp', m.id);
          if (!latest || latest.secret !== m.secret)
            throw new HubError('Kết nối đã thay đổi trong lúc làm mới token', 409);
          latest.secret = store.seal(c);
          store.put('mcp', m.id, latest);
          return c;
        } catch (e) {
          const latest = store.get('mcp', m.id);
          if (latest && latest.secret === m.secret) {
            latest.status = 'expired';
            store.put('mcp', m.id, latest);
          }
          throw new HubError('Phiên dịch vụ hết hạn; hãy kết nối lại', 401);
        }
      })();
      locks.set(m.id, promise);
      try {
        return await promise;
      } finally {
        locks.delete(m.id);
      }
    }
    return c;
  }
  async function call(m, name, a) {
    const c = await credential(m);
    const token = c.access_token || c.token;
    if (!token && m.auth !== 'none') throw new HubError('MCP chưa có credential', 401);
    let url,
      method = 'GET',
      body,
      headers = { Authorization: 'Bearer ' + token };
    if (m.provider === 'github') {
      const root = 'https://api.github.com',
        repo = root + '/repos/' + enc(a.owner) + '/' + enc(a.repo);
      headers.Accept = 'application/vnd.github+json';
      headers['X-GitHub-Api-Version'] = '2022-11-28';
      if (name === 'search_repositories')
        url = root + '/search/repositories?' + query({ q: a.query, per_page: a.per_page || 20 });
      if (name === 'get_file_contents')
        url =
          repo + '/contents/' + a.path.split('/').map(enc).join('/') + '?' + query({ ref: a.ref });
      if (name === 'list_issues')
        url =
          repo +
          '/issues?' +
          query({
            state: a.state || 'open',
            page: a.page || 1,
            per_page: a.per_page || 30,
            sort: a.sort || 'created',
            direction: a.direction || 'desc'
          });
      if (name === 'create_issue') {
        url = repo + '/issues';
        method = 'POST';
        body = { title: a.title, body: a.body };
      }
      if (name === 'create_pull_request') {
        url = repo + '/pulls';
        method = 'POST';
        body = { title: a.title, head: a.head, base: a.base, body: a.body };
      }
    }
    if (m.provider === 'drive') {
      const root = 'https://www.googleapis.com/drive/v3/files';
      if (name === 'list_files')
        url =
          root +
          '?' +
          query({
            q: a.query || 'trashed = false',
            pageSize: a.page_size || 30,
            pageToken: a.page_token,
            fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink)'
          });
      if (name === 'get_file')
        url =
          root + '/' + enc(a.file_id) + '?fields=id,name,mimeType,size,modifiedTime,webViewLink';
      if (name === 'read_file') url = root + '/' + enc(a.file_id) + '?alt=media';
      if (name === 'export_file') {
        if (!['text/plain', 'text/csv', undefined].includes(a.mime_type))
          throw new HubError('Chỉ hỗ trợ xuất văn bản hoặc CSV');
        url =
          root +
          '/' +
          enc(a.file_id) +
          '/export?' +
          query({ mimeType: a.mime_type || 'text/plain' });
      }
      if (name === 'create_file') {
        const boundary = 'genhub_boundary_' + Date.now();
        url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
        method = 'POST';
        headers['Content-Type'] = 'multipart/related; boundary=' + boundary;
        body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: a.name, mimeType: 'text/plain', ...(a.parent_id ? { parents: [a.parent_id] } : {}) })}\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${a.content}\r\n--${boundary}--`;
      }
    }
    if (m.provider === 'slack') {
      const root = 'https://slack.com/api/';
      if (name === 'list_channels')
        url = root + 'conversations.list?' + query({ limit: a.limit || 30, cursor: a.cursor });
      if (name === 'read_history')
        url =
          root +
          'conversations.history?' +
          query({ channel: a.channel, limit: a.limit || 30, cursor: a.cursor });
      if (name === 'post_message') {
        url = root + 'chat.postMessage';
        method = 'POST';
        body = a;
      }
    }
    if (m.provider === 'telegram') {
      headers = {};
      const root = 'https://api.telegram.org/bot' + token + '/';
      if (name === 'get_me') url = root + 'getMe';
      if (name === 'get_updates')
        url = root + 'getUpdates?' + query({ offset: a.offset, limit: a.limit || 30, timeout: 0 });
      if (name === 'send_message') {
        url = root + 'sendMessage';
        method = 'POST';
        body = a;
      }
    }
    if (m.provider === 'discord') {
      const root = 'https://discord.com/api/v10';
      headers.Authorization = 'Bot ' + token;
      if (name === 'get_me') url = root + '/users/@me';
      if (name === 'list_guilds') url = root + '/users/@me/guilds';
      if (name === 'get_channel_messages')
        url =
          root + '/channels/' + enc(a.channel_id) + '/messages?' + query({ limit: a.limit || 30 });
      if (name === 'create_message') {
        url = root + '/channels/' + enc(a.channel_id) + '/messages';
        method = 'POST';
        body = { content: a.content, allowed_mentions: { parse: [] } };
      }
    }
    if (m.provider === 'figma') {
      const root = 'https://api.figma.com/v1';
      headers = { 'X-Figma-Token': token };
      if (name === 'get_me') url = root + '/me';
      if (name === 'get_file') url = root + '/files/' + enc(a.file_key);
      if (name === 'get_comments') url = root + '/files/' + enc(a.file_key) + '/comments';
      if (name === 'post_comment') {
        url = root + '/files/' + enc(a.file_key) + '/comments';
        method = 'POST';
        body = { message: a.message };
      }
    }
    if (!url) throw new HubError('Tool không hỗ trợ');
    const r = await doRequest(url, { headers, method, body });
    return r.json ?? { text: r.text };
  }
  async function rpc(m, method, params = {}, session, notify = false) {
    const endpoint = m.provider === 'github-mcp' ? githubEndpoint(m) : m.url;
    const c = await credential(m);
    if (m.provider === 'github-mcp' && !c.token && !c.access_token)
      throw new HubError('MCP chưa có credential', 401);
    const headers = {
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-06-18',
      ...(c.token || c.access_token
        ? { Authorization: 'Bearer ' + (c.access_token || c.token) }
        : {}),
      ...(session ? { 'Mcp-Session-Id': session } : {})
    };
    const reqId = Date.now();
    const r = await mcpRequest(endpoint, {
      method: 'POST',
      headers,
      body: { jsonrpc: '2.0', ...(notify ? {} : { id: reqId }), method, params },
      allowPrivate: m.allowPrivate,
      responseId: notify ? undefined : reqId
    });
    if (r.status === 401) throw new HubError('MCP yêu cầu xác thực lại', 401);
    if (r.status < 200 || r.status >= 300)
      throw new HubError('MCP trả HTTP ' + r.status, r.status === 403 ? 403 : 502);
    if (notify) return {};
    let data = r.json;
    if (!data && r.headers['content-type']?.includes('text/event-stream')) {
      for (const event of r.text.split(/\r?\n\r?\n/)) {
        const line = event
          .split(/\r?\n/)
          .filter(l => l.startsWith('data:'))
          .map(l => l.slice(5).trim())
          .join('\n');
        if (line) {
          try {
            const x = JSON.parse(line);
            if (x.id === reqId) data = x;
          } catch {}
        }
      }
    }
    if (!data || data.id !== reqId) throw new HubError('MCP trả phản hồi không hợp lệ', 502);
    if (data.error)
      throw new HubError(String(data.error.message || 'MCP error').slice(0, 300), 502);
    return { result: data.result, session: r.headers['mcp-session-id'] || session };
  }
  async function withSession(m, fn) {
    const init = await rpc(m, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'gen-hub', version: '0.1.0' }
    });
    const session = init.session;
    await rpc(m, 'notifications/initialized', {}, session, true);
    try {
      return await fn(session);
    } finally {
      if (session) {
        const c = await credential(m);
        await mcpRequest(m.provider === 'github-mcp' ? githubEndpoint(m) : m.url, {
          method: 'DELETE',
          headers: {
            'Mcp-Session-Id': session,
            'MCP-Protocol-Version': '2025-06-18',
            ...(c.token || c.access_token
              ? { Authorization: 'Bearer ' + (c.access_token || c.token) }
              : {})
          },
          allowPrivate: m.allowPrivate,
          timeout: 5000
        }).catch(() => {});
      }
    }
  }
  async function sync(m) {
    if (!isMcp(m)) {
      const p = provider(m.provider);
      const c = await credential(m);
      const token = c.access_token || c.token;
      if (!token && m.auth !== 'none') throw new HubError('MCP chưa có credential', 401);
      let probeUrl,
        probeHeaders = { Authorization: 'Bearer ' + token };
      if (m.provider === 'github') {
        probeUrl = 'https://api.github.com/user';
        probeHeaders.Accept = 'application/vnd.github+json';
        probeHeaders['X-GitHub-Api-Version'] = '2022-11-28';
      } else if (m.provider === 'drive') {
        probeUrl = 'https://www.googleapis.com/drive/v3/files?pageSize=1';
      } else if (m.provider === 'slack') {
        probeUrl = 'https://slack.com/api/auth.test';
      } else if (m.provider === 'telegram') {
        probeUrl = 'https://api.telegram.org/bot' + token + '/getMe';
        probeHeaders = {};
      } else if (m.provider === 'discord') {
        probeUrl = 'https://discord.com/api/v10/users/@me';
        probeHeaders.Authorization = 'Bot ' + token;
      } else if (m.provider === 'figma') {
        probeUrl = 'https://api.figma.com/v1/me';
        probeHeaders = { 'X-Figma-Token': token };
      } else if (m.provider === 'gitea-mcp') {
        probeUrl = `${giteaBaseUrl(m.url)}/user`;
        probeHeaders = {
          Accept: 'application/json',
          Authorization: 'token ' + token
        };
      }
      let responseHeaders = {};
      if (probeUrl) {
        try {
          const r = await doRequest(probeUrl, {
            headers: probeHeaders,
            method: 'GET',
            allowPrivate: m.provider === 'gitea-mcp' ? (isDefaultGiteaUrl(m.url) ? true : !!m.allowPrivate) : m.allowPrivate
          });
          responseHeaders = r.headers || {};
        } catch (err) {
          if (m.provider === 'github' && err.status === 403) {
            const r = await doRequest(
              'https://api.github.com/search/repositories?q=repo:octocat/Hello-World',
              { headers: probeHeaders, method: 'GET' }
            );
            responseHeaders = r.headers || {};
          } else {
            throw err;
          }
        }
      }
      return checkToolPermissions(m, p.tools, { headers: responseHeaders, credential: c });
    }
    return withSession(m, async session => {
      const result = [];
      let cursor;
      for (let i = 0; i < 500; i++) {
        const r = await rpc(m, 'tools/list', cursor ? { cursor } : {}, session);
        if (!Array.isArray(r.result?.tools)) throw new HubError('MCP thiếu danh sách tools', 502);
        result.push(...r.result.tools);
        cursor = r.result.nextCursor;
        if (!cursor) {
          const list = m.provider === 'github-mcp' ? githubTools(result) : result;
          const c = await credential(m);
          return checkToolPermissions(m, list, { credential: c });
        }
        if (result.length > 10000) break;
      }
      throw new HubError('Danh sách tool vượt giới hạn đồng bộ', 502);
    });
  }
  return {
    credential,
    sync,
    call: async (m, t, a) => {
      if (isMcp(m)) {
        if (m.provider === 'github-mcp') {
          const c = await credential(m);
          const token = c.access_token || c.token;
          const res = await githubCall(t, a, { token, request: doRequest });
          if (res?.content) return res;
          return withSession(
            m,
            async session => (await rpc(m, 'tools/call', res, session)).result
          );
        }
        return withSession(
          m,
          async session => (await rpc(m, 'tools/call', { name: t, arguments: a }, session)).result
        );
      }
      if (m.provider === 'gitea-mcp') {
        const c = await credential(m);
        const token = c.access_token || c.token;
        return await giteaCall(t, a, { url: m.url, token, allowPrivate: m.allowPrivate, request: doRequest });
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(await call(m, t, a)) }],
        isError: false
      };
    }
  };
}
