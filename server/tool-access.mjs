// Shared by RPC enforcement and Monitor; publication and per-agent grants are separate gates.
export const canCallTool = (a, m, t) =>
  !!(
    a?.status === 'active' &&
    m?.on &&
    m?.status === 'connected' &&
    t?.published &&
    a.permissions.includes(m.id + ':' + t.name)
  );
