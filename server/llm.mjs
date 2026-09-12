import { HubError, request, privateIP } from './net.mjs';
import { redact } from './store.mjs';
import { filterValidToolCalls } from './chat-validator.mjs';
import dns from 'node:dns/promises';
import { isIP } from 'node:net';

export const MAX_CONCURRENT_CHAT = 5;
const nativeFetch = globalThis.fetch;

export async function assertOutboundPolicy(url, { provider = 'openai', allowPrivate = false } = {}) {
  const u = new URL(url);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) {
    throw new HubError('Địa chỉ HTTP/HTTPS không hợp lệ');
  }

  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await dns.lookup(host, { all: true }).catch(() => []);

  if (!addresses.length) {
    throw new HubError('Không thể phân giải địa chỉ máy chủ');
  }

  // Chặn tuyệt đối endpoint metadata cloud (169.254.169.254 / 169.254.170.2) cho mọi provider
  if (addresses.some(a => a.address === '169.254.169.254' || a.address === '169.254.170.2')) {
    throw new HubError('Địa chỉ metadata bị chặn', 403);
  }

  // Chặn mạng riêng trừ ngoại lệ local Ollama
  if (!allowPrivate && addresses.some(a => privateIP(a.address))) {
    throw new HubError('Địa chỉ mạng riêng chưa được owner cho phép', 403);
  }

  // Chặn HTTP không mã hóa cho provider bên ngoài có credential
  if (provider !== 'ollama' && u.protocol !== 'https:') {
    throw new HubError('API key chỉ được gửi qua kết nối HTTPS bảo mật', 400);
  }
}

// res.headers may be a Headers instance (test-mocked fetch/Response) or a plain
// lowercase-keyed object (Node's http.IncomingMessage.headers, from net.mjs's request()).
function getResponseHeader(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name) ?? null;
  return headers[name.toLowerCase()] ?? headers[name] ?? null;
}

export async function defaultLlmTransport(
  url,
  { method = 'POST', headers = {}, body, signal, timeoutMs = 25000, maxBytes = 4 * 1024 * 1024 } = {},
  provider = 'openai'
) {
  const allowPrivate = provider === 'ollama';
  await assertOutboundPolicy(url, { provider, allowPrivate });

  // Nếu môi trường test đã mock globalThis.fetch
  if (globalThis.fetch !== nativeFetch) {
    const res = await globalThis.fetch(url, {
      method,
      headers,
      body,
      signal
    });
    const text = await res.text().catch(() => '');
    if (Buffer.byteLength(text) > maxBytes) {
      throw new HubError('Phản hồi vượt giới hạn 4 MiB', 502);
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch {}
    return {
      status: res.status,
      ok: res.ok,
      headers: res.headers,
      text,
      json
    };
  }

  // Production: dùng shared transport request() từ net.mjs
  const res = await request(url, {
    method,
    headers,
    body,
    allowPrivate,
    maxBytes,
    timeout: timeoutMs,
    signal
  });
  return {
    status: res.status,
    ok: res.status >= 200 && res.status < 300,
    headers: res.headers,
    text: res.text,
    json: res.json
  };
}

export const CHAT_TOOLS_OPENAI = [
  {
    type: 'function',
    function: {
      name: 'navigate',
      description: 'Điều hướng giao diện SPA tới một trang hoặc mục cụ thể trong Gen-hub',
      parameters: {
        type: 'object',
        properties: {
          route: {
            type: 'string',
            description:
              'Tên trang hoặc mục (overview, mcps, agents, vault, audit, kanban, settings, mcps:<id>, agents:<id>, settings:security, settings:assistant, settings:llm)'
          }
        },
        required: ['route'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'open_modal',
      description:
        'Mở hộp thoại giao diện để hỗ trợ owner thực hiện thao tác (chỉ mở form, không tự động xác nhận)',
      parameters: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            description:
              'Loại modal: add (thêm MCP), connect (kết nối agent), onboard (hướng dẫn), credential (kết nối MCP), password (đổi mật khẩu), pin-setup (đặt PIN), admin-create (tạo admin token), vault-new (thêm secret), vault-edit (sửa secret)'
          },
          id: {
            type: 'string',
            description: 'ID đối tượng liên quan nếu cần (ví dụ MCP id hoặc secret id)'
          }
        },
        required: ['kind'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'highlight',
      description:
        'Khoanh vùng và làm nổi bật (pulse/outline) phần tử UI trên màn hình để hướng dẫn trực quan cho owner',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description:
              'CSS selector của phần tử cần khoanh vùng (ví dụ: [data-action="add"], #search, nav a[href="#mcps"])'
          }
        },
        required: ['selector'],
        additionalProperties: false
      }
    }
  }
];

