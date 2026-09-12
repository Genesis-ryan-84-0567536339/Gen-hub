import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { fixture } from './helpers.mjs';

test(
  'Dashboard C UI: 32 calls, categories, p95, empty samples, exact drill-down/export, stale fetch and mobile',
  { timeout: 60000 },
  async t => {
    const x = await fixture(t);
    x.hub.store.put('settings', 'main', { onboarded: true });
    const browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/usr/bin/google-chrome',
      headless: true
    });
    t.after(() => browser.close());
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true
    });
    page.setDefaultTimeout(8000);
    const errors = [],
      requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => {
      if (r.url().includes('/api/logs')) requests.push(r.url());
    });
    await page.goto(x.origin);
    await page.fill('#login [name=username]', 'owner');
    await page.fill('#login [name=password]', 'owner-password-123');
    await page.click('#login button[type=submit]');
    const calls = page.locator('.operations-kpis .stat').first();
    await page.waitForSelector('.operations-kpis');
    assert.match(await calls.innerText(), /Tool calls\n0/);
    assert.match(await page.locator('.operations-kpis').innerText(), /Không có mẫu/);
    assert.match(await page.locator('.operations-kpis').innerText(), /N\/A · n=0/);
    const store = x.hub.store;
    // Same recorded hour, older than the initial load to exercise an exact bucket.
    const created = new Date(Date.now() - 2 * 3600000).toISOString();
    for (let i = 0; i < 36; i++) {
      const system = i >= 32,
        error = i >= 24 && !system;
      const result = store.audit(
        system ? 'system' : 'agent-test',
        system ? 'hub' : 'mcp-test',
        system ? 'system.update' : 'merge',
        error ? 'error' : 'success',
        {},
        {},
        system ? undefined : (i + 1) * 100,
        '',
        error
          ? {
              policyDecision: 'allow',
              errorCategory: i === 31 ? 'upstream_tool_conflict' : 'validation'
            }
          : {}
      );
      store.db
        .prepare('UPDATE audit SET created=? WHERE id=?')
        .run(created, Number(result.lastInsertRowid));
    }
    await page.locator('[data-action=refresh]').first().click();
    await page.waitForFunction(
      () => document.querySelector('.operations-kpis .stat .statvalue')?.textContent === '32'
    );
    assert.match(await page.locator('.operations-errors').innerText(), /Validation: 7/);
    assert.match(await page.locator('.operations-kpis').innerText(), /25%/);
    assert.match(await page.locator('.operations-kpis').innerText(), /2\.300 ms · n=24/);
    assert.equal(await page.locator('.operations .pie-chart').count(), 0);
    assert(
      requests.every(url => url.includes('/logs/summary?')),
      'Overview must only fetch summary, not pages of payloads'
    );
    mkdirSync('/tmp/audit-c-evidence', { recursive: true });
    await page.screenshot({ path: '/tmp/audit-c-evidence/dashboard-desktop.png', fullPage: true });
    // Bucket link preserves [since,before), including on refresh/back and export.
    await page
      .locator('.operations-chart a')
      .filter({ has: page.locator('title', { hasText: '32 calls' }) })
      .click();
    await page.waitForSelector('#results tbody tr');
    assert.equal(await page.locator('#results tbody tr').count(), 32);
    assert.match(page.url(), /eventKind=tool_call/);
    assert.match(page.url(), /before=/);
    const hash = new URL(page.url()).hash;
    await page.reload();
    await page.waitForSelector('#results tbody tr');
    assert.equal(await page.locator('#results tbody tr').count(), 32);
    assert.equal(new URL(page.url()).hash, hash);
    await page.locator('#results [data-action^="log:"]').first().click();
    await page.locator('[data-action="logtab:policy"]').click();
    assert.match(await page.locator('dialog pre.json').innerText(), /"policyDecision": "ALLOW"/);
    assert.match(await page.locator('dialog pre.json').innerText(), /"outcome": "error"/);
    await page.locator('dialog [data-action=close]').first().click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-action=export-jsonl]').click();
    const download = await downloadPromise;
    const exported = readFileSync(await download.path(), 'utf8')
      .trim()
      .split('\n')
      .filter(l => !l.startsWith('#'))
      .map(JSON.parse);
    assert.equal(exported.length, 32);
    await page.goBack();
    await page.waitForSelector('.operations-kpis');
    await page.locator('.operations-errors a').filter({ hasText: 'Validation: 7' }).click();
    await page.waitForSelector('#results tbody tr');
    assert.equal(await page.locator('#results tbody tr').count(), 7);
    await page.goto(x.origin + '/#overview');
    await page.waitForSelector('.operations-kpis');
    await page.route('**/api/logs/summary?*', r => r.abort(), { times: 1 });
    await page.locator('[data-action=refresh]').first().click();
    await page.waitForSelector('.operations [role=alert]');
    assert.match(await page.locator('.operations [role=alert]').innerText(), /lần tải trước/);
    assert.equal(await page.locator('.operations-kpis .stat .statvalue').first().innerText(), '32');
    await page.selectOption('#overview-hours', '1');
    await page.waitForFunction(
      () => document.querySelector('.operations-kpis .stat .statvalue')?.textContent === '0'
    );
    assert.match(await page.locator('.operations-kpis').innerText(), /Không có mẫu/);
    await page.selectOption('#overview-hours', '24');
    await page.waitForFunction(
      () => document.querySelector('.operations-kpis .stat .statvalue')?.textContent === '32'
    );
    await page.setViewportSize({ width: 390, height: 844 });
    // Finish the existing sidebar's responsive CSS transition before visual evidence.
    await page.waitForTimeout(350);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: '/tmp/audit-c-evidence/dashboard-mobile.png', fullPage: true });
    assert.deepEqual(errors, []);
  }
);
