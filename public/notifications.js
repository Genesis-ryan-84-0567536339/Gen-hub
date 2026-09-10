/**
 * Notification helper for Gen-hub (Issue #29).
 * Transforms audit logs into user-friendly notifications with unread tracking.
 */

export function timeAgo(dateString, now = Date.now()) {
  const ts = typeof dateString === 'number' ? dateString : Date.parse(dateString);
  if (!ts || isNaN(ts)) return 'Vừa xong';
  const diff = Math.max(0, now - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 30) return 'Vừa xong';
  if (sec < 60) return `${sec} giây trước`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} phút trước`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} giờ trước`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day} ngày trước`;
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit'
  }).format(new Date(ts));
}

export function formatNotification(log, state = {}) {
  const l = log || {};
  const agents = state.agents || [];
  const mcps = state.mcps || [];
  const actor = l.actor || 'system';
  const status = l.status || 'success';
  const tool = l.tool || '';
  const input = l.input || {};
  const output = l.output || {};

  const findAgent = id => agents.find(a => a.id === id);
  const findMcp = id => mcps.find(m => m.id === id);

  const actorName =
    actor === 'owner'
      ? 'Chủ sở hữu'
      : actor === 'admin_assistant'
        ? 'Trợ lý quản trị'
        : findAgent(actor)?.name || (actor.length > 12 ? actor.slice(0, 8) + '…' : actor);

  const mcpName =
    findMcp(l.mcp)?.name ||
    findMcp(input.mcp)?.name ||
    (l.mcp && l.mcp !== 'hub' && l.mcp !== 'vault'
      ? l.mcp.length > 12
        ? l.mcp.slice(0, 8) + '…'
        : l.mcp
      : 'Hub');

  const ts = Date.parse(l.created) || Date.now();

  // 1. Agent lifecycle
  if (tool === 'agent.create') {
    const name = input.name || output.id || 'mới';
    return {
      id: l.id,
      created: l.created,
      timestamp: ts,
      title: 'Agent mới kết nối',
      message: `Agent "${name}" đã được tạo và cấp quyền.`,
      level: 'info',
      icon: 'bot',
      target: '#agents',
      actor: actorName,
      status
    };
  }

  if (tool === 'agent.remove') {
    const name = input.name || input.id || '';
    return {
      id: l.id,
      created: l.created,
      timestamp: ts,
      title: 'Đã xóa agent',
      message: `Agent "${name}" đã bị xóa khỏi Hub.`,
      level: 'warn',
      icon: 'bot',
      target: '#agents',
      actor: actorName,
      status
    };
  }

  if (tool === 'agent.update') {
    const isRevoke = input.status === 'revoked';
    const targetAgent = findAgent(input.id)?.name || input.id || '';
    return {
      id: l.id,
      created: l.created,
      timestamp: ts,
      title: isRevoke ? 'Thu hồi agent' : 'Cập nhật agent',
      message: isRevoke
        ? `Đã thu hồi quyền truy cập của agent "${targetAgent}".`
        : `Đã cập nhật thông tin/quyền của agent "${targetAgent}".`,
      level: isRevoke ? 'warn' : 'info',
      icon: 'bot',
      target: '#agents',
      actor: actorName,
      status
    };
  }

  // 2. Connector lifecycle
  if (tool === 'connection.oauth' || tool === 'connection.authorize') {
    return {
      id: l.id,
      created: l.created,
      timestamp: ts,
      title: 'Connector đã kết nối',
      message: `Connector "${mcpName}" đã kết nối thành công.`,
      level: 'info',
      icon: 'plug',
      target: '#mcps',
      actor: actorName,
      status
    };
  }

  if (tool === 'connection.disconnect') {
    return {
      id: l.id,
      created: l.created,
      timestamp: ts,
      title: 'Connector ngắt kết nối',
      message: `Connector "${mcpName}" đã ngắt kết nối.`,
      level: 'warn',
      icon: 'plug',
      target: '#mcps',
      actor: actorName,
      status
    };
  }

  if (tool === 'mcp.add') {
    const name = input.name || mcpName;
    return {
      id: l.id,
      created: l.created,
      timestamp: ts,
      title: 'Thêm connector mới',
      message: `Đã thêm connector "${name}" vào Hub.`,
      level: 'info',
      icon: 'plug',
      target: '#mcps',
      actor: actorName,
      status
    };
  }

  if (tool === 'mcp.remove') {
    return {
      id: l.id,
      created: l.created,
      timestamp: ts,
      title: 'Gỡ connector',
      message: `Connector "${mcpName}" đã bị gỡ khỏi Hub.`,
      level: 'warn',
      icon: 'plug',
      target: '#mcps',
      actor: actorName,
      status
    };
  }

  if (tool === 'mcp.sync') {
    const count = output.toolCount ?? 0;
    return {
      id: l.id,
      created: l.created,
      timestamp: ts,
      title: 'Đồng bộ connector',
      message: `Đã đồng bộ ${count} tool từ connector "${mcpName}".`,
      level: 'info',
      icon: 'plug',
      target: '#mcps',
      actor: actorName,
      status
    };
  }

  if (tool === 'mcp.update') {
    return {
      id: l.id,
      created: l.created,
      timestamp: ts,
      title: 'Cập nhật connector',
      message: input.published
        ? `Đã cập nhật công bố tool cho connector "${mcpName}".`
        : `Đã cập nhật cấu hình connector "${mcpName}".`,
      level: 'info',
      icon: 'plug',
      target: '#mcps',
      actor: actorName,
      status
    };
  }

  // 3. Vault operations
  if (tool === 'vault.read') {
    const sid = input.id || '';
    const isErr = status === 'error' || status === 'denied';
    return {
      id: l.id,
      created: l.created,
      timestamp: ts,
      title: isErr ? 'Từ chối đọc secret' : 'Secret được truy cập',
      message: isErr
        ? `${actorName} cố gắng đọc secret "${sid}" nhưng bị từ chối.`
        : `${actorName} đã đọc secret "${sid}" trong Vault.`,
      level: isErr ? 'error' : 'security',
      icon: 'lock',
      target: '#vault',
      actor: actorName,
      status
    };
  }

  if (tool === 'vault.call') {
    const sid = input.id || '';
    const isErr = status === 'error' || status === 'denied';
    return {
      id: l.id,
      created: l.created,
      timestamp: ts,
      title: isErr ? 'Gọi secret thất bại' : 'Gọi secret từ Vault',
      message: isErr
        ? `${actorName} gọi secret "${sid}" thất bại.`
        : `${actorName} đã gọi secret "${sid}".`,
      level: isErr ? 'error' : 'security',
      icon: 'lock',
      target: '#vault',
      actor: actorName,
      status
    };
  }

  if (tool === 'vault.create') {
    const sid = input.id || output.id || '';
    return {
      id: l.id,
      created: l.created,
      timestamp: ts,
      title: 'Secret mới trong Vault',
      message: `Đã tạo secret "${sid}" mới.`,
      level: 'security',
      icon: 'lock',
      target: '#vault',
      actor: actorName,
      status
    };
  }

  if (tool === 'vault.remove') {
    const sid = input.id || '';
    return {
      id: l.id,
      created: l.created,
      timestamp: ts,
      title: 'Xóa secret',
      message: `Đã xóa secret "${sid}" khỏi Vault.`,
      level: 'warn',
      icon: 'lock',
      target: '#vault',
      actor: actorName,
      status
    };
  }

  // 4. Security & Administration
  if (tool === 'security.pin_check') {
    const op = input.operation || 'bảo vệ';
    return {
      id: l.id,
      created: l.created,
      timestamp: ts,
      title: 'Nhập sai mã PIN',
      message: `Xác nhận PIN thất bại cho thao tác "${op}".`,
      level: 'error',
      icon: 'shield',
      target: '#settings',
      actor: actorName,
      status
    };
  }

  if (tool === 'security.pin_set') {
    return {
      id: l.id,
      created: l.created,
      timestamp: ts,
      title: 'Cập nhật mã PIN',
      message: 'Mã PIN bảo vệ thao tác xóa đã được cập nhật.',
      level: 'security',
      icon: 'shield',
      target: '#settings',
      actor: actorName,
      status
    };
  }

  if (tool === 'admin_assistant.create') {
    return {
      id: l.id,
      created: l.created,
      timestamp: ts,
      title: 'Tạo token trợ lý',
      message: 'Đã tạo token trợ lý quản trị mới.',
      level: 'security',
      icon: 'bot',
      target: '#settings',
      actor: actorName,
      status
    };
  }

  if (tool === 'admin_assistant.revoke') {
    return {
      id: l.id,
      created: l.created,
      timestamp: ts,
      title: 'Thu hồi token trợ lý',
      message: 'Đã thu hồi token trợ lý quản trị.',
      level: 'warn',
      icon: 'bot',
      target: '#settings',
      actor: actorName,
      status
    };
  }

  if (tool === 'owner.password_changed') {
    return {
      id: l.id,
      created: l.created,
      timestamp: ts,
      title: 'Đổi mật khẩu owner',
      message: 'Mật khẩu quản trị chủ sở hữu đã được thay đổi.',
      level: 'security',
      icon: 'lock',
      target: '#settings',
      actor: actorName,
      status
    };
  }

  if (tool === 'owner.login') {
    return {
      id: l.id,
      created: l.created,
      timestamp: ts,
      title: 'Owner đăng nhập',
      message: 'Chủ sở hữu đăng nhập vào phiên làm việc.',
      level: 'info',
      icon: 'activity',
      target: '#overview',
      actor: actorName,
      status
    };
  }

  if (tool === 'system.update') {
    const rev = (output.revision || input.revision || '').slice(0, 7);
    return {
      id: l.id,
      created: l.created,
      timestamp: ts,
      title: 'Gen-hub đã cập nhật',
      message: rev
        ? `Hệ thống vừa cập nhật lên phiên bản ${rev}.`
        : 'Hệ thống vừa tự động cập nhật phiên bản mới.',
      level: 'info',
      icon: 'shield',
      target: '#overview',
      actor: 'Hệ thống',
      status
    };
  }

  if (tool === 'system.check_update') {
    return {
      id: l.id,
      created: l.created,
      timestamp: ts,
      title: 'Kiểm tra cập nhật',
      message: output.hasUpdate
        ? `Có bản cập nhật mới (${(output.latestRevision || '').slice(0, 7)}) trên GitHub.`
        : 'Đã kiểm tra cập nhật: Hệ thống đang ở bản mới nhất.',
      level: 'info',
      icon: 'activity',
      target: '#settings',
      actor: actorName,
      status
    };
  }

  // 5. Tool calls by external agents or general tools
  if (status === 'error' || status === 'denied') {
    const isDenied = status === 'denied';
    return {
      id: l.id,
      created: l.created,
      timestamp: ts,
      title: isDenied ? 'Tool call bị từ chối' : 'Tool call lỗi',
      message: `${actorName} gọi "${tool}" ${isDenied ? 'bị từ chối' : 'thất bại'}${l.reason ? ': ' + l.reason : ''}.`,
      level: 'error',
      icon: 'activity',
      target: '#audit',
      actor: actorName,
      status
    };
  }

  // Normal tool call
  return {
    id: l.id,
    created: l.created,
    timestamp: ts,
    title: `Lượt gọi tool: ${tool}`,
    message: `${actorName} gọi tool "${tool}" thành công.`,
    level: 'normal',
    icon: 'activity',
    target: '#audit',
    actor: actorName,
    status
  };
}

export function getNotifications(logs = [], state = {}, lastRead = 0) {
  const safeLogs = Array.isArray(logs) ? logs : [];
  const notifications = safeLogs
    .map(log => {
      const formatted = formatNotification(log, state);
      const unread = formatted.timestamp > lastRead;
      return { ...formatted, unread };
    })
    .sort((a, b) => b.timestamp - a.timestamp);

  const unreadCount = notifications.filter(n => n.unread).length;
  const latestTimestamp =
    notifications.length > 0 ? Math.max(...notifications.map(n => n.timestamp)) : 0;

  return {
    notifications,
    unreadCount,
    latestTimestamp
  };
}
