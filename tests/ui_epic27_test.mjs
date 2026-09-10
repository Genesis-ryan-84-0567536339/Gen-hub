import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fixture } from './helpers.mjs';

test('Issue #27: real browser list/detail tabs, edits, grants, filtered activity, charts and mobile layout', async t => {
  const x = await fixture(t);
  x.hub.store.put('settings', 'main', { name: 'Gen-hub', retention: 30, onboarded: true });
  await x.call('/api/security/pin', 'POST', { password: 'owner-password-123', pin: '8492' });
  const a = (await x.call('/api/agents', 'POST', { name: 'Agent Alpha' })).data;
  const b = (await x.call('/api/agents', 'POST', { name: 'Agent Beta' })).data;
  const secret = (
    await x.call('/api/vault', 'POST', { name: 'Key Alpha', secret: 'never-in-page' })
  ).data;
  const otherSecret = (
    await x.call('/api/vault', 'POST', { name: 'Key Beta', secret: 'other-secret' })
  ).data;
  const mcp = (await x.call('/api/mcps', 'POST', { provider: 'github' })).data;
  const record = x.hub.store.get('mcp', mcp.id);
  record.status = 'connected';
  record.tools = [
    {
      name: 'read',
      description: 'Đọc thử',
      published: true,
      inputSchema: { type: 'object', properties: {} }
    }
  ];
  x.hub.store.put('mcp', mcp.id, record);
  x.hub.store.audit(
    a.id,
    mcp.id,
    'read',
    'success',
    { q: 'Tiếng Việt' },
    { answer: 'Đã đọc', token: '[REDACTED]' }
  );
  const oldLog = x.hub.store.logs(1)[0].id;
  x.hub.store.audit(a.id, 'vault', 'vault.read', 'success', { id: secret.id }, {});
  // Selected records must remain discoverable beyond the 200-row dashboard feed.
  for (let i = 0; i < 205; i++)
    x.hub.store.audit(b.id, 'vault', 'vault.read', 'success', { id: otherSecret.id }, {});
  const browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_PATH ||
      process.env.CHROMIUM_PATH ||
      chromium.executablePath(),
    headless: true
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const shots = process.env.UI_SCREENSHOT_DIR;
  if (shots) mkdirSync(shots, { recursive: true });
  const shot = async name => {
    if (shots) await page.screenshot({ path: join(shots, name + '.png'), fullPage: true });
  };
  const click = action => page.locator(`[data-action="${action}"]`).first().click();
  const tab = name => click('detail-tab:' + name);
  const navigate = async route => {
    await page.goto(x.origin + '/#' + route);
    await page.waitForSelector('.entity-layout');
  };
  const noModal = async () => assert.equal(await page.locator('#modal[open]').count(), 0);
  const save = async (form, url) => {
    const response = page.waitForResponse(
      r => r.url().endsWith(url) && r.request().method() === 'PATCH'
    );
    await page.locator(form + ' button[type=submit]').click();
    assert.equal((await response).status(), 200);
    await page.waitForFunction(() =>
      document.querySelector('#toast.show')?.textContent.startsWith('Đã lưu')
    );
  };
  await page.goto(x.origin);
  await page.fill('#login [name=username]', 'owner');
  await page.fill('#login [name=password]', 'owner-password-123');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('.sidebar');
  await navigate('agents');
  await click('select:agents:' + a.id);
  await noModal();
  const left = await page.locator('.entity-list').boundingBox();
  const right = await page.locator('.entity-detail').boundingBox();
  assert(left.x + left.width < right.x);
  await page.fill('#agent-info [name=name]', 'Agent Alpha mới');
  await page.fill(
    '#agent-info [name=description]',
    '<script>window.injected = true</script> Mô tả'
  );
  await page.fill(
    '#agent-info [name=instructions]',
    'Hãy đọc hướng dẫn riêng.\nGiữ nguyên dòng này.'
  );
  await save('#agent-info', '/api/agents/' + a.id);
  await page.waitForSelector('.entity-detail h2:has-text("Agent Alpha mới")');
  assert.equal(
    x.hub.store.get('agent', a.id).instructions,
    'Hãy đọc hướng dẫn riêng.\nGiữ nguyên dòng này.'
  );
  await shot('agent-info-desktop');
  await tab('grants');
  await page.check(`#grants [value="${mcp.id}:read"]`);
  await page.check(`#grants [value="vault:${secret.id}"]`);
  await save('#grants', '/api/agents/' + a.id);
  assert.deepEqual(
    x.hub.store.get('agent', a.id).permissions.sort(),
    [mcp.id + ':read', 'vault:' + secret.id].sort()
  );
  await page.selectOption('#test [name=tool]', mcp.id + ':read');
  await page.click('#test button[type=submit]');
  await page.waitForSelector('#test-result h3:has-text("Cho phép")');
  await shot('agent-grants-desktop');
  await tab('logs');
  await page.waitForSelector(`[data-action="log:${oldLog}"]`);
  assert.equal(await page.locator('#entity-detail tbody tr').count(), 2);
  await click('log:' + oldLog);
  await page.waitForSelector('#modal[open] .json');
  assert.match(await page.locator('#modal .json').textContent(), /Tiếng Việt/);
  await click('close');
  await tab('stats');
  await page.waitForSelector('.audit-chart');
  assert.equal(await page.locator('.audit-chart').count(), 2);
  // Zero byte bars must stay zero (avoid collisions with the global .input form class).
  assert.equal(
    await page
      .locator('.payload-bar')
      .first()
      .evaluate(el => el.getBoundingClientRect().height),
    0
  );
  assert.equal(
    await page
      .locator('.payload-bar')
      .evaluateAll(els => els.filter(el => el.getBoundingClientRect().height > 0).length),
    4
  );

  await page.locator('.stats-data summary').click();
  assert.equal(await page.locator('.stats-data tbody tr').count(), 2);
  await shot('agent-stats-desktop');
  await page.selectOption('#activity-hours', '24');
  await page.waitForSelector('.audit-chart');
  assert.equal(await page.locator('.pie-chart').count(), 1);
  assert.equal(await page.locator('.pie-slice').count(), 2);
  assert.equal(await page.locator('.payload-group').count(), 25);
  // Retry a failed request, then switch entities while an older request is outstanding.
  await page.route('**/api/logs?**', route => route.abort(), { times: 1 });
  await click('activity-reload');
  await page.waitForSelector('#entity-detail [role=alert]');
  await click('activity-reload');
  await page.waitForSelector('.audit-chart');
  let delayed;
  await page.route(
    '**/api/logs?**',
    route => {
      delayed = route;
    },
    { times: 1 }
  );
  const pending = page.waitForRequest(request => request.url().includes('/api/logs?'));
  await click('activity-reload');
  await pending;
  await click('select:agents:' + b.id);
  await tab('logs');
  await page.waitForSelector('#entity-detail tbody tr');
  assert.equal(await page.locator('#entity-detail tbody tr').count(), 205);
  await delayed.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([
      {
        id: 999999,
        actor: a.id,
        mcp: 'other',
        tool: 'WRONG-OLD-RESPONSE',
        created: new Date().toISOString(),
        input: {},
        output: {}
      }
    ])
  });
  assert(!(await page.locator('#entity-detail').textContent()).includes('WRONG-OLD-RESPONSE'));
  await click('select:agents:' + a.id);
  await tab('stats');
  await page.selectOption('#activity-hours', '168');
  await page.waitForSelector('.audit-chart');

  // Keyboard tabs and per-entity selection isolation.
  await page.locator('#detail-tab-stats').focus();
  await page.keyboard.press('Home');
  await page.waitForSelector('#agent-info');
  await click('select:agents:' + b.id);
  assert.equal(await page.inputValue('#agent-info [name=instructions]'), '');
  await page.fill('#search', 'no-match-27');
  await page.waitForSelector('.entity-detail h3:has-text("Chưa có mục được chọn")');
  await page.fill('#search', '');
  await navigate('mcps');
  await click('select:mcps:' + mcp.id);
  await noModal();
  await tab('tools');
  await click('publish:' + mcp.id + ':read');
  await page.waitForSelector(`[data-action="publish:${mcp.id}:read"][aria-checked=false]`);
  assert.equal(x.hub.store.get('mcp', mcp.id).tools[0].published, false);
  await click('publish:' + mcp.id + ':read');
  await page.waitForSelector(`[data-action="publish:${mcp.id}:read"][aria-checked=true]`);
  await tab('logs');
  await page.waitForSelector(`[data-action="log:${oldLog}"]`);
  const tools = await page.locator('#entity-detail tbody tr td:nth-child(3)').allTextContents();
  assert(tools.every(text => !text.includes('vault.read')));
  await tab('stats');
  await page.waitForSelector('.audit-chart');
  await shot('connector-stats-desktop');
  await navigate('vault');
  await click('select:vault:' + secret.id);
  await noModal();
  assert(!(await page.content()).includes('never-in-page'));
  await page.fill('#vault-save [name=name]', 'Key Alpha mới');
  await save('#vault-save', '/api/vault/' + secret.id);
  await page.waitForSelector('.entity-detail h2:has-text("Key Alpha mới")');
  await tab('sharing');
  await page.selectOption('#vault-share [name=sharing]', 'selected');
  await page.check(`#vault-share [value="${b.id}"]`);
  const shareResponse = page.waitForResponse(r => r.url().endsWith('/grants'));
  await page.click('#vault-share button[type=submit]');
  assert.equal((await shareResponse).status(), 200);
  await page.waitForSelector(`#vault-share [value="${b.id}"]:checked`);
  assert(x.hub.store.get('agent', b.id).permissions.includes('vault:' + secret.id));
  assert(x.hub.store.get('agent', a.id).permissions.includes(mcp.id + ':read'));
  await tab('logs');
  await page.waitForSelector('#entity-detail tbody tr');
  assert.equal(await page.locator('#entity-detail tbody tr').count(), 1);
  await shot('vault-logs-desktop');
  await tab('info');
  await click('vault-reveal:' + secret.id);
  await click('do-vault-reveal:' + secret.id);
  await page.waitForSelector('#vault-value');
  assert.equal(await page.inputValue('#vault-value'), 'never-in-page');
  await click('close');
  assert(!(await page.content()).includes('never-in-page'));
  // Dialog context must not affect the subsequent inline edit target.
  await page.fill('#vault-save [name=name]', 'Key Alpha sau đọc');
  await save('#vault-save', '/api/vault/' + secret.id);
  await page.waitForSelector('.entity-detail h2:has-text("Key Alpha sau đọc")');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot('vault-mobile');
  for (const route of ['agents', 'mcps', 'vault', 'settings']) {
    await navigate(route);
    if (route === 'agents' || route === 'mcps') {
      if (route === 'agents') await click('select:agents:' + a.id);
      await tab('stats');
      await page.waitForSelector('.audit-chart');
    }
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      route + ' overflows mobile viewport'
    );
    await shot(route + '-mobile');
  }
  await click('select:settings:security');
  await page.waitForSelector('[data-action="pin-setup"]');
  await click('select:settings:assistant');
  await page.waitForSelector('h2:has-text("Trợ lý AI quản trị")');
  await click('select:settings:general');
  await tab('endpoint');
  await page.waitForSelector('.entity-detail h2:has-text("Domain & endpoint")');
  // Deletion retains the PIN gate and selects a surviving item afterward.
  await navigate('vault');
  await click('select:vault:' + secret.id);
  await click('vault-delete:' + secret.id);
  await page.fill('#confirm-pin', '8492');
  await click('do-vault-delete:' + secret.id);
  await page.waitForSelector(`.entity-row[data-action="select:vault:${secret.id}"]`, {
    state: 'detached'
  });
  await page.waitForSelector(`form#vault-save[data-id="${otherSecret.id}"]`);
  assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.deepEqual(errors, []);
});
