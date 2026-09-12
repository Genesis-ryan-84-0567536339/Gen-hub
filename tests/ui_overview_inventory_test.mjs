import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { fixture } from './helpers.mjs';

test('Overview #75: Agent pie + Tool inventory UI', async t => {
  const x = await fixture(t);

  // Set up two MCPs with published tools
  const mcp1 = {
    id: 'mcp-gh', name: 'GitHub', provider: 'github', on: true, status: 'connected',
    auth: 'token', secret: x.hub.store.seal({ token: 'test' }),
    tools: [
      { name: 'list_issues', published: true, description: '' },
      { name: 'create_issue', published: true, description: '' },
      { name: 'internal_tool', published: false, description: '' }
    ]
  };
  const mcp2 = {
    id: 'mcp-git', name: 'Gitea', provider: 'gitea-mcp', on: true, status: 'connected',
    auth: 'token', secret: x.hub.store.seal({ token: 'test' }),
    tools: [
      { name: 'list_repos', published: true, description: '' }
    ]
  };
  x.hub.store.put('mcp', mcp1.id, mcp1);
  x.hub.store.put('mcp', mcp2.id, mcp2);

  // Set up two agents — one with a call in the last 12h, one without
  const agentA = { id: 'agent-a1', name: 'Agent Alpha', status: 'active', permissions: [] };
  const agentB = { id: 'agent-b1', name: 'Agent Beta', status: 'active', permissions: [] };
  x.hub.store.put('agent', agentA.id, agentA);
  x.hub.store.put('agent', agentB.id, agentB);

  // Agent Alpha called list_issues (12h window call — recent timestamp)
  x.hub.store.audit('agent-a1', 'mcp-gh', 'list_issues', 'success', {}, {});
  // Agent Alpha also called list_repos
  x.hub.store.audit('agent-a1', 'mcp-git', 'list_repos', 'success', {}, {});
  // Agent Beta has NOT called any tool → must not appear in agent pie

  const chromiumPath =
    process.env.PLAYWRIGHT_CHROMIUM_PATH ||
    process.env.CHROMIUM_PATH ||
    (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : chromium.executablePath());

  const browser = await chromium.launch({ executablePath: chromiumPath, headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // Log in
  await page.goto(x.origin);
  await page.fill('#login [name=username]', 'owner');
  await page.fill('#login [name=password]', 'owner-password-123');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('.sidebar');

  // ── Overview page should be default ──────────────────────────────
  // 1. "Hoạt động công cụ" section must exist with 4 pie charts
  await page.waitForSelector('h2:has-text("Hoạt động công cụ")');

  // Count .pie-mini elements — should now be 4 (3 original + 1 new agent pie)
  // Wait for inventory to load first (async)
  await page.waitForSelector('h2:has-text("Tồn kho công cụ")', { timeout: 8000 });

  const pieMinis = await page.locator('.pie-mini').count();
  assert.ok(pieMinis >= 4, `Expected at least 4 pie-mini elements (3 original + 1 agent), got ${pieMinis}`);

  // 2. The 4th pie must be titled "Lượt gọi theo Agent"
  const agentPieTitle = await page.locator('.pie-mini h4:has-text("Lượt gọi theo Agent")').count();
  assert.ok(agentPieTitle >= 1, '"Lượt gọi theo Agent" pie title must be visible');

  // 3. Agent Beta (no calls in 12h) must NOT appear in the agent pie legend
  const legendText = await page.locator('.pie-mini:has(h4:has-text("Lượt gọi theo Agent")) .pie-legend').innerText();
  assert.ok(!legendText.includes('Agent Beta'), 'Agent Beta (0 calls) must not appear in agent pie');
  // Agent Alpha (has calls) must appear
  assert.ok(legendText.includes('Agent Alpha'), 'Agent Alpha must appear in agent pie legend');

  // ── Tool inventory card ──────────────────────────────────────────
  // 4. "Tồn kho công cụ" section must exist
  const inventoryHeading = await page.locator('h2:has-text("Tồn kho công cụ")').count();
  assert.ok(inventoryHeading >= 1, '"Tồn kho công cụ" card must be present');

  // 5. Inventory table must contain published tools
  await page.waitForSelector('h2:has-text("Tồn kho công cụ") ~ * table, section:has(h2:has-text("Tồn kho công cụ")) table', { timeout: 8000 });
  const tableText = await page.locator('section:has(h2:has-text("Tồn kho công cụ"))').innerText();

  assert.ok(tableText.includes('list_issues'), 'list_issues must appear in inventory');
  assert.ok(tableText.includes('create_issue'), 'create_issue must appear in inventory');
  assert.ok(tableText.includes('list_repos'), 'list_repos must appear in inventory');

  // 6. Unpublished tool must NOT appear in inventory
  assert.ok(!tableText.includes('internal_tool'), 'internal_tool (unpublished) must NOT appear in inventory');

  // 7. Tools with 0 calls show "Chưa từng gọi" badge
  assert.ok(tableText.includes('Chưa từng gọi'), 'zero-call tools must show "Chưa từng gọi"');

  // 8. create_issue has 0 calls → should appear at top (sorted ascending)
  // We check that the table starts with zero-call tools
  const rows = await page.locator('section:has(h2:has-text("Tồn kho công cụ")) tbody tr').all();
  assert.ok(rows.length >= 3, `Expected at least 3 table rows, got ${rows.length}`);

  // First row(s) must be "Chưa từng gọi" (callCount=0 first)
  const firstRowText = await rows[0].innerText();
  assert.ok(firstRowText.includes('Chưa từng gọi'), 'First row must have 0 calls (sorted ascending)');

  // 9. No JS errors
  assert.deepEqual(errors, [], `Page JS errors: ${errors.join(', ')}`);
});

test('Overview #75: removing/disabling an MCP removes its tools from inventory', async t => {
  const x = await fixture(t);

  // Prevent onboarding modal from blocking clicks
  x.hub.store.put('settings', 'main', { onboarded: true });

  // MCP that will be marked disconnected
  x.hub.store.put('mcp', 'mcp-removable', {
    id: 'mcp-removable', name: 'Removable', provider: 'github', on: true, status: 'connected',
    auth: 'token', secret: x.hub.store.seal({ token: 'x' }),
    tools: [{ name: 'ghost_tool', published: true, description: '' }]
  });

  const chromiumPath =
    process.env.PLAYWRIGHT_CHROMIUM_PATH ||
    process.env.CHROMIUM_PATH ||
    (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : chromium.executablePath());

  const browser = await chromium.launch({ executablePath: chromiumPath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(10000);

  await page.goto(x.origin);
  await page.fill('#login [name=username]', 'owner');
  await page.fill('#login [name=password]', 'owner-password-123');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('.sidebar');

  // Close any modal that may have appeared (e.g. onboarding)
  const dialogClose = page.locator('#modal button[data-action="close"], #modal button:has-text("Đóng"), #modal button:has-text("Bỏ qua")');
  if (await dialogClose.count() > 0) {
    await dialogClose.first().click();
    await page.waitForTimeout(300);
  }

  // Inventory should initially show ghost_tool
  await page.waitForSelector('h2:has-text("Tồn kho công cụ")', { timeout: 8000 });
  await page.waitForSelector('section:has(h2:has-text("Tồn kho công cụ")) table', { timeout: 8000 });
  let text = await page.locator('section:has(h2:has-text("Tồn kho công cụ"))').innerText();
  assert.ok(text.includes('ghost_tool'), 'ghost_tool must appear before MCP is removed');

  // Now disconnect the MCP (simulate by setting status to error)
  x.hub.store.put('mcp', 'mcp-removable', {
    id: 'mcp-removable', name: 'Removable', provider: 'github', on: true, status: 'error',
    auth: 'token', secret: x.hub.store.seal({ token: 'x' }),
    tools: [{ name: 'ghost_tool', published: true, description: '' }]
  });

  // Dismiss any modal before clicking refresh
  const modal = page.locator('#modal[open]');
  if (await modal.count() > 0) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }

  // Refresh
  await page.locator('[data-action="refresh"]').first().click();
  await page.waitForTimeout(500);
  await page.waitForSelector('h2:has-text("Tồn kho công cụ")', { timeout: 8000 });
  // Wait for inventory to reload (async)
  await page.waitForTimeout(2000);

  text = await page.locator('section:has(h2:has-text("Tồn kho công cụ"))').innerText();
  assert.ok(!text.includes('ghost_tool'), 'ghost_tool must NOT appear after MCP is disconnected');
});

