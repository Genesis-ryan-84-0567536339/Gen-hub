import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fixture } from './helpers.mjs';

test('Issue #34 UI: dashboard update banner, Settings update panel, and manual check button', async t => {
  const currentRev = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555';
  const prevRev = '0000111122223333444455556666777788889999';

  let mockCheckResult = {
    sha: currentRev,
    commit: { message: 'release: stable update', committer: { date: '2026-09-10T10:00:00Z' } }
  };

  const mockFetch = async url => {
    if (url.includes('/commits/main')) {
      return {
        ok: true,
        status: 200,
        json: async () => mockCheckResult
      };
    }
    if (url.includes('/actions/workflows/ci.yml/runs')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          workflow_runs: [
            {
              head_sha: mockCheckResult.sha,
              head_branch: 'main',
              status: 'completed',
              conclusion: 'success'
            }
          ]
        })
      };
    }
    return { ok: false, status: 404 };
  };

  const x = await fixture(t, null, {
    revision: currentRev,
    updatedAt: '2026-09-10T12:00:00.000Z',
    fetchFn: mockFetch
  });

  x.hub.store.put('settings', 'main', { name: 'Gen-hub', retention: 30, onboarded: true });
  x.hub.store.put('system', 'previous_version', {
    revision: prevRev,
    updatedAt: '2026-09-10T11:00:00.000Z'
  });

  const browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_PATH ||
      process.env.CHROMIUM_PATH ||
      '/usr/bin/google-chrome' ||
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

  // Pre-seed localStorage to simulate that user last saw prevRev
  await page.addInitScript(
    ({ owner, prevRev }) => {
      localStorage.setItem('genhub_seen_revision_' + owner, prevRev);
    },
    { owner: 'owner', prevRev }
  );

  // 1. Log in
  await page.goto(x.origin, { waitUntil: 'networkidle' });
  await page.fill('input[name=username]', 'owner');
  await page.fill('input[name=password]', 'owner-password-123');
  await page.click('button[type=submit]');
  await page.waitForSelector('.topbar');
  assert.equal(errors.length, 0, 'No errors on page load: ' + errors.join('; '));

  await shot('issue34-dashboard-with-update-banner');

  // 2. Auto-update banner should be visible
  const banner = page.locator('.update-banner.updated');
  await banner.waitFor({ state: 'visible' });
  const bannerText = await banner.innerText();
  assert.ok(
    bannerText.includes('Gen-hub vừa được tự động cập nhật'),
    'Banner text must indicate auto update: ' + bannerText
  );
  assert.ok(
    bannerText.includes('aaaa111'),
    'Banner must mention current short revision: ' + bannerText
  );

  // 3. Dismiss banner
  const dismissBtn = banner.locator('button[data-action="dismiss-update-banner"]');
  await dismissBtn.click();
  await banner.waitFor({ state: 'detached' });
  assert.equal(
    await page.locator('.update-banner.updated').count(),
    0,
    'Banner should disappear after dismiss'
  );

  // 4. Check that "Kiểm tra cập nhật" button exists in Overview
  const checkBtn = page.locator('button[data-action="check-update"]').first();
  await checkBtn.waitFor({ state: 'visible' });
  await checkBtn.click();

  // Toast should appear
  const toast = page.locator('#toast');
  await toast.waitFor({ state: 'visible' });
  const toastText = await toast.innerText();
  assert.ok(
    toastText.includes('mới nhất') || toastText.includes('kiểm tra'),
    'Toast should confirm check: ' + toastText
  );

  // 5. Navigate to Settings -> Cập nhật hệ thống
  await page.goto(x.origin + '#settings', { waitUntil: 'networkidle' });
  await page.waitForSelector('.entity-layout');

  const updateTabBtn = page.locator('button[data-action="select:settings:updates"]');
  await updateTabBtn.waitFor({ state: 'visible' });
  await updateTabBtn.click();

  await shot('issue34-settings-updates-panel');

  const detailPanel = page.locator('#detail-panel');
  await detailPanel.waitFor({ state: 'visible' });
  const panelText = await detailPanel.innerText();
  assert.ok(panelText.includes('Phiên bản đang chạy'), 'Detail panel must show current version');
  assert.ok(
    panelText.includes('aaaa111'),
    'Detail panel must contain shortened current revision sha'
  );
  const codeTitle = await page
    .locator('#detail-panel dt:has-text("Phiên bản đang chạy") + dd code')
    .getAttribute('title');
  assert.equal(codeTitle, currentRev);
  assert.ok(
    panelText.includes('Kiểm tra cập nhật ngay'),
    'Panel must have button to check for updates'
  );

  assert.equal(errors.length, 0, 'No JavaScript errors occurred during test');
});
