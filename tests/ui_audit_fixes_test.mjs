import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { fixture } from './helpers.mjs';

test('Audit Fixes UI: Settings defaults normalization, KPI agent-only calls, and Admin copy endpoint', async t => {
  const x = await fixture(t);
  // Incomplete settings record: onboarded is true, but retention and name are omitted (Audit C3 scenario)
  x.hub.store.put('settings', 'main', { onboarded: true });

  const chromiumPath =
    process.env.PLAYWRIGHT_CHROMIUM_PATH ||
    process.env.CHROMIUM_PATH ||
    (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : chromium.executablePath());

  const browser = await chromium.launch({
    executablePath: chromiumPath,
    headless: true
  });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // 1. Log in
  await page.goto(x.origin);
  await page.fill('#login [name=username]', 'owner');
  await page.fill('#login [name=password]', 'owner-password-123');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('.sidebar');

  // Intercept clipboard to capture copied texts
  await page.evaluate(() => {
    window.__copied = [];
    navigator.clipboard.writeText = async text => {
      window.__copied.push(text);
    };
  });

  // 2. Test KPI "Tool calls" on Overview (Audit Fix 2 - 5.2)
  // At this point, owner just logged in, so an owner.login event exists in audit.
  // Real agent tool calls = 0. KPI must display 0.
  await page.waitForSelector('.monitor-stats .stat');
  const kpiValue = await page.locator('.monitor-total').innerText();
  assert(kpiValue.startsWith('0'), `KPI should be 0 calls initially, got: "${kpiValue}"`);

  // Insert a genuine agent tool-call
  x.hub.store.audit('agt-12345', 'mcp-1', 'list_tools', 'success', {}, {});

  // Refresh data
  await page.locator('[data-action="refresh"]').first().click();
  await page.waitForTimeout(500);

  const updatedKpiValue = await page.locator('.monitor-total').innerText();
  assert(updatedKpiValue.startsWith('1'), `KPI should update to 1 call, got: "${updatedKpiValue}"`);

  // 3. Test Settings form defaults (Audit Fix 1 - C3)
  await page.goto(x.origin + '/#settings');
  await page.waitForSelector('form#settings');

  const hubName = await page.locator('form#settings input[name="name"]').inputValue();
  assert.equal(hubName, 'Gen-hub', 'Tên Hub phải được chuẩn hóa về "Gen-hub"');

  const selectedRetention = await page
    .locator('form#settings select[name="retention"]')
    .inputValue();
  assert.equal(
    selectedRetention,
    '30',
    'Lưu nhật ký phải chọn 30 ngày theo mặc định chuẩn hóa (không phải 7 ngày)'
  );

  // 4. Test Copy endpoint contexts (Audit Fix 3 - C4)
  // 4a. Admin Assistant copy button
  await page.locator('[data-action="select:settings:assistant"]').click();
  await page.waitForSelector('.codecopy button[data-action="copyendpoint:admin"]');

  await page.locator('.codecopy button[data-action="copyendpoint:admin"]').click();
  await page.waitForTimeout(200);

  const adminCopied = await page.evaluate(() => window.__copied[window.__copied.length - 1]);
  assert.equal(
    adminCopied,
    `${x.origin}/mcp/admin`,
    `Nút copy tại Trợ lý quản trị phải copy admin endpoint (${x.origin}/mcp/admin), nhận được: ${adminCopied}`
  );

  // 4b. Standard copy button on Overview
  await page.goto(x.origin + '/#overview');
  await page.waitForSelector('.endpointbar .codecopy button[data-action="copyendpoint"]');

  await page.locator('.endpointbar .codecopy button[data-action="copyendpoint"]').click();
  await page.waitForTimeout(200);

  const standardCopied = await page.evaluate(() => window.__copied[window.__copied.length - 1]);
  assert.equal(
    standardCopied,
    `${x.origin}/mcp`,
    `Nút copy tại Overview phải copy standard endpoint (${x.origin}/mcp), nhận được: ${standardCopied}`
  );

  assert.equal(errors.length, 0, `Page errors encountered: ${errors.join(', ')}`);
});
