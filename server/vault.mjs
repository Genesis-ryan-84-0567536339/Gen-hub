import { id } from './store.mjs';
import { HubError } from './net.mjs';

export const vaultGrant = sid => 'vault:' + sid;
export const vaultTool = sid => 'vault__' + sid;
export function vaultService(store) {
  const metadata = ({ id, name, notes, created, updated }) => ({
    id,
    name,
    notes: typeof notes === 'string' ? notes : '',
    created,
    updated
  });
  const list = () => store.list('vault').map(metadata);
  const get = sid => {
    const record = store.get('vault', sid);
    if (!record) throw new HubError('Không tìm thấy secret', 404);
    return record;
  };
  const canRead = (agent, sid) =>
    agent?.status === 'active' &&
    !!store.get('vault', sid) &&
    agent.permissions.includes(vaultGrant(sid));
  const name = value => {
    if (typeof value !== 'string' || !value.trim() || value.length > 80)
      throw new HubError('Tên secret cần 1–80 ký tự');
    return value.trim();
  };
  const optionalNotes = (value, max = 2000) => {
    if (value === undefined) return '';
    if (typeof value !== 'string' || value.length > max)
      throw new HubError(`Ghi chú cần là chuỗi tối đa ${max} ký tự`);
    return value.trim();
  };
  const seal = value => {
    if (typeof value !== 'string' || !value.length || Buffer.byteLength(value) > 65536)
      throw new HubError('Giá trị secret cần 1–65536 byte');
    return store.seal({ secret: value });
  };
  function share(sid, b, actor) {
    get(sid);
    if (!['private', 'selected', 'all-active'].includes(b.sharing))
      throw new HubError('Chọn chế độ chia sẻ hợp lệ');
    const agents = store.list('agent');
    let selected = [];
    if (b.sharing === 'selected') {
      if (
        !Array.isArray(b.agents) ||
        b.agents.length > 2000 ||
        b.agents.some(
          aid => typeof aid !== 'string' || !agents.some(a => a.id === aid && a.status === 'active')
        )
      )
        throw new HubError('Chỉ chọn agent đang hoạt động');
      selected = [...new Set(b.agents)];
    } else if (b.sharing === 'all-active') {
      selected = agents.filter(a => a.status === 'active').map(a => a.id);
    }
    const permission = vaultGrant(sid);
    for (const agent of agents) {
      const permissions = agent.permissions.filter(p => p !== permission);
      if (selected.includes(agent.id)) permissions.push(permission);
      if (permissions.length > 2000) throw new HubError('Agent vượt giới hạn 2000 quyền');
      store.put('agent', agent.id, { ...agent, permissions });
    }
    store.audit(
      actor,
      'vault',
      b.sharing === 'all-active' ? 'vault.share_all' : 'vault.share',
      'success',
      { id: sid, sharing: b.sharing, agents: selected },
      {}
    );
    return { id: sid, agents: selected };
  }
  function create(b, actor) {
    return store.tx(() => {
      const now = new Date().toISOString();
      const record = {
        id: id('vault'),
        name: name(b.name),
        notes: optionalNotes(b.notes),
        secret: seal(b.secret),
        created: now,
        updated: now
      };
      store.put('vault', record.id, record);
      share(record.id, { ...b, sharing: b.sharing ?? 'private' }, actor);
      store.audit(actor, 'vault', 'vault.create', 'success', { id: record.id }, {});
      return metadata(record);
    });
  }
  function update(sid, b, actor) {
    const record = get(sid);
    if (b.name !== undefined) record.name = name(b.name);
    if (b.notes !== undefined) record.notes = optionalNotes(b.notes);
    if (b.secret !== undefined) record.secret = seal(b.secret);
    record.updated = new Date().toISOString();
    store.put('vault', sid, record);
    store.audit(
      actor,
      'vault',
      'vault.update',
      'success',
      { id: sid, replaced: b.secret !== undefined },
      {}
    );
    return metadata(record);
  }
  function read(sid, actor) {
    try {
      const record = get(sid);
      const value = store.unseal(record.secret).secret;
      // Never put the value in audit, including before generic redaction.
      store.audit(actor, 'vault', 'vault.read', 'success', { id: sid }, {});
      return { id: sid, secret: value };
    } catch (e) {
      store.audit(actor, 'vault', 'vault.read', 'error', { id: sid }, {});
      throw e;
    }
  }
  function remove(sid, actor) {
    return store.tx(() => {
      get(sid);
      for (const agent of store.list('agent')) {
        agent.permissions = agent.permissions.filter(p => p !== vaultGrant(sid));
        store.put('agent', agent.id, agent);
      }
      store.del('vault', sid);
      store.audit(actor, 'vault', 'vault.remove', 'success', { id: sid }, {});
      return { ok: true };
    });
  }
  const tools = agent =>
    list()
      .filter(s => canRead(agent, s.id))
      .map(s => ({
        name: vaultTool(s.id),
        description: 'Đọc secret được owner cấp: ' + s.name,
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
      }));
  return {
    list,
    canRead,
    create,
    update,
    read,
    remove,
    tools,
    share: (sid, b, actor) => store.tx(() => share(sid, b, actor))
  };
}
