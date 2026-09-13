import { canCallTool } from './tool-access.mjs';
import { randomUUID } from 'node:crypto';
import { auditFields } from './audit-metrics.mjs';
import { normalizeSettings } from '../public/settings.js';
import { HubError } from './net.mjs';

const toolCalls = `${auditFields.eventKind}='tool_call' AND ${auditFields.actorType}='agent'`;
const key = (a, b) => JSON.stringify([a, b]);
const zero = () => ({ calls: 0, inputBytes: 0, outputBytes: 0, bytesMissing: 0, lastCall: null });
const sum = `COUNT(*) AS calls, COALESCE(SUM(inputBytes),0) AS inputBytes,
 COALESCE(SUM(outputBytes),0) AS outputBytes,
 SUM(CASE WHEN inputBytes IS NULL OR outputBytes IS NULL THEN 1 ELSE 0 END) AS bytesMissing,
 MAX(created) AS lastCall`;

export function createMonitor(store) {
  // Only request metadata is persisted here. Credentials and content stay out of this registry.
  // A process restart cannot establish the result of an upstream side effect.
  for (const op of store.list('monitor-operation')) {
    if (op.startedAt < new Date(Date.now() - 86400000).toISOString()) {
      store.del('monitor-operation', op.id);
    } else if (op.state === 'running') {
      store.put('monitor-operation', op.id, { ...op, state: 'interrupted' });
    }
  }
  function begin({ actor, mcp, tool }) {
    const id = store.currentOperationId() || randomUUID();
    const now = new Date().toISOString();
    const op = {
      id,
      actor,
      mcp,
      tool,
      startedAt: now,
      updatedAt: now,
      state: 'running',
      phase: 'received',
      timeline: [{ phase: 'received', at: now }]
    };
    store.put('monitor-operation', id, op);
    return {
      phase(phase) {
        const now = new Date().toISOString();
        op.phase = phase;
        op.updatedAt = now;
        op.timeline.push({ phase, at: now });
        store.put('monitor-operation', id, op);
      },
      audit(...args) {
        this.phase('audit');
        args[8] = { ...args[8], operationId: id, timeline: op.timeline };
        const result = store.audit(...args);
        store.del('monitor-operation', id);
        return result;
      },
      close() {
        if (store.get('monitor-operation', id)) {
          store.put('monitor-operation', id, { ...op, state: 'interrupted' });
        }
      }
    };
  }
  function active() {
    const cutoff = new Date(Date.now() - 86400000).toISOString();
    const rows = store.list('monitor-operation');
    for (const op of rows)
      if (op.state !== 'running' && op.startedAt < cutoff) store.del('monitor-operation', op.id);
    return rows
      .filter(op => op.state === 'running' || op.startedAt >= cutoff)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  function snapshot({ period = '12', actor = '', mcp = '' } = {}) {
    if (!['today', '12', '24', '168'].includes(String(period)))
      throw new HubError('Khoảng thời gian Monitor không hợp lệ');
    const now = Date.now(),
      until = new Date(now).toISOString();
    const since = new Date(
      period === 'today'
        ? Math.floor((now + 7 * 3600000) / 86400000) * 86400000 - 7 * 3600000
        : now - Number(period) * 3600000
    ).toISOString();
    for (const value of [actor, mcp])
      if (typeof value !== 'string' || value.length > 128)
        throw new HubError('Bộ lọc Monitor không hợp lệ');
    const params = [since, until];
    let where = `${toolCalls} AND created>=? AND created<=?`;
    if (actor) {
      where += ' AND actor=?';
      params.push(actor);
    }
    if (mcp) {
      where += ' AND mcp=?';
      params.push(mcp);
    }
    const grouped = store.db
      .prepare(`SELECT actor,mcp,tool,${sum} FROM audit WHERE ${where} GROUP BY actor,mcp,tool`)
      .all(...params);
    const retained = store.db
      .prepare(
        `SELECT mcp,tool,COUNT(*) AS calls,MAX(created) AS lastCall FROM audit WHERE ${toolCalls} GROUP BY mcp,tool`
      )
      .all();
    const retainedMap = new Map(retained.map(r => [key(r.mcp, r.tool), r]));
    const agents = store
      .list('agent')
      .map(a => ({
        id: a.id,
        name: a.name,
        status: a.status,
        permissions: a.permissions || [],
        isAdmin: !!a.isAdmin,
        ...zero()
      }));
    const mcps = store.list('mcp');
    const connections = mcps.map(m => ({
      id: m.id,
      name: m.name,
      on: !!m.on,
      status: m.status,
      toolCount: m.tools.length,
      published: m.tools.filter(t => t.published).length,
      ...zero()
    }));
    const tools = mcps.flatMap(m =>
      m.tools.map(t => {
        const usage = retainedMap.get(key(m.id, t.name));
        return {
          mcpId: m.id,
          mcpName: m.name,
          name: t.name,
          published: !!t.published,
          connectionReady: !!m.on && m.status === 'connected',
          available: !!m.on && m.status === 'connected' && !!t.published,
          callableBy: agents.filter(a => canCallTool(a, m, t)).map(a => a.id),
          grantedTo: agents.filter(a => a.permissions.includes(m.id + ':' + t.name)).map(a => a.id),
          retainedCalls: usage?.calls || 0,
          retainedLastCall: usage?.lastCall || null,
          ...zero()
        };
      })
    );
    const byAgent = new Map(agents.map(a => [a.id, a]));
    const byMcp = new Map(connections.map(m => [m.id, m]));
    const byTool = new Map(tools.map(t => [key(t.mcpId, t.name), t]));
    const relationships = new Map(),
      totals = zero();
    function add(target, r) {
      for (const field of ['calls', 'inputBytes', 'outputBytes', 'bytesMissing'])
        target[field] += r[field] || 0;
      if (r.lastCall && (!target.lastCall || r.lastCall > target.lastCall))
        target.lastCall = r.lastCall;
    }
    for (const r of grouped) {
      // Keep deleted resources visible in historical activity without inventing current resources.
      if (!byAgent.has(r.actor))
        byAgent.set(r.actor, {
          id: r.actor,
          name: r.actor,
          status: 'deleted',
          permissions: [],
          ...zero()
        });
      if (!byMcp.has(r.mcp))
        byMcp.set(r.mcp, {
          id: r.mcp,
          name: r.mcp === 'vault' ? 'Kho bí mật' : r.mcp,
          status: 'historical',
          ...zero()
        });
      add(totals, r);
      add(byAgent.get(r.actor), r);
      add(byMcp.get(r.mcp), r);
      if (byTool.has(key(r.mcp, r.tool))) add(byTool.get(key(r.mcp, r.tool)), r);
      const id = key(r.actor, r.mcp);
      if (!relationships.has(id))
        relationships.set(id, { agentId: r.actor, mcpId: r.mcp, granted: 0, ...zero() });
      add(relationships.get(id), r);
    }
    for (const tool of tools)
      for (const agentId of tool.grantedTo) {
        const id = key(agentId, tool.mcpId);
        if (!relationships.has(id))
          relationships.set(id, { agentId, mcpId: tool.mcpId, granted: 0, ...zero() });
        const relation = relationships.get(id);
        relation.granted++;
        relation.callable = (relation.callable || 0) + Number(tool.callableBy.includes(agentId));
      }
    const secrets = store
      .list('vault')
      .map(s => ({
        id: s.id,
        name: s.name,
        readers: agents.filter(a => a.permissions.includes('vault:' + s.id)).map(a => a.id)
      }));
    const recent = store.logs(30, {
      since,
      until,
      ...(actor ? { actor } : {}),
      ...(mcp ? { mcp } : {}),
      eventKind: 'tool_call',
      actorType: 'agent',
      includePayload: false
    });
    const current = active();
    const settings = normalizeSettings(store.get('settings', 'main'));
    const earliest = store.db.prepare('SELECT MIN(created) AS at FROM audit').get().at;
    return {
      fetchedAt: until,
      since,
      until,
      period: String(period),
      totals: {
        ...totals,
        agents: agents.length,
        connections: connections.length,
        tools: tools.length,
        published: tools.filter(t => t.published).length,
        available: tools.filter(t => t.available).length,
        secrets: secrets.length,
        running: current.filter(o => o.state === 'running').length
      },
      agents: [...byAgent.values()].map(({ permissions, ...a }) => ({
        ...a,
        granted: permissions.length
      })),
      connections: [...byMcp.values()],
      tools: tools.sort(
        (a, b) =>
          a.retainedCalls - b.retainedCalls ||
          a.mcpId.localeCompare(b.mcpId) ||
          a.name.localeCompare(b.name)
      ),
      relationships: [...relationships.values()],
      secrets,
      recent: Array.from(recent),
      active: current,
      toolActivity: grouped.map(r => ({ ...r })),
      coverage: {
        earliest,
        retentionDays: settings.effectiveRetentionDays,
        incomplete:
          since < new Date(now - settings.effectiveRetentionDays * 86400000).toISOString(),
        coverageStartUnknown: true,
        bytesMissing: totals.bytesMissing
      }
    };
  }
  function chatContext(selection = {}) {
    if (!selection || typeof selection !== 'object' || Array.isArray(selection))
      throw new HubError('Ngữ cảnh Monitor không hợp lệ');
    for (const field of ['actor', 'mcp', 'operationId']) {
      if (
        selection[field] !== undefined &&
        (typeof selection[field] !== 'string' || selection[field].length > 128)
      )
        throw new HubError('Ngữ cảnh Monitor không hợp lệ');
    }
    if (
      selection.logId !== undefined &&
      (!Number.isSafeInteger(Number(selection.logId)) || Number(selection.logId) < 1)
    )
      throw new HubError('ID nhật ký không hợp lệ');
    const data = snapshot({
      period: selection.period || '12',
      actor: selection.actor || '',
      mcp: selection.mcp || ''
    });
    const selected = selection.logId
      ? store.log(Number(selection.logId))
      : selection.operationId
        ? data.active.find(o => o.id === selection.operationId)
        : null;
    // No input/output, vault values, notes, schemas or credentials are sent to the LLM.
    const request = r =>
      r
        ? Object.fromEntries(
            [
              'id',
              'operationId',
              'actor',
              'mcp',
              'tool',
              'status',
              'state',
              'phase',
              'policyDecision',
              'errorCategory',
              'reason',
              'timeline'
            ]
              .filter(k => r[k] !== undefined)
              .map(k => [k, r[k]])
          )
        : null;
    return {
      fetchedAt: data.fetchedAt,
      since: data.since,
      until: data.until,
      totals: data.totals,
      selected: {
        actor: selection.actor || null,
        mcp: selection.mcp || null,
        request: request(selected)
      },
      agents: data.agents.filter(a => !selection.actor || a.id === selection.actor).slice(0, 50),
      connections: data.connections
        .filter(m => !selection.mcp || m.id === selection.mcp)
        .slice(0, 50),
      tools: data.tools
        .filter(
          t =>
            (!selection.actor || t.grantedTo.includes(selection.actor)) &&
            (!selection.mcp || t.mcpId === selection.mcp)
        )
        .slice(0, 60),
      active: data.active.slice(0, 30).map(request),
      scope:
        'Hoạt động đi qua Hub trong lịch sử còn lưu; danh sách tài nguyên tối đa 50, công cụ 60, yêu cầu đang chạy 30. Không có payload nội dung hay giá trị secret.',
      coverage: data.coverage
    };
  }
  return { begin, active, snapshot, chatContext };
}
