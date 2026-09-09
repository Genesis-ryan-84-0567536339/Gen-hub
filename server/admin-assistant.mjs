import { timingSafeEqual } from 'node:crypto';
import { id, digest, passwordCheck, redact } from './store.mjs';
import { HubError, assertSchema } from './net.mjs';

const string = { type: 'string' };
const strings = { type: 'array', items: string };
const tool = (
  name,
  description,
  method,
  path,
  properties = {},
  required = [],
  readOnly = false
) => ({
  name,
  description,
  method,
  path,
  inputSchema: { type: 'object', properties, required, additionalProperties: false },
  annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: true }
});
const routes = [
  tool(
    'hub_state',
    'Xem connector, agent, cài đặt và nhật ký gần đây.',
    'GET',
    () => 'state',
    {},
    [],
    true
  ),
  tool(
    'connector_add',
    'Thêm connector tích hợp hoặc MCP HTTP.',
    'POST',
    () => 'mcps',
    {
      provider: string,
      name: string,
      url: string,
      auth: string,
      allowPrivate: { type: 'boolean' }
    },
    ['provider']
  ),
  tool(
    'connector_update',
    'Đổi tên, bật/tắt hoặc công bố tool của connector.',
    'PATCH',
    a => 'mcps/' + a.id,
    { id: string, name: string, on: { type: 'boolean' }, published: strings },
    ['id']
  ),
  tool(
    'connector_remove',
    'Gỡ connector và quyền liên quan; giữ audit.',
    'DELETE',
    a => 'mcps/' + a.id,
    { id: string },
    ['id']
  ),
  tool(
    'connector_set_token',
    'Lưu token dịch vụ và kiểm tra kết nối. OAuth dịch vụ cần owner hoàn tất trong trình duyệt.',
    'POST',
    a => 'mcps/' + a.id + '/credential',
    { id: string, token: string },
    ['id', 'token']
  ),
  tool(
    'connector_sync',
    'Kết nối và đồng bộ danh sách tool.',
    'POST',
    a => 'mcps/' + a.id + '/sync',
    { id: string },
    ['id']
  ),
  tool(
    'connector_disconnect',
    'Ngắt kết nối và xóa credential dịch vụ.',
    'POST',
    a => 'mcps/' + a.id + '/disconnect',
    { id: string },
    ['id']
  ),
  tool(
    'agent_create',
    'Tạo agent thường với token riêng và quyền được chỉ định.',
    'POST',
    () => 'agents',
    { name: string, permissions: strings },
    ['name']
  ),
  tool(
    'agent_update',
    'Đặt tên, cấp quyền hoặc thu hồi agent thường.',
    'PATCH',
    a => 'agents/' + a.id,
    { id: string, name: string, permissions: strings, status: string },
    ['id']
  ),
  tool(
    'agent_remove',
    'Xóa agent đã thu hồi; giữ audit.',
    'DELETE',
    a => 'agents/' + a.id,
    { id: string },
    ['id']
  ),
  tool(
    'agent_request',
    'Xem yêu cầu OAuth theo mã trong link duyệt.',
    'GET',
    a => 'flows/' + a.id,
    { id: string },
    ['id'],
    true
  ),
  tool(
    'agent_decide',
    'Duyệt hoặc từ chối yêu cầu OAuth; trả link callback cho client.',
    'POST',
    a => 'flows/' + a.id,
    { id: string, name: string, permissions: strings, approve: { type: 'boolean' } },
    ['id', 'approve']
  ),
  tool(
    'audit_list',
    'Đọc tối đa 5000 bản ghi audit đã che credential.',
    'GET',
    () => 'logs',
    {},
    [],
    true
  ),
  tool(
    'settings_update',
    'Đổi tên Hub, thời gian giữ log hoặc trạng thái hướng dẫn.',
    'PATCH',
    () => 'settings',
    { name: string, retention: { type: 'integer' }, onboarded: { type: 'boolean' } }
  ),
  tool(
    'policy_check',
    'Kiểm tra quyền của agent đối với tool.',
    'POST',
    () => 'test',
    { agent: string, mcp: string, tool: string },
    ['agent', 'mcp', 'tool'],
    true
  ),
  tool(
    'owner_password_change',
    'Đổi mật khẩu như web UI: phải cung cấp mật khẩu hiện tại. Thu hồi mọi session web.',
    'POST',
    () => 'password',
    { current: string, password: string },
    ['current', 'password']
  )
];
const versions = ['2025-03-26', '2025-06-18', '2025-11-25'];

