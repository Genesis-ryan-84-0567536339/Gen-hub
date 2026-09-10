import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { createHub } from '../server/app.mjs';

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const closeServer = server => new Promise(resolve => server.close(resolve));

test('Gen-hub Playwright UI automated flow (Issue #9)', async t => {
  // 1. Tạo DATA_DIR tạm, port riêng, khởi động server và tạo owner qua server/admin.mjs
  const dataDir = mkdtempSync(join(tmpdir(), 'genhub-ui-data-'));
  const screenshotDir = mkdtempSync(join(tmpdir(), 'genhub-ui-shots-'));

  const adminResult = spawnSync(
    process.execPath,
    ['server/admin.mjs', 'create-owner'],
    {
      input: JSON.stringify({ username: 'ryan', password: 'password-owner-1234' }),
      env: { ...process.env, DATA_DIR: dataDir },
      encoding: 'utf8'
    }
  );
  assert.equal(adminResult.status, 0, `create-owner failed: ${adminResult.stderr}`);
  assert.match(adminResult.stdout, /Owner đã được lưu/);

  const probe = createServer();
  await listen(probe);
  const port = probe.address().port;
  await closeServer(probe);

  const origin = `http://127.0.0.1:${port}`;
  const hub = createHub({ dir: dataDir, origin });
  await new Promise(resolve => hub.server.listen(port, '127.0.0.1', resolve));

  const chromiumPath =
    process.env.PLAYWRIGHT_CHROMIUM_PATH ||
    process.env.CHROMIUM_PATH ||
    chromium.executablePath();

  assert(existsSync(chromiumPath), `Chromium executable not found at ${chromiumPath}`);

  const browser = await chromium.launch({
    executablePath: chromiumPath,
    headless: true
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  t.after(async () => {
    await browser.close().catch(() => {});
    await closeServer(hub.server).catch(() => {});
    hub.store.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(screenshotDir, { recursive: true, force: true });
  });

  // 2. Load trang chủ, xác nhận form đăng nhập hiện đúng
  await page.goto(origin);
  await page.waitForSelector('form#login');
  const loginTitle = await page.textContent('.loginwrap h1');
  assert.match(loginTitle, /Chào mừng trở lại/);
  const userInput = await page.$('form#login input[name="username"]');
  const passInput = await page.$('form#login input[name="password"]');
  const submitBtn = await page.$('form#login button[type="submit"]');
  assert(userInput, 'Trường username phải tồn tại');
  assert(passInput, 'Trường password phải tồn tại');
  assert(submitBtn, 'Nút submit đăng nhập phải tồn tại');

  // 3. Login qua UI thật (không gọi API trực tiếp), xác nhận vào được dashboard
  await page.fill('form#login input[name="username"]', 'ryan');
  await page.fill('form#login input[name="password"]', 'password-owner-1234');
  await page.click('form#login button[type="submit"]');

  // Đóng dialog onboarding nếu xuất hiện lần đầu
  await page.waitForSelector('.sidebar');
  try {
    const onboardingBtn = await page.waitForSelector('button[data-action="onboard-done"]', { timeout: 2000 });
    if (onboardingBtn) {
      await onboardingBtn.click();
      await page.waitForSelector('dialog#modal[open]', { state: 'hidden', timeout: 5000 }).catch(() => {});
    }
  } catch {}

  const brandText = await page.textContent('.sidebar .brand');
  assert.match(brandText, /gen-hub/);

  // 4. Điều hướng qua đủ 5 mục (Tổng quan, MCP & kết nối, Agent & quyền, Nhật ký, Cài đặt), chụp ảnh mỗi mục
  const sections = [
    { hash: '#overview', title: 'Tổng quan', filename: '01-overview.png' },
    { hash: '#mcps', title: 'MCP & kết nối', filename: '02-mcps.png' },
    { hash: '#agents', title: 'Agent & quyền', filename: '03-agents.png' },
    { hash: '#audit', title: 'Nhật ký', filename: '04-audit.png' },
    { hash: '#settings', title: 'Cài đặt', filename: '05-settings.png' }
  ];

  for (const s of sections) {
    await page.click(`.sidebar a[href="${s.hash}"]`);
    await page.waitForSelector(`.pagehead h1:has-text("${s.title}")`);
    const screenshotPath = join(screenshotDir, s.filename);
    await page.screenshot({ path: screenshotPath });
    assert(existsSync(screenshotPath), `Screenshot file ${s.filename} must exist in temp dir`);
  }

  // 5. Mở modal "Thêm MCP", xác nhận đủ 6 connector + mục MCP tuỳ chỉnh hiện đúng
  await page.click('.sidebar a[href="#mcps"]');
  await page.waitForSelector('.pagehead h1:has-text("MCP & kết nối")');
  await page.click('button[data-action="add"]');
  await page.waitForSelector('dialog#modal[open]');

  const modalTitle = await page.textContent('dialog#modal .modalhead h2');
  assert.equal(modalTitle, 'Thêm MCP');

  const catalogNames = await page.$$eval('dialog#modal .catalogrow h3', els =>
    els.map(e => e.textContent.trim())
  );
  assert.equal(catalogNames.length, 7, 'Modal Thêm MCP phải hiển thị đủ 7 connector tích hợp');
  const expectedConnectors = [
    'GitHub',
    'GitHub MCP (pilot)',
    'Google Drive',
    'Slack',
    'Telegram',
    'Discord',
    'Figma'
  ];
  for (const exp of expectedConnectors) {
    assert(
      catalogNames.includes(exp),
      `Connector ${exp} phải có trong catalog (tìm thấy: ${catalogNames.join(', ')})`
    );
  }

  const customForm = await page.$('dialog#modal form#remote');
  assert(customForm, 'Form MCP HTTP tùy chỉnh phải có trong modal');
  assert(await customForm.$('input[name="name"]'), 'Trường Tên MCP phải tồn tại');
  assert(await customForm.$('input[name="url"]'), 'Trường Địa chỉ endpoint phải tồn tại');
  assert(await customForm.$('select[name="auth"]'), 'Lựa chọn Xác thực phải tồn tại');
  assert(await customForm.$('input[name="allowPrivate"]'), 'Checkbox allowPrivate phải tồn tại');

  // Đóng modal Thêm MCP
  await page.click('dialog#modal button[data-action="close"]');
  await page.waitForSelector('dialog#modal[open]', { state: 'hidden' });

  // 6. Logout, xác nhận replay cookie cũ trả về 401
  const cookiesBeforeLogout = await context.cookies();
  const sessionCookie = cookiesBeforeLogout.find(c => c.name === 'genhub');
  assert(sessionCookie, 'Cookie genhub phải tồn tại khi đăng nhập');

  await page.click('button[data-action="logout"]');
  await page.waitForSelector('form#login');

  // Replay cookie cũ qua fetch
  const replayRes = await fetch(`${origin}/api/state`, {
    headers: {
      Cookie: `${sessionCookie.name}=${sessionCookie.value}`
    }
  });
  assert.equal(
    replayRes.status,
    401,
    `Replay cookie phiên cũ phải bị từ chối 401 do server đã thu hồi session, nhận: ${replayRes.status}`
  );
});
