import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import {
  validateToolCall,
  filterValidToolCalls,
  ALLOWED_CHAT_TOOLS,
  ALLOWED_ROUTES,
  ALLOWED_MODAL_KINDS
} from '../server/chat-validator.mjs';
import { dispatchLlmCall } from '../server/llm.mjs';

test('Chat tool validation: strict safety whitelist and defense against malicious input', () => {
  // 1. Tool name whitelist
  assert.equal(validateToolCall({ name: 'navigate', arguments: { route: 'mcps' } }).valid, true);
  assert.equal(validateToolCall({ name: 'open_modal', arguments: { kind: 'add' } }).valid, true);
  assert.equal(
    validateToolCall({ name: 'highlight', arguments: { selector: '[data-action="add"]' } }).valid,
    true
  );

  // Unknown or unauthorized tools MUST be rejected
  assert.equal(validateToolCall({ name: 'exec', arguments: { cmd: 'rm -rf /' } }).valid, false);
  assert.equal(validateToolCall({ name: 'eval', arguments: { code: '1+1' } }).valid, false);
  assert.equal(validateToolCall({ name: 'bash', arguments: { command: 'ls' } }).valid, false);
  assert.equal(validateToolCall({ name: 'connector_remove', arguments: { id: 'mcp-1' } }).valid, false);
  assert.equal(validateToolCall(null).valid, false);
  assert.equal(validateToolCall('invalid').valid, false);

  // 2. Navigation route validation
  const validRoutes = [
    'overview',
    'mcps',
    'agents',
    'vault',
    'audit',
    'kanban',
    'settings',
    'mcps:mcp-12345',
    'agents:agent-999',
    'settings:security',
    'settings:llm'
  ];
  for (const r of validRoutes) {
    const res = validateToolCall({ name: 'navigate', arguments: { route: r } });
    assert.equal(res.valid, true, `Route ${r} should be valid`);
  }

  const invalidRoutes = [
    'https://evil.com',
    'javascript:alert(1)',
    '//attacker.org',
    '../etc/passwd',
    'unknown_page',
    'shell:bash',
    '',
    '   ',
    'overview;DROP TABLE records;'
  ];
  for (const r of invalidRoutes) {
    const res = validateToolCall({ name: 'navigate', arguments: { route: r } });
    assert.equal(res.valid, false, `Route ${r} should be rejected`);
  }

  // 3. Modal kind validation & safety against destructive actions
  const validModals = [
    'add',
    'connect',
    'onboard',
    'credential',
    'password',
    'pin-setup',
    'admin-create',
    'vault-new',
    'vault-edit'
  ];
  for (const k of validModals) {
    const res = validateToolCall({ name: 'open_modal', arguments: { kind: k } });
    assert.equal(res.valid, true, `Modal kind ${k} should be valid`);
  }

  // Destructive actions MUST be rejected
  const forbiddenActions = [
    'do-remove',
    'do-disconnect',
    'do-delete-agent',
    'do-vault-delete',
    'do-revoke',
    'do-vault-reveal',
    'delete',
    'remove',
    'destroy',
    'arbitrary-modal'
  ];
  for (const k of forbiddenActions) {
    const res = validateToolCall({ name: 'open_modal', arguments: { kind: k } });
    assert.equal(res.valid, false, `Action ${k} should be blocked`);
  }

  // Valid id vs invalid id in open_modal
  assert.equal(
    validateToolCall({ name: 'open_modal', arguments: { kind: 'credential', id: 'mcp-123' } }).valid,
    true
  );
  assert.equal(
    validateToolCall({ name: 'open_modal', arguments: { kind: 'credential', id: '<script>' } }).valid,
    false
  );

  // 4. Highlight CSS selector validation
  const validSelectors = [
    '#results',
    '.card.stat',
    '[data-action="add"]',
    'nav a[href="#mcps"]',
    '.btn.primary',
    '#search',
    'section.card:first-child'
  ];
  for (const s of validSelectors) {
    const res = validateToolCall({ name: 'highlight', arguments: { selector: s } });
    assert.equal(res.valid, true, `Selector ${s} should be valid`);
  }

  const invalidSelectors = [
    '<script>alert(1)</script>',
    'javascript:alert(1)',
    'expression(alert(1))',
    'url(https://evil.com)',
    'data:text/html,evil',
    '[data-action="add"', // unclosed bracket
    'nav a[href="#mcps\']', // mismatched quotes
    'a'.repeat(121), // exceeds 120 chars
    '',
    '   '
  ];
  for (const s of invalidSelectors) {
    const res = validateToolCall({ name: 'highlight', arguments: { selector: s } });
    assert.equal(res.valid, false, `Selector ${s} should be rejected`);
  }

  // 5. filterValidToolCalls
  const mixedCalls = [
    { name: 'navigate', arguments: { route: 'mcps' } },
    { name: 'eval', arguments: { code: 'process.exit(1)' } },
    { name: 'open_modal', arguments: { kind: 'do-remove' } },
    { name: 'open_modal', arguments: { kind: 'add' } },
    { name: 'highlight', arguments: { selector: '<script>' } },
    { name: 'highlight', arguments: { selector: '[data-action="add"]' } }
  ];
  const filtered = filterValidToolCalls(mixedCalls);
  assert.equal(filtered.length, 3);
  assert.equal(filtered[0].name, 'navigate');
  assert.equal(filtered[1].name, 'open_modal');
  assert.equal(filtered[2].name, 'highlight');
});

