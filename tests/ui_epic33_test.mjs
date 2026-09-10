import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { fixture } from './helpers.mjs';

test('Issue #33: Playwright UI - create secret with notes, edit notes, view notes in detail, and filter by notes', async t => {
  const x = await fixture(t);
  x.hub.store.put('settings', 'main', { name: 'Gen-hub', retention: 30, onboarded: true });

  const chromiumPath =
    process.env.PLAYWRIGHT_CHROMIUM_PATH ||
    process.env.CHROMIUM_PATH ||
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

  const click = action => page.locator(`[data-action="${action}"]`).first().click();

  // 1. Đăng nhập
  await page.goto(x.origin);
  await page.fill('#login [name=username]', 'owner');
  await page.fill('#login [name=password]', 'owner-password-123');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('.sidebar');

  // 2. Chuyển sang trang Vault
  await page.goto(x.origin + '/#vault');
  await page.waitForSelector('.entity-layout');

  // 3. Mở modal thêm secret mới
  await click('vault-new');
  await page.waitForSelector('#modal[open] form#vault-save');

  // Kiểm tra trường Ghi chú tồn tại trong form thêm mới
  const notesField = await page.$('#modal form#vault-save textarea[name="notes"]');
  assert(notesField, 'Trường textarea notes phải hiển thị trong modal thêm secret');

  await page.fill('#modal form#vault-save input[name="name"]', 'Backup S3 Token');
  await page.fill('#modal form#vault-save textarea[name="notes"]', 'Dùng cho backup hàng đêm');
  await page.fill('#modal form#vault-save textarea[name="secret"]', 'super-s3-secret-value');
  await page.click('#modal form#vault-save button[type="submit"]');
  await page.waitForSelector('#modal[open]', { state: 'hidden' });

  // 4. Kiểm tra secret hiển thị trong detail
  await page.waitForSelector('#entity-detail form#vault-save');
  const detailNotes = await page.$eval(
    '#entity-detail form#vault-save textarea[name="notes"]',
    el => el.value
  );
  assert.equal(detailNotes, 'Dùng cho backup hàng đêm');

  // 5. Cập nhật ghi chú trong detail view
  await page.fill('#entity-detail form#vault-save textarea[name="notes"]', 'Dùng cho backup hàng đêm (cập nhật v2)');
  await page.click('#entity-detail form#vault-save button[type="submit"]');
  await page.waitForFunction(() =>
    document.querySelector('#toast.show')?.textContent.startsWith('Đã lưu')
  );

  // 6. Reload trang và kiểm tra ghi chú mới vẫn tồn tại
  await page.reload();
  await page.waitForSelector('#entity-detail form#vault-save');
  const reloadedNotes = await page.$eval(
    '#entity-detail form#vault-save textarea[name="notes"]',
    el => el.value
  );
  assert.equal(reloadedNotes, 'Dùng cho backup hàng đêm (cập nhật v2)');

  // 7. Kiểm tra tìm kiếm lọc theo ghi chú
  await page.fill('#search', 'cập nhật v2');
  const foundItem = await page.$('.entity-row strong');
  assert(foundItem, 'Phải tìm thấy secret khi tìm theo nội dung ghi chú');
  assert.equal(await foundItem.innerText(), 'Backup S3 Token');

  assert.equal(errors.length, 0, `Không có lỗi JS trên trang: ${errors.join(', ')}`);
});
