import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { fixture } from './helpers.mjs';

test('Issue #51: Collapsible connector groups and quick action grant buttons (all / basic / none)', async t => {
  const x = await fixture(t);
  x.hub.store.put('settings', 'main', { name: 'Gen-hub', retention: 30, onboarded: true });

  // 1. Create GitHub MCP with 46 tools (mix of readonly and write)
  const ghTools = [];
  for (let i = 1; i <= 46; i++) {
    ghTools.push({
      name: `gh_tool_${i}`,
      description: `GitHub operation tool ${i}`,
      inputSchema: { type: 'object', properties: {} },
      permission: { status: 'ok', reason: 'Khả dụng' },
      published: true,
      annotations: { readOnlyHint: i % 2 === 0 } // 23 read-only, 23 write
    });
  }
  const mcpGh = (await x.call('/api/mcps', 'POST', { provider: 'github-mcp', name: 'GitHub MCP' }))
    .data;
  const mcpGhRecord = x.hub.store.get('mcp', mcpGh.id);
  mcpGhRecord.status = 'connected';
  mcpGhRecord.tools = ghTools;
  x.hub.store.put('mcp', mcpGh.id, mcpGhRecord);

  // 2. Create Slack connector with 4 tools (2 readonly, 2 write)
  const slackTools = [
    {
      name: 'list_channels',
      description: 'List public channels',
      inputSchema: {},
      permission: { status: 'ok' },
      published: true,
      annotations: { readOnlyHint: true }
    },
    {
      name: 'read_history',
      description: 'Read conversation history',
      inputSchema: {},
      permission: { status: 'ok' },
      published: true,
      annotations: { readOnlyHint: true }
    },
    {
      name: 'post_message',
      description: 'Post message to channel',
      inputSchema: {},
      permission: { status: 'ok' },
      published: true,
      annotations: { readOnlyHint: false }
    },
    {
      name: 'delete_message',
      description: 'Delete message',
      inputSchema: {},
      permission: { status: 'ok' },
      published: true,
      annotations: { readOnlyHint: false }
    }
  ];
  const mcpSlack = (await x.call('/api/mcps', 'POST', { provider: 'slack', name: 'Slack' })).data;
  const mcpSlackRecord = x.hub.store.get('mcp', mcpSlack.id);
  mcpSlackRecord.status = 'connected';
  mcpSlackRecord.tools = slackTools;
  x.hub.store.put('mcp', mcpSlack.id, mcpSlackRecord);

  // 3. Create test agent
  const agent = (await x.call('/api/agents', 'POST', { name: 'Audit Agent' })).data;

  // 4. Launch browser
  const chromiumPath =
    process.env.PLAYWRIGHT_CHROMIUM_PATH ||
    process.env.CHROMIUM_PATH ||
    '/usr/bin/google-chrome' ||
    chromium.executablePath();

  const browser = await chromium.launch({
    executablePath: chromiumPath,
    headless: true
  });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // Log in
  await page.goto(x.origin);
  await page.fill('#login [name=username]', 'owner');
  await page.fill('#login [name=password]', 'owner-password-123');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('.topbar');

  // Navigate to Agents -> select agent -> Phân quyền tab
  await page.click('.sidebar a[href="#agents"]');
  await page.waitForSelector('.entity-layout');
  await page.click(`[data-action="select:agents:${agent.id}"]`);
  await page.click('[data-action="detail-tab:grants"]');
  await page.waitForSelector('#grants');

  // Verify collapsible details elements exist and are closed initially
  const details = page.locator('#grants details.toolgroup');
  assert.equal(await details.count(), 2, 'Must have 2 connector accordion groups');

  const ghGroup = page.locator(`#grants details.toolgroup[data-mcp="${mcpGh.id}"]`);
  const slackGroup = page.locator(`#grants details.toolgroup[data-mcp="${mcpSlack.id}"]`);

  assert.equal(
    await ghGroup.getAttribute('open'),
    null,
    'GitHub MCP group must be collapsed initially'
  );
  assert.equal(
    await slackGroup.getAttribute('open'),
    null,
    'Slack group must be collapsed initially'
  );

  // Check initial badges on summary
  const ghBadge = ghGroup.locator('.grant-count');
  const slackBadge = slackGroup.locator('.grant-count');
  assert.equal(await ghBadge.innerText(), '0/46 tool đã cấp');
  assert.equal(await slackBadge.innerText(), '0/4 tool đã cấp');

  // Click summary to expand GitHub MCP group
  await ghGroup.locator('summary.toolgrouphead').click();
  assert.equal(await ghGroup.getAttribute('open'), '', 'GitHub MCP group must be open after click');

  // Verify group-level action buttons exist
  const btnAll = ghGroup.locator(`button[data-action="grant-all:${mcpGh.id}"]`);
  const btnBasic = ghGroup.locator(`button[data-action="grant-basic:${mcpGh.id}"]`);
  const btnNone = ghGroup.locator(`button[data-action="grant-none:${mcpGh.id}"]`);

  assert.ok(await btnAll.isVisible(), 'Cấp quyền toàn bộ button must be visible');
  assert.ok(await btnBasic.isVisible(), 'Cấp quyền cơ bản button must be visible');
  assert.ok(await btnNone.isVisible(), 'Thu hồi toàn bộ button must be visible');

  // Click "Cấp quyền toàn bộ" for GitHub MCP group
  await btnAll.click();
  const ghCheckedAll = await ghGroup.locator('input[name="permissions"]:checked').count();
  assert.equal(ghCheckedAll, 46, 'All 46 tools must be checked');
  assert.equal(await ghBadge.innerText(), '46/46 tool đã cấp', 'Badge must update to 46/46');
  // Slack must remain untouched
  assert.equal(await slackGroup.locator('input[name="permissions"]:checked').count(), 0);
  assert.equal(await slackBadge.innerText(), '0/4 tool đã cấp');

  // Click "Cấp quyền cơ bản" for GitHub MCP group (only readonly tools: 23 tools)
  await btnBasic.click();
  const ghCheckedBasic = await ghGroup.locator('input[name="permissions"]:checked').count();
  assert.equal(ghCheckedBasic, 23, 'Only 23 read-only tools must be checked');
  assert.equal(await ghBadge.innerText(), '23/46 tool đã cấp', 'Badge must update to 23/46');

  // Click "Thu hồi toàn bộ" for GitHub MCP group
  await btnNone.click();
  const ghCheckedNone = await ghGroup.locator('input[name="permissions"]:checked').count();
  assert.equal(ghCheckedNone, 0, 'All tools must be unchecked');
  assert.equal(await ghBadge.innerText(), '0/46 tool đã cấp', 'Badge must update to 0/46');

  // Manually check 2 checkboxes and verify dynamic badge update
  await ghGroup.locator('input[name="permissions"]').nth(0).check();
  await ghGroup.locator('input[name="permissions"]').nth(1).check();
  assert.equal(
    await ghBadge.innerText(),
    '2/46 tool đã cấp',
    'Badge updates to 2/46 on individual check'
  );

  // Test global toolbar
  const globalToolbar = page.locator('#grants .grant-toolbar');
  assert.ok(await globalToolbar.isVisible(), 'Global grant toolbar must be visible');

  // Global "Cấp quyền toàn bộ"
  await page.click('#grants button[data-action="grant-all:all"]');
  assert.equal(await ghGroup.locator('input[name="permissions"]:checked').count(), 46);
  assert.equal(await slackGroup.locator('input[name="permissions"]:checked').count(), 4);
  assert.equal(await ghBadge.innerText(), '46/46 tool đã cấp');
  assert.equal(await slackBadge.innerText(), '4/4 tool đã cấp');

  // Global "Cấp quyền cơ bản" (23 for GH, 2 for Slack = 25 total)
  await page.click('#grants button[data-action="grant-basic:all"]');
  assert.equal(await ghGroup.locator('input[name="permissions"]:checked').count(), 23);
  assert.equal(await slackGroup.locator('input[name="permissions"]:checked').count(), 2);
  assert.equal(await ghBadge.innerText(), '23/46 tool đã cấp');
  assert.equal(await slackBadge.innerText(), '2/4 tool đã cấp');

  // Global "Mở / Thu gọn tất cả"
  await page.click('#grants button[data-action="grant-toggle-expand"]');
  assert.equal(await ghGroup.getAttribute('open'), '', 'Both should be open');
  assert.equal(await slackGroup.getAttribute('open'), '', 'Both should be open');

  // Save permissions to server
  const savePromise = page.waitForResponse(
    r => r.url().includes('/api/agents/' + agent.id) && r.request().method() === 'PATCH'
  );
  await page.click('#grants button[type=submit]');
  const saveRes = await savePromise;
  assert.equal(saveRes.status(), 200);

  // Verify backend store persisted exactly the 25 basic (read-only) tools
  const updatedAgent = x.hub.store.get('agent', agent.id);
  assert.equal(updatedAgent.permissions.length, 25);
  assert.ok(updatedAgent.permissions.includes(`${mcpSlack.id}:list_channels`));
  assert.ok(updatedAgent.permissions.includes(`${mcpSlack.id}:read_history`));
  assert.ok(!updatedAgent.permissions.includes(`${mcpSlack.id}:post_message`));

  assert.equal(errors.length, 0, 'No console errors during test: ' + errors.join('; '));
});