export const CHAT_TOOLS_ANTHROPIC = CHAT_TOOLS_OPENAI.map(t => ({
  name: t.function.name,
  description: t.function.description,
  input_schema: t.function.parameters
}));

export const CHAT_TOOLS_GEMINI = CHAT_TOOLS_OPENAI.map(t => ({
  name: t.function.name,
  description: t.function.description,
  parameters: t.function.parameters
}));

export const MODEL_PRICING = {
  // Rates per 1M tokens in USD: { input, output, cache }
  'openai:gpt-4o': { input: 2.50, output: 10.00, cache: 1.25 },
  'openai:gpt-4o-mini': { input: 0.15, output: 0.60, cache: 0.075 },
  'anthropic:claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00, cache: 0.30 },
  'anthropic:claude-3-5-haiku-20241022': { input: 0.80, output: 4.00, cache: 0.08 },
  'gemini:gemini-1.5-flash': { input: 0.075, output: 0.30, cache: 0.01875 },
  'gemini:gemini-1.5-pro': { input: 1.25, output: 5.00, cache: 0.3125 }
};

export function calculateCost(provider, model, usage) {
  if (!usage || !model) return 'không có';
  const key = `${provider}:${model}`;
  const pricing = MODEL_PRICING[key] || MODEL_PRICING[model];
  if (!pricing) return 'không có';
  const input = usage.promptTokens ?? usage.inputTokens ?? 0;
  const output = usage.completionTokens ?? usage.outputTokens ?? 0;
  const cache = usage.cachedTokens ?? usage.cacheTokens ?? 0;
  const uncachedInput = Math.max(0, input - cache);
  const totalCost =
    (uncachedInput * pricing.input +
      cache * (pricing.cache ?? pricing.input) +
      output * pricing.output) /
    1_000_000;
  return Number.isFinite(totalCost) ? `$${totalCost.toFixed(6)}` : 'không có';
}

function buildSystemPrompt(store, currentRoute) {
  const mcps =
    store
      .list('mcp')
      .map(m => `${m.name} [id:${m.id}, trạng thái:${m.status}]`)
      .join('; ') || 'Chưa có MCP';
  const agents =
    store
      .list('agent')
      .map(a => `${a.name} [id:${a.id}, trạng thái:${a.status}]`)
      .join('; ') || 'Chưa có agent';
  const secrets =
    store
      .list('vault')
      .map(v => `${v.name} [id:${v.id}]`)
      .join('; ') || 'Không có secret';

  return `Bạn là Trợ lý giao diện thông minh của Gen-hub, hỗ trợ chủ sở hữu (owner) điều hướng và sử dụng hệ thống.
Thông tin hệ thống hiện tại:
- Trang hiện tại: ${currentRoute || 'overview'}
- Danh sách MCP: ${mcps}
- Danh sách Agent: ${agents}
- Danh sách Secret trong Vault: ${secrets}

Các trang có sẵn trong hệ thống:
- overview: Tổng quan kết nối, thống kê hoạt động, endpoint
- mcps: Quản lý MCP & kết nối (thêm MCP, kết nối dịch vụ, xem và công bố tool)
- agents: Quản lý Agent & quyền (kết nối agent, cấp quyền tool, thu hồi)
- vault: Kho bí mật (quản lý secret, phân quyền đọc cho agent)
- audit: Nhật ký hoạt động (lịch sử gọi tool, chi tiết input/output)
- kanban: Bảng Kanban quản lý công việc từ GitHub issue
- settings: Cài đặt (cài đặt chung, bảo mật PIN, trợ lý quản trị, LLM trợ lý, cập nhật)

Bạn có 3 công cụ:
1. navigate(route): Điều hướng người dùng tới trang hoặc mục phù hợp.
2. open_modal(kind, id): Mở hộp thoại chức năng để hỗ trợ (add, connect, onboard, credential, password, pin-setup, admin-create, vault-new, vault-edit). TUYỆT ĐỐI không thể thực hiện các thao tác xác nhận hay xóa dữ liệu.
3. highlight(selector): Khoanh vùng phần tử UI liên quan trên trang để người dùng dễ nhìn thấy.

Nguyên tắc an toàn:
- Luôn giải thích rõ ràng, ngắn gọn bằng tiếng Việt.
- Khi người dùng muốn xem hoặc thao tác gì, hãy dùng công cụ navigate và highlight để dẫn đường và làm nổi bật nút bấm/khu vực cần thao tác.
- Tuyệt đối không giả mạo hành động xác nhận của người dùng.`;
}

