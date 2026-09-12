import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertOutboundPolicy,
  defaultLlmTransport,
  dispatchLlmCall,
  createChatService,
  MAX_CONCURRENT_CHAT
} from '../server/llm.mjs';
import { HubError } from '../server/net.mjs';
import { fixture } from './helpers.mjs';

test('C5 Outbound Policy: blocks cloud metadata endpoints for all providers', async () => {
  // AWS/GCP/Azure metadata service 169.254.169.254 must be blocked
  await assert.rejects(
    () => assertOutboundPolicy('http://169.254.169.254/latest/meta-data', { provider: 'openai' }),
    err => {
      assert.ok(err instanceof HubError);
      assert.match(err.message, /metadata bị chặn/);
      return true;
    }
  );

  // Even for Ollama, metadata IP must remain strictly blocked
  await assert.rejects(
    () => assertOutboundPolicy('http://169.254.169.254/latest/meta-data', { provider: 'ollama', allowPrivate: true }),
    err => {
      assert.ok(err instanceof HubError);
      assert.match(err.message, /metadata bị chặn/);
      return true;
    }
  );

  await assert.rejects(
    () => assertOutboundPolicy('http://169.254.170.2/v2/metadata', { provider: 'ollama', allowPrivate: true }),
    /metadata bị chặn/
  );
});

test('C5 Outbound Policy: blocks private networks for public providers, allows for Ollama', async () => {
  // External providers cannot access loopback or private LAN
  await assert.rejects(
    () => assertOutboundPolicy('https://127.0.0.1:8080/v1', { provider: 'openai' }),
    /mạng riêng/
  );
  await assert.rejects(
    () => assertOutboundPolicy('https://192.168.1.50:8080/v1', { provider: 'anthropic' }),
    /mạng riêng/
  );
  await assert.rejects(
    () => assertOutboundPolicy('https://10.0.0.5:8080/v1', { provider: 'gemini' }),
    /mạng riêng/
  );

  // Ollama local exception is allowed
  await assert.doesNotThrow(() =>
    assertOutboundPolicy('http://127.0.0.1:11434/v1', { provider: 'ollama', allowPrivate: true })
  );
  await assert.doesNotThrow(() =>
    assertOutboundPolicy('http://localhost:11434/v1', { provider: 'ollama', allowPrivate: true })
  );
});

test('C5 Outbound Policy: enforces HTTPS for public providers, forbids credentials in URL', async () => {
  // Public provider over plain HTTP must be blocked
  await assert.rejects(
    () => assertOutboundPolicy('http://api.openai.com/v1', { provider: 'openai' }),
    /HTTPS bảo mật/
  );

  // Credentials embedded in URL must be rejected
  await assert.rejects(
    () => assertOutboundPolicy('https://user:password@api.openai.com/v1', { provider: 'openai' }),
    /không hợp lệ/
  );
});

test('C5 Outbound Policy: enforces response size limits (max 4 MiB)', async () => {
  const hugePayload = 'X'.repeat(5 * 1024 * 1024); // 5 MiB
  const mockTransport = async () => ({
    status: 200,
    ok: true,
    headers: {},
    text: hugePayload,
    json: {}
  });

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(hugePayload, { status: 200 });

    await assert.rejects(
      () =>
        defaultLlmTransport('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          maxBytes: 4 * 1024 * 1024
        }, 'openai'),
      /vượt giới hạn 4 MiB/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('C5 Outbound Policy: enforces chat concurrency limit (MAX_CONCURRENT_CHAT = 5)', async t => {
  const { hub } = await fixture(t);
  const store = hub.store;

  // Configure LLM
  store.put('llm', 'config', {
    provider: 'ollama',
    model: 'llama3',
    baseUrl: 'http://localhost:11434/v1',
    configured: true
  });

  let activeRequests = 0;
  let maxSeen = 0;

  // Custom mock transport that delays to simulate in-flight requests
  const slowTransport = async () => {
    activeRequests++;
    if (activeRequests > maxSeen) maxSeen = activeRequests;
    await new Promise(resolve => setTimeout(resolve, 50));
    activeRequests--;
    return {
      status: 200,
      ok: true,
      headers: {},
      text: JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
      json: { choices: [{ message: { content: 'ok' } }] }
    };
  };

  const service = createChatService(store, 'http://localhost:3000', {
    transport: slowTransport
  });

  // Fire 5 concurrent requests (should all succeed)
  const p1 = service.chat({ messages: [{ role: 'user', content: 'req 1' }] });
  const p2 = service.chat({ messages: [{ role: 'user', content: 'req 2' }] });
  const p3 = service.chat({ messages: [{ role: 'user', content: 'req 3' }] });
  const p4 = service.chat({ messages: [{ role: 'user', content: 'req 4' }] });
  const p5 = service.chat({ messages: [{ role: 'user', content: 'req 5' }] });

  // The 6th request fired while 5 are in-flight MUST be rejected with 429
  await assert.rejects(
    () => service.chat({ messages: [{ role: 'user', content: 'req 6' }] }),
    err => {
      assert.ok(err instanceof HubError);
      assert.equal(err.status, 429);
      assert.match(err.message, /nhiều yêu cầu LLM/);
      return true;
    }
  );

  await Promise.all([p1, p2, p3, p4, p5]);
  assert.equal(service.getInFlightChat(), 0, 'In-flight counter must return to 0');
});

test('C5 Outbound Policy: cancellation via AbortController stops in-flight chat', async t => {
  const { hub } = await fixture(t);
  const store = hub.store;

  store.put('llm', 'config', {
    provider: 'ollama',
    model: 'llama3',
    baseUrl: 'http://localhost:11434/v1',
    configured: true
  });

  const abortTransport = async (url, opts) => {
    return new Promise((resolve, reject) => {
      if (opts.signal?.aborted) return reject(new HubError('Yêu cầu đã bị hủy', 499));
      opts.signal?.addEventListener('abort', () => reject(new HubError('Yêu cầu đã bị hủy', 499)));
    });
  };

  const service = createChatService(store, 'http://localhost:3000', {
    transport: abortTransport
  });

  const mockReq = {
    signal: null,
    listeners: {},
    on(ev, cb) {
      this.listeners[ev] = cb;
    },
    emit(ev) {
      if (this.listeners[ev]) this.listeners[ev]();
    }
  };

  const chatPromise = service.chat(
    { messages: [{ role: 'user', content: 'cancel me' }] },
    'owner',
    mockReq
  );

  // Trigger client disconnection
  mockReq.emit('close');

  await assert.rejects(
    chatPromise,
    err => {
      assert.match(err.message, /hủy/);
      return true;
    }
  );
  assert.equal(service.getInFlightChat(), 0);
});

test('C5 Outbound Policy: saveConfig rejects HTTP and metadata endpoints for external providers', async t => {
  const { hub } = await fixture(t);
  const service = createChatService(hub.store, 'http://localhost:3000');

  // Rejects plain HTTP for OpenAI
  assert.throws(
    () =>
      service.saveConfig({
        provider: 'openai',
        model: 'gpt-4o',
        baseUrl: 'http://api.openai.com/v1',
        apiKey: 'key'
      }),
    /HTTPS bảo mật/
  );

  // Rejects metadata IP
  assert.throws(
    () =>
      service.saveConfig({
        provider: 'ollama',
        model: 'llama3',
        baseUrl: 'http://169.254.169.254'
      }),
    /metadata bị chặn/
  );
});
