import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { fixture } from './helpers.mjs';

test('Overview UI: Mask MCP connection link by default and toggle visibility with eye button', async t => {
  const x = await fixture(t);

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

  // 2. Go to Overview
  await page.goto(x.origin + '/#overview');
  await page.waitForSelector('.endpointbar .codecopy');

  const codeLocator = page.locator('.endpointbar .codecopy code');
  const toggleBtn = page.locator('.endpointbar .codecopy button[data-action="toggle-endpoint-visibility"]');
  const copyBtn = page.locator('.endpointbar .codecopy button[data-action="copyendpoint"]');

  // Verify initial state: masked
  assert.equal(await toggleBtn.count(), 1, 'Toggle eye button must exist in endpointbar');
  const initialText = (await codeLocator.innerText()).trim();
  assert.equal(initialText, '••••••••••••••••••••••••', 'Endpoint text must be masked by default');
  assert.ok(
    await codeLocator.evaluate(el => el.classList.contains('endpoint-masked')),
    'Code element must have endpoint-masked class by default'
  );
  const initialBtnLabel = await toggleBtn.getAttribute('aria-label');
  assert.equal(initialBtnLabel, 'Xem link kết nối', 'Eye button label must prompt to view connection link');

  // Verify copy while masked still copies the real endpoint
  await copyBtn.click();
  await page.waitForTimeout(150);
  const copiedWhileMasked = await page.evaluate(() => window.__copied[window.__copied.length - 1]);
  assert.equal(
    copiedWhileMasked,
    `${x.origin}/mcp`,
    `Copying while masked must copy the real endpoint (${x.origin}/mcp), got: ${copiedWhileMasked}`
  );

  // 3. Click eye button to reveal
  await toggleBtn.click();
  await page.waitForTimeout(150);

  const revealedText = (await codeLocator.innerText()).trim();
  assert.equal(
    revealedText,
    `${x.origin}/mcp`,
    `Endpoint text must be revealed as ${x.origin}/mcp after clicking eye button`
  );
  assert.ok(
    !(await codeLocator.evaluate(el => el.classList.contains('endpoint-masked'))),
    'Code element must not have endpoint-masked class when revealed'
  );
  const revealedBtnLabel = await toggleBtn.getAttribute('aria-label');
  assert.equal(revealedBtnLabel, 'Ẩn link kết nối', 'Eye button label must prompt to hide connection link');

  // 4. Click eye button again to hide
  await toggleBtn.click();
  await page.waitForTimeout(150);

  const hiddenAgainText = (await codeLocator.innerText()).trim();
  assert.equal(hiddenAgainText, '••••••••••••••••••••••••', 'Endpoint text must be masked again after clicking eye');
  assert.ok(
    await codeLocator.evaluate(el => el.classList.contains('endpoint-masked')),
    'Code element must have endpoint-masked class after hiding'
  );

  // 5. Open "Hướng dẫn kết nối" modal from Overview
  await page.locator('.endpointbar button[data-action="connect"]').click();
  await page.waitForSelector('dialog[open] .codecopy');

  const modalCode = page.locator('dialog[open] .codecopy code');
  const modalToggle = page.locator('dialog[open] .codecopy button[data-action="toggle-endpoint-visibility"]');
  assert.equal(await modalToggle.count(), 1, 'Modal must also have eye toggle button');
  assert.equal(
    (await modalCode.innerText()).trim(),
    '••••••••••••••••••••••••',
    'Modal endpoint must also be masked by default'
  );

  // Click eye in modal
  await modalToggle.click();
  await page.waitForTimeout(150);
  assert.equal(
    (await modalCode.innerText()).trim(),
    `${x.origin}/mcp`,
    'Modal endpoint must be revealed after clicking eye'
  );

  assert.equal(errors.length, 0, `Page errors encountered: ${errors.join(', ')}`);
});
