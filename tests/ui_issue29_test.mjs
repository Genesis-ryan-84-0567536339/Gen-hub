import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fixture } from './helpers.mjs';

test('Issue #29: notification bell badge, dropdown, read tracking, and mobile responsiveness', async t => {
  const x = await fixture(t);
  x.hub.store.put('settings', 'main', { name: 'Gen-hub', retention: 30, onboarded: true });

  // Add some test entities and audit logs
  const agent = (await x.call('/api/agents', 'POST', { name: 'Assistant Bot' })).data;
  const mcp = (await x.call('/api/mcps', 'POST', { name: 'Test Connector', provider: 'remote', url: 'http://127.0.0.1:9999' })).data;

  // Add sample audit events
  x.hub.store.audit('owner', 'hub', 'agent.create', 'success', { name: 'Assistant Bot' }, { id: agent.id });
  x.hub.store.audit('owner', mcp.id, 'connection.disconnect', 'success', {}, {});
  x.hub.store.audit(agent.id, 'vault', 'vault.read', 'denied', { id: 'TOP_SECRET' }, {});
  x.hub.store.audit(agent.id, mcp.id, 'execute_task', 'error', {}, {}, 10, 'Connection refused');

  const browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_PATH ||
      process.env.CHROMIUM_PATH ||
      chromium.executablePath(),
    headless: true
  });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  const shots = process.env.UI_SCREENSHOT_DIR;
  if (shots) mkdirSync(shots, { recursive: true });
  const shot = async name => {
    if (shots) await page.screenshot({ path: join(shots, name + '.png'), fullPage: true });
  };

  // 1. Log in
  await page.goto(x.origin, { waitUntil: 'networkidle' });
  await page.fill('input[name=username]', 'owner');
  await page.fill('input[name=password]', 'owner-password-123');
  await page.click('button[type=submit]');
  await page.waitForSelector('.topbar');
  assert.equal(errors.length, 0, 'No JavaScript errors on page load: ' + errors.join('; '));

  // 2. Notification bell and badge present
  const bellBtn = page.locator('.notif-btn');
  await bellBtn.waitFor({ state: 'visible' });
  assert.equal(await bellBtn.getAttribute('aria-label'), 'Thông báo');

  const badge = page.locator('.notif-badge');
  await badge.waitFor({ state: 'visible' });
  const countText = await badge.innerText();
  const count = parseInt(countText, 10);
  assert.ok(count > 0, 'Badge should have unread count > 0, got: ' + countText);

  await shot('notif-badge-initial');

  // 3. Open dropdown by clicking bell
  await bellBtn.click();
  const dropdown = page.locator('.notif-dropdown');
  await dropdown.waitFor({ state: 'visible' });
  assert.equal(await bellBtn.getAttribute('aria-expanded'), 'true');

  // Verify dropdown items
  const items = page.locator('.notif-item');
  const itemCount = await items.count();
  assert.ok(itemCount >= 4, 'Should show at least 4 notification items');

  const textContent = await dropdown.innerText();
  assert.ok(textContent.includes('Thông báo'), 'Dropdown header contains title');
  assert.ok(textContent.includes('Tool call lỗi') || textContent.includes('Từ chối đọc secret'), 'Dropdown contains error notification');

  await shot('notif-dropdown-open');

  // 4. Test "Đánh dấu đã đọc"
  const markReadBtn = page.locator('button[data-action="mark-notifs-read"]');
  if (await markReadBtn.isVisible()) {
    await markReadBtn.click();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.notif-badge').count(), 0, 'Badge should disappear after mark-read');
  }

  // 5. Test Escape key to close
  await page.keyboard.press('Escape');
  await page.waitForSelector('.notif-dropdown', { state: 'detached' });
  assert.equal(await bellBtn.getAttribute('aria-expanded'), 'false');

  // 6. Test navigation on item click
  await bellBtn.click();
  await dropdown.waitFor({ state: 'visible' });
  const firstItem = page.locator('.notif-item').first();
  const targetHref = await firstItem.getAttribute('href');
  await firstItem.click();
  await page.waitForSelector('.notif-dropdown', { state: 'detached' });
  assert.equal(await page.evaluate(() => location.hash), targetHref);

  // 7. Mobile responsiveness
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  await bellBtn.click();
  await dropdown.waitFor({ state: 'visible' });

  const box = await dropdown.boundingBox();
  assert.ok(box.width <= 390, 'Dropdown width must fit within 390px viewport, got: ' + box.width);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  assert.ok(overflow, 'Page should not horizontally overflow on mobile');

  await shot('notif-mobile-view');
  assert.equal(errors.length, 0, 'No page errors throughout test execution: ' + errors.join('; '));
});
