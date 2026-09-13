import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { fixture } from './helpers.mjs';
import { seedMonitor } from './monitor-fixture.mjs';

test('Approved Monitor layout, inline tool details and bulk grants across viewports', async t => {
  const x = await fixture(t); const s = x.hub.store; seedMonitor(s);
  for (const [id, name] of [['agent-one', 'Claude Code'], ['agent-two', 'Codex']])
    s.put('agent', id, { ...s.get('agent', id), name });
  for (const [id, name] of [['mcp-one', 'GitHub'], ['mcp-two', 'Notion']])
    s.put('mcp', id, { ...s.get('mcp', id), name });
  for (const [id, name] of [['agent-three', 'Claude Desktop'], ['agent-four', 'Agent thử nghiệm']])
    s.put('agent', id, { id, name, status: 'active', permissions: [] });
  for (const [id, name] of [['mcp-three', 'Google Drive'], ['mcp-four', 'Search'], ['mcp-five', 'Calendar']])
    s.put('mcp', id, { ...s.get('mcp', 'mcp-one'), id, name, tools: [{ name: 'search', published: true, inputSchema: { type: 'object' } }] });
  s.put('vault', 'example', { id: 'example', name: 'Khóa dịch vụ', secret: s.seal({ secret: 'synthetic-only' }) });
  for (let i = 0; i < 13; i++) s.audit('agent-one', 'mcp-one', 'echo', 'success', { text: 'Kiểm tra đầu vào' }, { ok: true });
  for (let i = 0; i < 9; i++) s.audit('agent-two', 'mcp-two', 'echo', 'success', {}, { ok: true });
  for (let i = 0; i < 5; i++) s.audit('agent-three', 'mcp-three', 'search', 'success', {}, {});
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || process.env.CHROMIUM_PATH || chromium.executablePath(), headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.setDefaultTimeout(10000);
  const folder = process.env.UI_SCREENSHOT_DIR;
  if (folder) mkdirSync(folder, { recursive: true });
  const screenshot = async name => {
    if (folder) await page.screenshot({ path: join(folder, name + '.png'), fullPage: true });
  };
  await page.goto(x.origin);
  await page.fill('#login [name=username]', 'owner');
  await page.fill('#login [name=password]', 'owner-password-123');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('.monitor-wires path');
  assert.equal(await page.locator('.monitor-wires path').count(), 3);
  assert.equal(await page.locator('.monitor-stats .stat').count(), 4);
  assert.equal(await page.locator('.monitor-table thead th').count(), 4);
  const positions = await page.evaluate(() => {
    const y = sel => document.querySelector(sel).getBoundingClientRect().top;
    return [y('.monitor-toolbar'), y('.endpointbar'), y('.monitor-stats'), y('.monitor-pair'), y('.monitor-table')];
  });
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  await screenshot('monitor-desktop');
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.waitForFunction(() => document.querySelector('.monitor-wires')?.viewBox.baseVal.width === document.querySelector('.monitor-map')?.getBoundingClientRect().width);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await screenshot('monitor-' + width);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.click('.monitor-node[data-action="monitor-actor:agent-one"]');
  await page.waitForSelector('.monitor-node.selected');
  assert.equal(await page.locator('.monitor-node').count(), 9, 'Selection dims, does not remove nodes');
  assert.ok(await page.locator('.monitor-node.dim').count() > 0);
  await screenshot('monitor-selected');
  await page.locator('[data-action="monitor-ask"]').first().click();
  await page.waitForSelector('.chat-unconfigured');
  await screenshot('monitor-chat');
  await page.click('[data-action="monitor-clear"]');
  await page.waitForSelector('.monitor-donut');
  await page.click('[data-action="monitor-tab:tools"]');
  await page.locator('.monitor-tool [data-action^="monitor-tool:"]').first().click();
  await page.waitForSelector('.monitor-tool-detail');
  await screenshot('monitor-tool-detail');
  await page.locator('.monitor-tool-detail [data-action^="bulk-grants:"]').click();
  await page.waitForSelector('#bulk-grants');
  assert.equal(await page.locator('#bulk-grants [name=permissions]:checked').count(), 1);
  assert.equal(await page.locator('#bulk-grants [name=permissions][value^="vault:"]').count(), 0);
  await page.check('#bulk-grants [name=agentIds][value="agent-one"]');
  await page.check('#bulk-grants [name=agentIds][value="agent-two"]');
  await page.locator('#bulk-grants .toolgroup').first().evaluate(el => el.open = true);
  await page.check('#bulk-grants [name=permissions][value="mcp-one:unused"]');
  const beforeOne = [...s.get('agent', 'agent-one').permissions];
  const beforeTwo = [...s.get('agent', 'agent-two').permissions];
  await page.click('#bulk-grants [type=submit]');
  await page.waitForSelector('.bulk-preview');
  assert.deepEqual(s.get('agent', 'agent-one').permissions, beforeOne);
  assert.deepEqual(s.get('agent', 'agent-two').permissions, beforeTwo);
  await screenshot('bulk-grants-preview');
  // Any selection change invalidates confirmation, including quick-select buttons.
  await page.click('[data-action="grant-none:all"]');
  assert.equal(await page.locator('[data-action="bulk-apply"]').isDisabled(), true);
  await page.check('#bulk-grants [name=permissions][value="mcp-one:unused"]');
  await page.click('#bulk-grants [type=submit]');
  await page.waitForSelector('.bulk-preview');
  await page.click('[data-action="bulk-apply"]');
  await page.waitForSelector('#modal h2:has-text("Đã cấp quyền hàng loạt")');
  assert.deepEqual(s.get('agent', 'agent-one').permissions, [...beforeOne, 'mcp-one:unused']);
  assert.deepEqual(s.get('agent', 'agent-two').permissions, [...beforeTwo, 'mcp-one:unused']);
  await screenshot('bulk-grants-complete');
  await page.locator('#modal [data-action="close"]').first().click();
  // Capture the approved immutable reference using the same browser/viewports.
  if (folder) {
    const reference = await browser.newPage();
    await reference.setContent(readFileSync('docs/design/gen-hub-integrated-monitor.html', 'utf8'));
    for (const width of [1440, 1024, 390]) {
      await reference.setViewportSize({ width, height: width === 1440 ? 1000 : width === 390 ? 844 : 900 });
      await reference.screenshot({ path: join(folder, 'approved-' + width + '.png'), fullPage: true });
    }
    await reference.close();
  }
  assert.deepEqual(errors, []);
});
