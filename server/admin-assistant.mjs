import { classifyError } from './audit-metrics.mjs';
import { timingSafeEqual } from 'node:crypto';
import { id, secret, digest, passwordCheck, redact } from './store.mjs';
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
    'Gỡ connector và quyền liên quan; cần PIN owner, giữ audit.',
    'DELETE',
    a => 'mcps/' + a.id,
    { id: string, pin: string },
    ['id', 'pin']
  ),
  tool(
    'connector_set_token',
    'Lưu token dịch vụ và kiểm tra kết nối. OAuth dịch vụ cần owner hoàn tất trong trình duyệt.',
    'POST',
    a => 'mcps/' + a.id + '/credential',
    { id: string, token: string, url: string },
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
    'Ngắt kết nối và xóa credential dịch vụ; cần PIN owner.',
    'POST',
    a => 'mcps/' + a.id + '/disconnect',
    { id: string, pin: string },
    ['id', 'pin']
  ),
  tool(
    'agent_create',
    'Tạo agent thường với token riêng và quyền được chỉ định.',
    'POST',
    () => 'agents',
    { name: string, description: string, instructions: string, permissions: strings },
    ['name']
  ),
  tool(
    'agent_update',
    'Đặt tên, cấp quyền hoặc thu hồi agent thường.',
    'PATCH',
    a => 'agents/' + a.id,
    {
      id: string,
      name: string,
      description: string,
      instructions: string,
      permissions: strings,
      status: string
    },
    ['id']
  ),
  tool(
    'agent_remove',
    'Xóa agent đã thu hồi; cần PIN owner, giữ audit.',
    'DELETE',
    a => 'agents/' + a.id,
    { id: string, pin: string },
    ['id', 'pin']
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
    'Đọc tối đa 5000 bản ghi audit đã che credential; lọc actor, mcp, secret (lượt đọc), tool và since trước giới hạn.',
    'GET',
    () => 'logs',
    {
      actor: string,
      mcp: string,
      secret: string,
      tool: string,
      since: string,
      limit: { type: 'integer', minimum: 1, maximum: 5000 }
    },
    [],
    true
  ),
  tool(
    'settings_update',
    'Đổi tên Hub, thời gian giữ log, trạng thái hướng dẫn hoặc repo Brain đang xem ở trang Skills.',
    'PATCH',
    () => 'settings',
    { name: string, retention: { type: 'integer' }, onboarded: { type: 'boolean' }, brainRepo: string }
  ),
  tool(
    'skills_tree',
    'Xem cây category/skill từ skills/index.yaml của repo Brain đã cấu hình (hoặc repo truyền vào).',
    'GET',
    () => 'skills',
    { repo: string },
    [],
    true
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
    'vault_list',
    'Liệt kê metadata secret; không trả giá trị.',
    'GET',
    () => 'vault',
    {},
    [],
    true
  ),
  tool(
    'vault_create',
    'Tạo secret; mặc định riêng tư. sharing: private, selected hoặc all-active (chỉ agent hiện có).',
    'POST',
    () => 'vault',
    { name: string, notes: string, secret: string, sharing: string, agents: strings },
    ['name', 'secret']
  ),
  tool(
    'vault_update',
    'Đổi tên hoặc thay giá trị secret; không hiển thị lại giá trị.',
    'PATCH',
    a => 'vault/' + a.id,
    { id: string, name: string, notes: string, secret: string },
    ['id']
  ),
  tool(
    'vault_read',
    'Đọc rõ ràng một secret theo ID; mỗi lượt đều ghi audit không chứa giá trị.',
    'POST',
    a => 'vault/' + a.id + '/read',
    { id: string },
    ['id'],
    true
  ),
  tool(
    'vault_share',
    'Thay danh sách agent đọc secret: private, selected hoặc all-active. Không tự cấp cho agent tương lai.',
    'POST',
    a => 'vault/' + a.id + '/grants',
    { id: string, sharing: string, agents: strings },
    ['id', 'sharing']
  ),
  tool(
    'vault_remove',
    'Xóa secret và grant liên quan; cần PIN owner, giữ audit.',
    'DELETE',
    a => 'vault/' + a.id,
    { id: string, pin: string },
    ['id', 'pin']
  ),
  tool(
    'bootstrap_get',
    'Xem nội dung Bootstrap (nhóm/bước) hiện tại được gộp gửi cho agent lúc kết nối.',
    'GET',
    () => 'bootstrap',
    {},
    [],
    true
  ),
  tool(
    'bootstrap_update',
    'Thay toàn bộ nhóm/bước Bootstrap (mảng groups, mỗi group có title + steps[{title, content}]).',
    'PATCH',
    () => 'bootstrap',
    { groups: { type: 'array' } },
    ['groups']
  ),
  tool(
    'bootstrap_create_brain',
    'Tạo repository Brain mới (private, seed tối thiểu) qua connector GitHub đã kết nối; tuỳ chọn, không bắt buộc.',
    'POST',
    () => 'bootstrap/create-brain',
    { name: string, org: string, description: string },
    []
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
    const adminAgents = store.list('agent').filter(a => a.isAdmin && a.status === 'active');
    return {
      endpoint: origin + '/mcp/admin',
      active: !!record?.hash || adminAgents.length > 0,
      id: record?.id || adminAgents[0]?.id || null,
      created: record?.created || adminAgents[0]?.created || null,
      lastUsed: record?.lastUsed || adminAgents[0]?.last || null,
      adminCount: adminAgents.length
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
      const token = 'gh_admin_' + secret() + secret();
      const record = {
        id: id('admin'),
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
        { revoked: true },
        undefined,
        '',
        {
          eventKind: 'auth',
          actorType: 'owner'
        }
      );
    }
    return status();
  }
  function authenticate(req) {
    const raw = req.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
    if (!raw || raw.length > 256)
      throw new HubError('Token trợ lý quản trị không hợp lệ hoặc đã thu hồi', 401);

    const key = digest(raw);

    // 1. Check OAuth access token for an active agent with isAdmin === true
    const tokenRecord = store.get('token', key);
    if (tokenRecord) {
      if (tokenRecord.type !== 'access' || tokenRecord.expires < Date.now())
        throw new HubError('Token trợ lý quản trị đã hết hạn hoặc không hợp lệ', 401);
      const agent = store.get('agent', tokenRecord.agent);
      if (!agent || agent.status !== 'active')
        throw new HubError('Agent đã bị thu hồi hoặc không hoạt động', 401);
      if (agent.isAdmin !== true)
        throw new HubError('Token trợ lý quản trị không hợp lệ hoặc đã thu hồi', 401);
      agent.last = new Date().toISOString();
      store.put('agent', agent.id, agent);
      return 'admin-assistant:' + agent.id;
    }

    // 2. Check legacy static admin token
    const record = store.get(kind, 'main');
    if (record?.hash && timingSafeEqual(Buffer.from(key), Buffer.from(record.hash))) {
      record.lastUsed = new Date().toISOString();
      store.put(kind, 'main', record);
      return 'admin-assistant:' + record.id;
    }

    throw new HubError('Token trợ lý quản trị không hợp lệ hoặc đã thu hồi', 401);
  }
  let running = 0;
  const rpc = (req, b, actor) => store.operation(() => rpcOperation(req, b, actor));
  async function rpcOperation(req, b, actor) {
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
      const auditRows = Array.isArray(output) ? output : output.rows || [];
      const auditOutput =
        definition.name === 'audit_list'
          ? { count: auditRows.length, ids: auditRows.map(l => l.id) }
          : definition.name === 'hub_state'
            ? {
                ...output,
                logs: {
                  count: (Array.isArray(output.logs) ? output.logs : output.logs?.rows || []).length
                }
              }
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
        performance.now() - started,
        '',
        { policyDecision: 'allow' }
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
        performance.now() - started,
        '',
        {
          policyDecision: e.status === 403 ? 'deny' : 'allow',
          errorCategory: e.status === 403 ? 'denied' : classifyError(e)
        }
      );
      return result({ content: [{ type: 'text', text: message }], isError: true });
    } finally {
      if (entered) running--;
    }
  }
  return { status, create, revoke, authenticate, rpc };
}
