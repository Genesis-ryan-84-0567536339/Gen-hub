export function seedMonitor(store) {
  store.put('settings', 'main', { onboarded: true });
  for (const id of ['mcp-one', 'mcp-two'])
    store.put('mcp', id, {
      id,
      name: 'Cùng tên',
      provider: 'remote',
      url: 'https://example.com/mcp',
      auth: 'none',
      on: true,
      status: 'connected',
      tools: [
        {
          name: 'echo',
          published: true,
          inputSchema: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
            additionalProperties: false
          }
        },
        { name: 'unused', published: true, inputSchema: { type: 'object' } },
        { name: 'private', published: false, inputSchema: { type: 'object' } }
      ]
    });
  for (const id of ['agent-one', 'agent-two'])
    store.put('agent', id, {
      id,
      name: 'Cùng tên agent',
      status: 'active',
      permissions: [(id === 'agent-one' ? 'mcp-one' : 'mcp-two') + ':echo'],
      created: new Date().toISOString()
    });
}