export function adminAssistant(store, origin, execute) {
  const kind = 'admin-assistant';
  function status() {
    const record = store.get(kind, 'main');
    return {
      endpoint: origin + '/mcp/admin',
      active: !!record?.hash,
      id: record?.id || null,
      created: record?.created || null,
      lastUsed: record?.lastUsed || null
    };
  }
  function create(password) {
    if (
      typeof password !== 'string' ||
      password.length > 1024 ||
      !passwordCheck(password, store.get('owner', 'main')?.password || '')
    )
      throw new HubError('Mật khẩu owner không đúng', 403);
    return store.tx(() => {
      if (store.get(kind, 'main')?.hash)
        throw new HubError('Thu hồi token hiện tại trước khi tạo token mới', 409);
      const token = 'gh_admin_' + id() + id();
      const record = {
        id: id(),
        hash: digest(token),
        created: new Date().toISOString(),
        lastUsed: null
      };
      store.put(kind, 'main', record);
      store.audit('owner', 'hub', 'admin_assistant.create', 'success', {}, { id: record.id });
      return { ...status(), token };
    });
  }
  function revoke() {
    const record = store.get(kind, 'main');
    if (record?.hash) {
      delete record.hash;
      store.put(kind, 'main', record);
      store.audit(
        'owner',
        'hub',
        'admin_assistant.revoke',
        'success',
        { id: record.id },
        { revoked: true }
      );
    }
    return status();
  }
  function authenticate(req) {
    const raw = req.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
    const record = store.get(kind, 'main');
    if (
      !raw ||
      raw.length > 256 ||
      !record?.hash ||
      !timingSafeEqual(Buffer.from(digest(raw)), Buffer.from(record.hash))
    )
      throw new HubError('Token trợ lý quản trị không hợp lệ hoặc đã thu hồi', 401);
    record.lastUsed = new Date().toISOString();
    store.put(kind, 'main', record);
    return 'admin-assistant:' + record.id;
  }
  let running = 0;
  async function rpc(req, b, actor) {
    const reply = (status, data, headers) => ({ status, data, headers });
    const error = (code, message, status = 200) =>
      reply(status, { jsonrpc: '2.0', id: b?.id ?? null, error: { code, message } });
    if (req.method !== 'POST') return reply(405, { error: 'Sử dụng POST' }, { Allow: 'POST' });
    if (!b || b.jsonrpc !== '2.0' || Array.isArray(b) || typeof b.method !== 'string')
      return error(-32600, 'Invalid Request', 400);
    const version = req.headers['mcp-protocol-version'];
    if (version && !versions.includes(version))
      return error(-32600, 'Unsupported protocol version', 400);
    if (b.id === undefined) return reply(202);
    const result = value => reply(200, { jsonrpc: '2.0', id: b.id, result: value });
    if (b.method === 'initialize')
      return result({
        protocolVersion: versions.includes(b.params?.protocolVersion)
          ? b.params.protocolVersion
          : '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'gen-hub-admin', version: '0.1.0' },
        instructions:
          'Trợ lý quản trị được owner cấp quyền riêng. Chỉ dùng các thao tác console đã liệt kê; không có shell, mã nguồn hoặc deploy.'
      });
    if (b.method === 'ping') return result({});
    if (b.method === 'tools/list')
      return result({ tools: routes.map(({ method, path, ...definition }) => definition) });
    if (b.method !== 'tools/call') return error(-32601, 'Method not found');
    const definition = routes.find(t => t.name === b.params?.name);
    if (!definition) {
      store.audit(
        actor,
        'hub',
        'admin.unknown_tool',
        'denied',
        { name: b.params?.name },
        { error: 'Unknown tool' }
      );
      return error(-32602, 'Unknown admin tool');
    }
    const args = b.params.arguments ?? {},
      started = performance.now();
    let entered = false;
    try {
      assertSchema(definition.inputSchema, args);
      if (args.id !== undefined && !/^[A-Za-z0-9_-]{1,100}$/.test(args.id))
        throw new HubError('ID không hợp lệ');
      if (running >= 20) throw new HubError('Quá nhiều thao tác đang chạy', 429);
      running++;
      entered = true;
      const { id: target, ...body } = args;
      const response = await execute({
        method: definition.method,
        path: definition.path(args),
        b: body,
        actor
      });
      const output = response.data ?? {};
      // Reading audit must not recursively store entire earlier audit payloads.
      const auditOutput =
        definition.name === 'audit_list'
          ? { count: output.length, ids: output.map(l => l.id) }
          : definition.name === 'hub_state'
            ? { ...output, logs: { count: output.logs.length } }
            : output;
      store.audit(
        actor,
        'hub',
        'admin.' + definition.name,
        'success',
        redact(
          definition.name === 'owner_password_change' ? { ...args, current: '[REDACTED]' } : args
        ),
        redact(auditOutput),
        performance.now() - started
      );
      return result({ content: [{ type: 'text', text: JSON.stringify(output) }], isError: false });
    } catch (e) {
      const message = e instanceof HubError ? e.message : 'Không thể hoàn tất thao tác quản trị';
      store.audit(
        actor,
        'hub',
        'admin.' + definition.name,
        e.status === 403 ? 'denied' : 'error',
        redact(
          definition.name === 'owner_password_change' ? { ...args, current: '[REDACTED]' } : args
        ),
        { error: message },
        performance.now() - started
      );
      return result({ content: [{ type: 'text', text: message }], isError: true });
    } finally {
      if (entered) running--;
    }
  }
  return { status, create, revoke, authenticate, rpc };
}
