import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { createHub } from '../server/app.mjs';

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const closeServer = server => new Promise(resolve => server.close(resolve));

test('Fixed UI Chat Dock & Visual Guidance (Issue #24)', async t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'genhub-ui-chat-data-'));

  // 1. Create owner
  const adminResult = spawnSync(
    process.execPath,
    ['server/admin.mjs', 'create-owner'],
    {
      input: JSON.stringify({ username: 'owner', password: 'password-owner-1234' }),
      env: { ...process.env, DATA_DIR: dataDir },
      encoding: 'utf8'
    }
  );
  assert.equal(adminResult.status, 0, `create-owner failed: ${adminResult.stderr}`);

  // 2. Start Hub server
  const probe = createServer();
  await listen(probe);
  const port = probe.address().port;
  await closeServer(probe);

  const origin = `http://127.0.0.1:${port}`;
  const hub = createHub({ dir: dataDir, origin });
  await new Promise(resolve => hub.server.listen(port, '127.0.0.1', resolve));

  const chromiumPath =
    process.env.PLAYWRIGHT_CHROMIUM_PATH ||
    process.env.CHROMIUM_PATH ||
    chromium.executablePath();

  assert(existsSync(chromiumPath), `Chromium not found at ${chromiumPath}`);

  const browser = await chromium.launch({
    executablePath: chromiumPath,
    headless: true
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  t.after(async () => {
    await browser.close().catch(() => {});
    await closeServer(hub.server).catch(() => {});
    hub.store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  // 3. Login
  await page.goto(origin);
  await page.fill('input[name="username"]', 'owner');
  await page.fill('input[name="password"]', 'password-owner-1234');
  await page.click('button[type="submit"]');
  await page.waitForSelector('.main');

  // Dismiss onboarding modal if open
  const onboardClose = page.locator('#modal[open] button[data-action="onboard-done"]');
  if (await onboardClose.isVisible({ timeout: 1000 }).catch(() => false)) {
    await onboardClose.click();
  }

  // 4. Verify chat dock toggle button is visible
  const chatToggle = page.locator('[data-action="chat-toggle"]');
  await chatToggle.waitFor({ state: 'visible', timeout: 5000 });
  assert.ok(await chatToggle.isVisible(), 'Floating chat toggle button must be visible');

  // 5. Open chat dock & check unconfigured state
  await chatToggle.click();
  const chatPanel = page.locator('.chat-panel');
  await chatPanel.waitFor({ state: 'visible', timeout: 3000 });

  const unconfiguredNotice = page.locator('.chat-unconfigured');
  assert.ok(await unconfiguredNotice.isVisible(), 'Unconfigured notice should be visible');
  assert.match(await unconfiguredNotice.innerText(), /Chưa cấu hình LLM/);

  // Input should be disabled when unconfigured
  const chatInput = page.locator('#chat-input');
  assert.equal(await chatInput.isDisabled(), true, 'Chat input should be disabled when unconfigured');

  // Click "Cấu hình ngay trong Cài đặt" button in chat dock
  await page.click('[data-action="chat-go-settings"]');
  await page.waitForSelector('#llm-config', { timeout: 3000 });
  assert.equal(page.url().includes('#settings'), true, 'Should navigate to settings');

  // 6. Configure LLM via settings form
  await page.fill('#llm-model', 'gpt-4o');
  await page.fill('#llm-apikey', 'sk-mock-key-12345');
  const patchResponse = page.waitForResponse(
    r => r.url().includes('/api/llm') && r.request().method() === 'PATCH'
  );
  await page.click('#llm-config button[type="submit"]');
  assert.equal((await patchResponse).status(), 200);

  const toast = page.locator('#toast.show');
  await toast.waitFor({ state: 'visible', timeout: 5000 });
  assert.match(await toast.innerText(), /Đã lưu cấu hình LLM/);

  // 7. Test chat interaction with mocked API route
  await page.route('**/api/chat', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        message: {
          role: 'assistant',
          content: 'Tôi sẽ đưa bạn tới trang MCP & kết nối và khoanh vùng nút Thêm MCP.',
          tool_calls: [
            {
              name: 'navigate',
              arguments: { route: 'mcps' }
            },
            {
              name: 'highlight',
              arguments: { selector: '[data-action="add"]' }
            }
          ]
        }
      })
    });
  });

  // Re-open chat dock if closed
  if (!(await chatPanel.isVisible().catch(() => false))) {
    await chatToggle.click();
    await chatPanel.waitFor({ state: 'visible', timeout: 3000 });
  }

  // Input should now be enabled
  await chatInput.waitFor({ state: 'visible' });
  assert.equal(await chatInput.isEnabled(), true, 'Chat input should be enabled after configuring LLM');

  // Type message and submit
  await chatInput.fill('Dẫn tôi đến trang MCP và chỉ cho tôi nút thêm mới');
  const chatResponse = page.waitForResponse(
    r => r.url().includes('/api/chat') && r.request().method() === 'POST'
  );
  await page.click('#chat-form button[type="submit"]');
  assert.equal((await chatResponse).status(), 200);

  // Verify assistant response rendered
  const assistantBubble = page.locator('.chat-msg.assistant .chat-bubble');
  await assistantBubble.waitFor({ state: 'visible', timeout: 5000 });
  assert.match(await assistantBubble.innerText(), /Tôi sẽ đưa bạn tới trang MCP/);

  // Verify tool action badges
  const navBadge = page.locator('.chat-action-badge:has-text("mcps")');
  assert.ok(await navBadge.isVisible(), 'Navigate tool badge should be rendered');

  const highlightBadge = page.locator('.chat-action-badge:has-text("[data-action=\\"add\\"]")');
  assert.ok(await highlightBadge.isVisible(), 'Highlight tool badge should be rendered');

  // Verify page navigated to #mcps
  await page.waitForFunction(() => location.hash === '#mcps', { timeout: 3000 });
  assert.equal(page.url().includes('#mcps'), true, 'Page hash should change to #mcps');

  // Verify element received highlight animation class
  const highlightedBtn = page.locator('[data-action="add"].chat-highlight-pulse');
  await highlightedBtn.waitFor({ state: 'visible', timeout: 3000 });
  assert.ok(await highlightedBtn.isVisible(), 'Target element should have chat-highlight-pulse class');

  // 8. Test toggle minimize
  const closeChatBtn = page.locator('.chat-head-actions [data-action="chat-toggle"]');
  await closeChatBtn.click();
  await chatPanel.waitFor({ state: 'hidden', timeout: 3000 });
  assert.ok(await chatToggle.isVisible(), 'Toggle button must be visible after minimize');
});