test('Chat API: Unconfigured LLM returns proper error and does not crash', async t => {
  const { call } = await fixture(t);

  // Check state includes llm info
  const stateRes = await call('/api/state');
  assert.equal(stateRes.status, 200);
  assert.equal(stateRes.data.llm.configured, false);
  assert.equal(stateRes.data.llm.hasKey, false);

  // Check GET /api/llm
  const llmRes = await call('/api/llm');
  assert.equal(llmRes.status, 200);
  assert.equal(llmRes.data.configured, false);
  assert.equal(llmRes.data.hasKey, false);

  // Calling chat when unconfigured returns 400 error
  const chatRes = await call('/api/chat', 'POST', {
    messages: [{ role: 'user', content: 'Xin chào' }]
  });
  assert.equal(chatRes.status, 400);
  assert.match(chatRes.data.error, /chưa được cấu hình/i);
});

test('Chat API: Credential safety & BYOC configuration lifecycle', async t => {
  const { call, hub } = await fixture(t);

  const secretApiKey = 'sk-super-secret-key-12345-never-leak';

  // Save LLM configuration
  const saveRes = await call('/api/llm', 'PATCH', {
    provider: 'openai',
    model: 'gpt-4o',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: secretApiKey
  });
  assert.equal(saveRes.status, 200);
  assert.equal(saveRes.data.configured, true);
  assert.equal(saveRes.data.hasKey, true);
  assert.equal(saveRes.data.provider, 'openai');
  assert.equal(saveRes.data.model, 'gpt-4o');

  // CRITICAL: API key must NEVER be returned in response!
  assert.equal(saveRes.data.apiKey, undefined);

  // Verify GET /api/llm also NEVER returns apiKey
  const getRes = await call('/api/llm');
  assert.equal(getRes.status, 200);
  assert.equal(getRes.data.configured, true);
  assert.equal(getRes.data.hasKey, true);
  assert.equal(getRes.data.apiKey, undefined);

  // Verify GET /api/state also NEVER leaks apiKey
  const stateRes = await call('/api/state');
  assert.equal(stateRes.status, 200);
  assert.equal(stateRes.data.llm.configured, true);
  assert.equal(stateRes.data.llm.hasKey, true);
  assert.equal(stateRes.data.llm.apiKey, undefined);

  // Verify Audit Log: plaintext apiKey must NEVER appear in audit logs
  const logsRes = await call('/api/logs');
  assert.equal(logsRes.status, 200);
  const logStr = JSON.stringify(logsRes.data);
  assert.equal(logStr.includes(secretApiKey), false, 'Plaintext API key must not exist in audit log');

  // Updating model without re-sending apiKey preserves the existing sealed key
  const updateRes = await call('/api/llm', 'PATCH', {
    provider: 'openai',
    model: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1'
  });
  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.data.configured, true);
  assert.equal(updateRes.data.hasKey, true);
  assert.equal(updateRes.data.model, 'gpt-4o-mini');
  assert.equal(updateRes.data.apiKey, undefined);

  // Test Ollama provider without API key
  const ollamaRes = await call('/api/llm', 'PATCH', {
    provider: 'ollama',
    model: 'llama3.2',
    baseUrl: 'http://localhost:11434'
  });
  assert.equal(ollamaRes.status, 200);
  assert.equal(ollamaRes.data.configured, true);
  assert.equal(ollamaRes.data.provider, 'ollama');
  assert.equal(ollamaRes.data.apiKey, undefined);
});