export function createChatService(store, origin, options = {}) {
  const kind = 'llm';

  function getConfig() {
    const record = store.get(kind, 'config');
    return {
      configured: !!record?.configured,
      provider: record?.provider || '',
      model: record?.model || '',
      baseUrl: record?.baseUrl || '',
      hasKey: !!record?.sealedKey,
      updatedAt: record?.updatedAt || null
    };
  }

  function getInternalConfig() {
    const record = store.get(kind, 'config');
    if (!record || !record.configured) return null;
    let apiKey = '';
    if (record.sealedKey) {
      try {
        apiKey = store.unseal(record.sealedKey)?.apiKey || '';
      } catch {
        apiKey = '';
      }
    }
    return {
      provider: record.provider,
      model: record.model,
      baseUrl: record.baseUrl,
      apiKey
    };
  }

  function saveConfig(b, actor = 'owner') {
    const validProviders = ['openai', 'anthropic', 'gemini', 'ollama'];
    if (!validProviders.includes(b.provider)) {
      throw new HubError(
        'Provider không hợp lệ. Chọn một trong: openai, anthropic, gemini, ollama'
      );
    }
    if (typeof b.model !== 'string' || !b.model.trim() || b.model.length > 100) {
      throw new HubError('Tên mô hình (model) không được để trống và tối đa 100 ký tự');
    }

    let baseUrl = typeof b.baseUrl === 'string' ? b.baseUrl.trim() : '';
    if (baseUrl) {
      if (!/^https?:\/\/.+/i.test(baseUrl)) {
        throw new HubError('Base URL phải là địa chỉ HTTP hoặc HTTPS hợp lệ');
      }
      try {
        const u = new URL(baseUrl);
        if (b.provider !== 'ollama' && u.protocol !== 'https:') {
          throw new HubError('API key chỉ được cấu hình qua kết nối HTTPS bảo mật');
        }
        if (u.hostname.includes('169.254.169.254') || u.hostname.includes('169.254.170.2')) {
          throw new HubError('Địa chỉ metadata bị chặn', 403);
        }
      } catch (err) {
        if (err instanceof HubError) throw err;
        throw new HubError('Base URL không hợp lệ');
      }
    }

    const existing = store.get(kind, 'config');
    let sealedKey = null;

    if (typeof b.apiKey === 'string' && b.apiKey.trim()) {
      if (b.apiKey.length > 1024) throw new HubError('API key vượt quá giới hạn độ dài');
      sealedKey = store.seal({ apiKey: b.apiKey.trim() });
    } else if (existing?.sealedKey) {
      sealedKey = existing.sealedKey;
    } else if (b.provider !== 'ollama') {
      throw new HubError('API key là bắt buộc đối với nhà cung cấp này');
    }

    const record = {
      provider: b.provider,
      model: b.model.trim(),
      baseUrl,
      sealedKey,
      configured: true,
      updatedAt: new Date().toISOString()
    };

    const safeInput = {
      provider: b.provider,
      model: b.model.trim(),
      baseUrl: baseUrl || undefined,
      hasKey: !!sealedKey
    };
    store.put(kind, 'config', record);
    store.audit('owner', 'hub', 'llm.save_config', 'success', safeInput, {
      configured: true,
      provider: record.provider,
      model: record.model
    }, undefined, '', {
      eventKind: 'admin_action',
      actorType: 'owner'
    });

    return getConfig();
  }

  async function testConnection(b = {}) {
    const provider = b.provider || store.get(kind, 'config')?.provider;
    const model = b.model || store.get(kind, 'config')?.model;
    const baseUrl = b.baseUrl !== undefined ? b.baseUrl : store.get(kind, 'config')?.baseUrl;
    let apiKey = b.apiKey;
    if (!apiKey) {
      const stored = getInternalConfig();
      if (stored) apiKey = stored.apiKey;
    }

    if (!provider || !model) {
      throw new HubError('Cần cung cấp provider và model để kiểm tra kết nối');
    }

    if (provider !== 'ollama' && !apiKey) {
      throw new HubError('Cần API key để kiểm tra kết nối');
    }

    const testMessages = [{ role: 'user', content: 'Xin chào' }];
    const started = performance.now();
    try {
      const result = await dispatchLlmCall({
        provider,
        model,
        baseUrl,
        apiKey,
        systemPrompt: 'Bạn là trợ lý kiểm tra kết nối. Hãy trả lời ngắn gọn.',
        messages: testMessages,
        tools: [],
        timeoutMs: 15000
      });
      const cost = calculateCost(provider, model, result.usage);
      store.audit(
        'owner',
        'hub',
        'llm.test_connection',
        'success',
        { provider, model, baseUrl: baseUrl || undefined },
        {
          ok: true,
          provider,
          model,
          requestId: result.requestId || undefined,
          usage: result.usage || undefined,
          cost
        },
        performance.now() - started,
        '',
        {
          eventKind: 'llm_call',
          actorType: 'owner',
          policyDecision: 'allow'
        }
      );
      return {
        ok: true,
        message: result.content ? 'Kết nối thành công!' : 'Đã nhận phản hồi',
        telemetry: {
          provider,
          model,
          requestId: result.requestId || undefined,
          usage: result.usage || undefined,
          cost
        }
      };
    } catch (err) {
      store.audit(
        'owner',
        'hub',
        'llm.test_connection',
        'error',
        { provider, model, baseUrl: baseUrl || undefined },
        { error: err.message, provider, model },
        performance.now() - started,
        '',
        {
          eventKind: 'llm_call',
          actorType: 'owner',
          errorCategory: 'upstream_transport'
        }
      );
      return { ok: false, error: err.message || 'Không thể kết nối với LLM' };
    }
  }

  let inFlightChat = 0;

  async function chat(b, actor = 'owner', req) {
    const config = getInternalConfig();
    if (!config) {
      throw new HubError(
        'LLM chưa được cấu hình. Vui lòng thiết lập trong Cài đặt trước khi chat.',
        400
      );
    }

    if (inFlightChat >= MAX_CONCURRENT_CHAT) {
      throw new HubError('Hệ thống đang xử lý nhiều yêu cầu LLM cùng lúc, vui lòng thử lại sau', 429);
    }
    inFlightChat++;

    const abortCtrl = new AbortController();
    if (req) {
      if (req.signal) {
        if (req.signal.aborted) abortCtrl.abort();
        else req.signal.addEventListener('abort', () => abortCtrl.abort(), { once: true });
      }
      req.on?.('close', () => {
        if (!req.complete) abortCtrl.abort();
      });
    }

    try {
      if (!Array.isArray(b.messages) || b.messages.length === 0) {
        throw new HubError('Danh sách tin nhắn (messages) không hợp lệ');
      }

      if (b.messages.length > 30) {
        throw new HubError('Lịch sử tin nhắn vượt quá giới hạn');
      }

      const cleanMessages = [];
      for (const m of b.messages) {
        if (!m || typeof m !== 'object' || !['user', 'assistant'].includes(m.role)) {
          throw new HubError('Tin nhắn không đúng định dạng role (user hoặc assistant)');
        }
        if (typeof m.content !== 'string' || m.content.length > 4000) {
          throw new HubError('Nội dung tin nhắn không hợp lệ hoặc vượt quá 4000 ký tự');
        }
        cleanMessages.push({ role: m.role, content: m.content });
      }

      const currentRoute = typeof b.currentRoute === 'string' ? b.currentRoute : 'overview';
      const systemPrompt = buildSystemPrompt(store, currentRoute);

      const started = performance.now();
      try {
        const { content, tool_calls, usage, requestId } = await dispatchLlmCall({
          provider: config.provider,
          model: config.model,
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          systemPrompt,
          messages: cleanMessages,
          tools: CHAT_TOOLS_OPENAI,
          timeoutMs: 25000,
          signal: abortCtrl.signal,
          transport: options?.transport
        });

        const validTools = filterValidToolCalls(tool_calls);
        const cost = calculateCost(config.provider, config.model, usage);

        store.audit(
          actor,
          'hub',
          'chat.message',
          'success',
          redact({ messageCount: cleanMessages.length, currentRoute }),
          redact({
            provider: config.provider,
            model: config.model,
            requestId: requestId || undefined,
            usage: usage || undefined,
            cost,
            toolCalls: validTools.map(t => t.name),
            contentPreview: content.slice(0, 100)
          }),
          performance.now() - started,
          '',
          {
            eventKind: 'llm_call',
            actorType: actor === 'owner' ? 'owner' : 'admin',
            policyDecision: 'allow'
          }
        );

        return {
          message: {
            role: 'assistant',
            content,
            tool_calls: validTools
          },
          telemetry: {
            provider: config.provider,
            model: config.model,
            requestId: requestId || undefined,
            usage: usage || undefined,
            cost
          }
        };
      } catch (err) {
        store.audit(
          actor,
          'hub',
          'chat.message',
          'error',
          redact({ messageCount: cleanMessages.length, currentRoute }),
          {
            error: err.message,
            provider: config.provider,
            model: config.model
          },
          performance.now() - started,
          '',
          {
            eventKind: 'llm_call',
            actorType: actor === 'owner' ? 'owner' : 'admin',
            errorCategory: 'upstream_transport'
          }
        );
        throw new HubError(err.message || 'Lỗi khi gọi mô hình ngôn ngữ', err.status || 502);
      }
    } finally {
      inFlightChat--;
    }
  }

  return {
    getConfig,
    saveConfig,
    testConnection,
    chat,
    getInFlightChat: () => inFlightChat
  };
}

