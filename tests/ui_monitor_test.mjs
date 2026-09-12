import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { fixture } from './helpers.mjs';
import { seedMonitor } from './monitor-fixture.mjs';

test('Integrated Monitor: real request → audit → permissions, inventory and mobile layout', async t => {
  let release, entered;
  const gate = new Promise(r => (release = r)),
    started = new Promise(r => (entered = r));
  t.after(() => release());
  const x = await fixture(t, {
    call: async () => {
      entered();
      await gate;
      return { content: [{ type: 'text', text: 'Kết quả kiểm tra Monitor' }] };
    }
  });
  seedMonitor(x.hub.store);
  const worker = (
    await x.call('/api/agents', 'POST', { name: 'Monitor Worker', permissions: ['mcp-one:echo'] })
  ).data;
  const browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_PATH ||
      process.env.CHROMIUM_PATH ||
      chromium.executablePath(),
    headless: true
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(x.origin);
  await page.fill('#login [name=username]', 'owner');
  await page.fill('#login [name=password]', 'owner-password-123');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('#monitor-body .monitor-total');
  const pending = x.call(
    '/mcp',
    'POST',
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'mcp-one__echo', arguments: { text: 'Đầu vào kiểm tra' } }
    },
    { Authorization: 'Bearer ' + worker.token }
  );
  await started;
  await page.click('[data-action="monitor-tab:flows"]');
  await page.click('[data-action="monitor-refresh"]');
  await page.locator('[data-action^="monitor-operation:"]').click();
  await page.waitForSelector('#monitor-detail .monitor-timeline .current');
  assert.match(await page.locator('#monitor-detail').innerText(), /Đang xử lý/);
  release();
  await pending;
  await page.waitForFunction(() =>
    document.querySelector('#monitor-detail')?.textContent.includes('Thành công')
  );
  await page.click('[data-action="monitor-detail-tab:output"]');
  assert.match(await page.locator('#monitor-detail pre').innerText(), /Kết quả kiểm tra Monitor/);
  await page.click(`[data-action="monitor-manage:agents:${worker.id}:grants"]`);
  await page.waitForSelector('#grants');
  assert.equal(await page.locator('#grants input[value="mcp-one:echo"]').isChecked(), true);
  await page.goto(x.origin + '/#overview');
  await page.waitForSelector('[data-action="monitor-tab:overview"]');
  await page.click('[data-action="monitor-tab:overview"]');
  await page.waitForSelector('#monitor-body .monitor-total');
  await page.click('[data-action="monitor-tab:tools"]');
  assert.equal(await page.locator('.monitor-tool').count(), 6);
  await page.selectOption('#monitor-tool-filter', 'unpublished');
  assert.equal(await page.locator('.monitor-tool').count(), 2);
  await page.click('[data-action="monitor-tab:overview"]');
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1
    );
    assert.equal(overflow, false, 'Overview horizontal overflow at ' + width);
  }
  await page.click('[data-action="monitor-tab:tools"]');
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
    false
  );
  await page.click('[data-action="monitor-ask"]');
  await page.waitForSelector('.chat-unconfigured');
  assert.deepEqual(errors, []);
});
