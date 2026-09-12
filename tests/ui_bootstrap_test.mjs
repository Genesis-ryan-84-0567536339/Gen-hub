import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { fixture } from './helpers.mjs';

test('Bootstrap UI: outline editor edit, add, reorder, delete, live preview, save, reload', async t => {
  const x = await fixture(t);
  x.hub.store.put('settings', 'main', { name: 'Gen-hub', retention: 30, onboarded: true });

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
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // 1. Log in
  await page.goto(x.origin);
  await page.fill('#login [name=username]', 'owner');
  await page.fill('#login [name=password]', 'owner-password-123');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('.sidebar');

  // 2. Verify sidebar contains Bootstrap link
  const bootstrapNav = page.locator('.sidebar a[href="#bootstrap"]');
  assert(await bootstrapNav.isVisible(), 'Mục Bootstrap phải hiển thị trên sidebar');

  // 3. Navigate to Bootstrap
  await bootstrapNav.click();
  await page.waitForSelector('.pagehead h1:has-text("Hướng dẫn khởi động (Bootstrap)")');

  // 4. Verify initial default groups and preview
  const groupCards = page.locator('.bootstrap-editor section.card');
  const groupCount = await groupCards.count();
  assert.equal(groupCount, 4, 'Ban đầu phải có 4 nhóm mặc định');

  const previewEl = page.locator('#bootstrap-preview');
  let previewText = await previewEl.innerText();
  assert.ok(previewText.includes('1. Kết nối nguồn chuẩn'), 'Preview phải có nhóm 1');
  assert.ok(previewText.includes('1.1. Đọc Brain trước'), 'Preview phải có bước 1.1');

  // 5. Test real-time input: edit group 1 title
  const firstGroupTitleInput = page.locator('.bootstrap-editor [data-bootstrap-field="group-title"]').first();
  await firstGroupTitleInput.fill('Quy tắc khởi động số một');
  previewText = await previewEl.innerText();
  assert.ok(previewText.includes('1. Quy tắc khởi động số một'), 'Preview cập nhật real-time khi sửa tiêu đề nhóm');

  // 6. Test swap steps (Group 1: step 1 down)
  const firstStepDownBtn = page.locator('.bootstrap-editor [data-action="bootstrap-step-down:0:0"]');
  await firstStepDownBtn.click();
  await page.waitForTimeout(100);
  previewText = await previewEl.innerText();
  assert.ok(
    previewText.includes('1.1. Đọc quy trình riêng của repo'),
    'Sau khi đổi chỗ bước xuống, bước 2 trở thành bước 1.1'
  );

  // 7. Test swap groups (Group 1 down)
  const firstGroupDownBtn = page.locator('.bootstrap-editor [data-action="bootstrap-group-down:0"]');
  await firstGroupDownBtn.click();
  await page.waitForTimeout(100);
  previewText = await previewEl.innerText();
  assert.ok(
    previewText.includes('1. Quy trình Issue → Branch → PR') && previewText.includes('2. Quy tắc khởi động số một'),
    'Sau khi đổi chỗ nhóm, thứ tự các nhóm trong preview thay đổi'
  );

  // 8. Test delete a group (delete group 4 "Phản hồi")
  const lastGroupDeleteBtn = page.locator('.bootstrap-editor [data-action^="bootstrap-group-delete:"]').last();
  await lastGroupDeleteBtn.click();
  await page.waitForTimeout(100);
  const groupCountAfterDelete = await page.locator('.bootstrap-editor section.card').count();
  assert.equal(groupCountAfterDelete, 3, 'Sau khi xoá 1 nhóm còn 3 nhóm');

  // 9. Test add a new step to group 0
  const addStepBtn = page.locator('.bootstrap-editor [data-action="bootstrap-step-add:0"]');
  await addStepBtn.click();
  await page.waitForTimeout(100);
  const newStepTitleInput = page.locator('.bootstrap-editor [data-group-index="0"] [data-bootstrap-field="step-title"]').last();
  const newStepContentInput = page.locator('.bootstrap-editor [data-group-index="0"] [data-bootstrap-field="step-content"]').last();
  await newStepTitleInput.fill('Bước bổ sung mới');
  await newStepContentInput.fill('Nội dung kiểm tra tự động');
  previewText = await previewEl.innerText();
  assert.ok(previewText.includes('Bước bổ sung mới: Nội dung kiểm tra tự động'), 'Bước mới xuất hiện trong preview');

  // 10. Click "Lưu thay đổi"
  const saveBtn = page.locator('button[data-action="bootstrap-save"]').first();
  await saveBtn.click();
  await page.waitForSelector('#toast.show');
  const toastMsg = await page.locator('#toast').innerText();
  assert.match(toastMsg, /Đã lưu thay đổi hướng dẫn Bootstrap/);

  // 11. Reload page and check data persistence
  await page.reload();
  await page.goto(x.origin + '/#bootstrap');
  await page.waitForSelector('.pagehead h1:has-text("Hướng dẫn khởi động (Bootstrap)")');

  const reloadedGroupCount = await page.locator('.bootstrap-editor section.card').count();
  assert.equal(reloadedGroupCount, 3, 'Dữ liệu sau khi reload vẫn giữ 3 nhóm');
  const reloadedPreviewText = await page.locator('#bootstrap-preview').innerText();
  assert.ok(
    reloadedPreviewText.includes('Bước bổ sung mới: Nội dung kiểm tra tự động'),
    'Bước mới vẫn tồn tại sau khi reload'
  );
  assert.ok(
    reloadedPreviewText.includes('2. Quy tắc khởi động số một'),
    'Thứ tự và tiêu đề nhóm sửa vẫn tồn tại sau khi reload'
  );

  assert.equal(errors.length, 0, 'Không có lỗi JavaScript nào phát sinh');
});