/**
 * Dispatch request to the appropriate LLM provider.
 */
export async function dispatchLlmCall({
  provider,
  model,
  baseUrl,
  apiKey,
  systemPrompt,
  messages,
  tools = CHAT_TOOLS_OPENAI,
  timeoutMs = 25000,
  signal,
  transport = defaultLlmTransport
}) {
  const effectiveSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);

  if (provider === 'openai' || provider === 'ollama') {
    let url = baseUrl || (provider === 'ollama' ? 'http://localhost:11434/v1' : 'https://api.openai.com/v1');
    url = url.replace(/\/+$/, '');
    if (!url.endsWith('/v1') && provider === 'ollama') {
      url += '/v1';
    }
    const endpoint = `${url}/chat/completions`;

    const headers = {
      'Content-Type': 'application/json'
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const payload = {
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.2
    };
    if (tools && tools.length > 0) {
      payload.tools = tools;
    }

    const res = await transport(
      endpoint,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: effectiveSignal,
        timeoutMs,
        maxBytes: 4 * 1024 * 1024
      },
      provider
    );

    const requestId = getResponseHeader(res.headers, 'x-request-id') || getResponseHeader(res.headers, 'request-id') || null;

    if (!res.ok) {
      const errText = res.text || '';
      throw new HubError(`LLM ${provider} lỗi [${res.status}]: ${errText.slice(0, 200)}`, res.status === 429 ? 429 : 502);
    }

    const data = res.json || {};
    const finalRequestId = requestId || data.id || null;
    const choice = data.choices?.[0];
    const content = choice?.message?.content || '';
    const rawTools = (choice?.message?.tool_calls || []).map(tc => {
      let parsedArgs = {};
      try {
        parsedArgs =
          typeof tc.function?.arguments === 'string'
            ? JSON.parse(tc.function.arguments)
            : tc.function?.arguments || {};
      } catch {}
      return {
        name: tc.function?.name,
        arguments: parsedArgs
      };
    });

    let usage = undefined;
    if (data.usage && typeof data.usage === 'object') {
      const promptTokens = data.usage.prompt_tokens ?? data.usage.input_tokens;
      const completionTokens = data.usage.completion_tokens ?? data.usage.output_tokens;
      const cachedTokens = data.usage.prompt_tokens_details?.cached_tokens ?? data.usage.cache_tokens;
      const totalTokens =
        data.usage.total_tokens ??
        (typeof promptTokens === 'number' && typeof completionTokens === 'number'
          ? promptTokens + completionTokens
          : undefined);
      usage = {
        promptTokens,
        completionTokens,
        cachedTokens,
        totalTokens,
        inputTokens: promptTokens,
        outputTokens: completionTokens,
        cacheTokens: cachedTokens
      };
    } else if (data.prompt_eval_count !== undefined || data.eval_count !== undefined) {
      const promptTokens = data.prompt_eval_count;
      const completionTokens = data.eval_count;
      const totalTokens = (promptTokens || 0) + (completionTokens || 0);
      usage = {
        promptTokens,
        completionTokens,
        cachedTokens: undefined,
        totalTokens,
        inputTokens: promptTokens,
        outputTokens: completionTokens,
        cacheTokens: undefined
      };
    }

    return { content, tool_calls: rawTools, usage, requestId: finalRequestId };
  }

  if (provider === 'anthropic') {
    let url = (baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
    const endpoint = `${url}/v1/messages`;

    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey || '',
      'anthropic-version': '2023-06-01'
    };

    const anthropicTools = CHAT_TOOLS_ANTHROPIC;
    const payload = {
      model,
      system: systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      max_tokens: 1024,
      temperature: 0.2
    };
    if (tools && tools.length > 0) {
      payload.tools = anthropicTools;
    }

    const res = await transport(
      endpoint,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: effectiveSignal,
        timeoutMs,
        maxBytes: 4 * 1024 * 1024
      },
      provider
    );

    const requestId = getResponseHeader(res.headers, 'request-id') || getResponseHeader(res.headers, 'x-request-id') || null;

    if (!res.ok) {
      const errText = res.text || '';
      throw new HubError(`Anthropic API lỗi [${res.status}]: ${errText.slice(0, 200)}`, res.status === 429 ? 429 : 502);
    }

    const data = res.json || {};
    const finalRequestId = requestId || data.id || null;
    const textBlocks = (data.content || []).filter(c => c.type === 'text');
    const content = textBlocks.map(c => c.text).join('\n');
    const rawTools = (data.content || [])
      .filter(c => c.type === 'tool_use')
      .map(tc => ({
        name: tc.name,
        arguments: tc.input || {}
      }));

    let usage = undefined;
    if (data.usage && typeof data.usage === 'object') {
      const promptTokens = data.usage.input_tokens;
      const completionTokens = data.usage.output_tokens;
      const cachedTokens = data.usage.cache_read_input_tokens ?? undefined;
      const totalTokens =
        typeof promptTokens === 'number' && typeof completionTokens === 'number'
          ? promptTokens + completionTokens
          : undefined;
      usage = {
        promptTokens,
        completionTokens,
        cachedTokens,
        totalTokens,
        inputTokens: promptTokens,
        outputTokens: completionTokens,
        cacheTokens: cachedTokens
      };
    }

    return { content, tool_calls: rawTools, usage, requestId: finalRequestId };
  }

  if (provider === 'gemini') {
    let url = (baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '');
    const endpoint = `${url}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey || '')}`;

    const headers = {
      'Content-Type': 'application/json'
    };

    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    const payload = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: { temperature: 0.2 }
    };
    if (tools && tools.length > 0) {
      payload.tools = [{ function_declarations: CHAT_TOOLS_GEMINI }];
    }

    const res = await transport(
      endpoint,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: effectiveSignal,
        timeoutMs,
        maxBytes: 4 * 1024 * 1024
      },
      provider
    );

    const requestId = getResponseHeader(res.headers, 'x-request-id') || getResponseHeader(res.headers, 'x-goog-request-params') || null;

    if (!res.ok) {
      const errText = res.text || '';
      throw new HubError(`Gemini API lỗi [${res.status}]: ${errText.slice(0, 200)}`, res.status === 429 ? 429 : 502);
    }

    const data = res.json || {};
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const textParts = parts.filter(p => typeof p.text === 'string');
    const content = textParts.map(p => p.text).join('\n');
    const rawTools = parts
      .filter(p => p.functionCall)
      .map(p => ({
        name: p.functionCall.name,
        arguments: p.functionCall.args || {}
      }));

    let usage = undefined;
    if (data.usageMetadata && typeof data.usageMetadata === 'object') {
      const promptTokens = data.usageMetadata.promptTokenCount;
      const completionTokens = data.usageMetadata.candidatesTokenCount;
      const cachedTokens = data.usageMetadata.cachedContentTokenCount ?? undefined;
      const totalTokens = data.usageMetadata.totalTokenCount;
      usage = {
        promptTokens,
        completionTokens,
        cachedTokens,
        totalTokens,
        inputTokens: promptTokens,
        outputTokens: completionTokens,
        cacheTokens: cachedTokens
      };
    }

    return { content, tool_calls: rawTools, usage, requestId };
  }

  throw new HubError(`Nhà cung cấp LLM không được hỗ trợ: ${provider}`, 400);
}