test('Multi-provider LLM dispatching and response normalization', async () => {
  const originalFetch = globalThis.fetch;

  try {
    // 1. OpenAI provider mock
    globalThis.fetch = async (url, opts) => {
      assert.match(url, /\/chat\/completions$/);
      const reqBody = JSON.parse(opts.body);
      assert.equal(reqBody.model, 'gpt-4o');
      assert.ok(reqBody.tools.length >= 3);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Tôi sẽ điều hướng bạn đến trang MCP.',
                tool_calls: [
                  {
                    function: {
                      name: 'navigate',
                      arguments: JSON.stringify({ route: 'mcps' })
                    }
                  },
                  {
                    function: {
                      name: 'highlight',
                      arguments: JSON.stringify({ selector: '[data-action="add"]' })
                    }
                  }
                ]
              }
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const openaiResult = await dispatchLlmCall({
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: 'test-key',
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'help' }]
    });

    assert.equal(openaiResult.content, 'Tôi sẽ điều hướng bạn đến trang MCP.');
    assert.equal(openaiResult.tool_calls.length, 2);
    assert.equal(openaiResult.tool_calls[0].name, 'navigate');
    assert.equal(openaiResult.tool_calls[0].arguments.route, 'mcps');

    // 2. Anthropic provider mock
    globalThis.fetch = async (url, opts) => {
      assert.match(url, /\/v1\/messages$/);
      assert.equal(opts.headers['x-api-key'], 'anthropic-key');
      const reqBody = JSON.parse(opts.body);
      assert.equal(reqBody.model, 'claude-3-5-sonnet-20241022');
      return new Response(
        JSON.stringify({
          content: [
            { type: 'text', text: 'Mở hộp thoại thêm kết nối.' },
            {
              type: 'tool_use',
              name: 'open_modal',
              input: { kind: 'add' }
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const anthropicResult = await dispatchLlmCall({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      apiKey: 'anthropic-key',
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'add mcp' }]
    });

    assert.equal(anthropicResult.content, 'Mở hộp thoại thêm kết nối.');
    assert.equal(anthropicResult.tool_calls.length, 1);
    assert.equal(anthropicResult.tool_calls[0].name, 'open_modal');
    assert.equal(anthropicResult.tool_calls[0].arguments.kind, 'add');

    // 3. Gemini provider mock
    globalThis.fetch = async (url, opts) => {
      assert.match(url, /generativelanguage\.googleapis\.com/);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { text: 'Đây là trang cài đặt.' },
                  {
                    functionCall: {
                      name: 'navigate',
                      args: { route: 'settings:security' }
                    }
                  }
                ]
              }
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const geminiResult = await dispatchLlmCall({
      provider: 'gemini',
      model: 'gemini-1.5-flash',
      apiKey: 'gemini-key',
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'go to settings' }]
    });

    assert.equal(geminiResult.content, 'Đây là trang cài đặt.');
    assert.equal(geminiResult.tool_calls.length, 1);
    assert.equal(geminiResult.tool_calls[0].name, 'navigate');
    assert.equal(geminiResult.tool_calls[0].arguments.route, 'settings:security');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Chat End-to-End: full conversation with mocked LLM tool invocation and audit logging', async t => {
  const { call, hub } = await fixture(t);

  // Configure LLM
  await call('/api/llm', 'PATCH', {
    provider: 'openai',
    model: 'gpt-4o',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-valid-key'
  });

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, opts) => {
      if (url.includes('api.openai.com')) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'Tôi đã điều hướng bạn tới trang Nhật ký và khoanh vùng bảng dữ liệu.',
                  tool_calls: [
                    {
                      function: {
                        name: 'navigate',
                        arguments: JSON.stringify({ route: 'audit' })
                      }
                    },
                    {
                      function: {
                        name: 'highlight',
                        arguments: JSON.stringify({ selector: '#results' })
                      }
                    },
                    // Attempt an unauthorized tool injection to verify server drops it
                    {
                      function: {
                        name: 'do-delete-agent',
                        arguments: JSON.stringify({ id: 'agent-1' })
                      }
                    }
                  ]
                }
              }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return originalFetch(url, opts);
    };

    const chatRes = await call('/api/chat', 'POST', {
      messages: [{ role: 'user', content: 'Cho tôi xem nhật ký hoạt động gần đây' }],
      currentRoute: 'overview'
    });

    assert.equal(chatRes.status, 200);
    assert.equal(chatRes.data.message.role, 'assistant');
    assert.match(chatRes.data.message.content, /Tôi đã điều hướng bạn tới trang Nhật ký/);

    // Verify only the 2 valid tools are returned (unauthorized one was dropped!)
    const toolCalls = chatRes.data.message.tool_calls;
    assert.equal(toolCalls.length, 2);
    assert.equal(toolCalls[0].name, 'navigate');
    assert.equal(toolCalls[0].arguments.route, 'audit');
    assert.equal(toolCalls[1].name, 'highlight');
    assert.equal(toolCalls[1].arguments.selector, '#results');

    // Verify chat interaction was audited
    const logsRes = await call('/api/logs');
    assert.equal(logsRes.status, 200);
    const chatLog = logsRes.data.find(l => l.tool === 'chat.message');
    assert.ok(chatLog, 'Audit log must record chat.message');
    assert.equal(chatLog.status, 'success');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
