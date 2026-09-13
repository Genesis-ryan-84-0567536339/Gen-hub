import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { fixture } from './helpers.mjs';

const envelope = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }], isError: false });
const b64 = s => Buffer.from(s, 'utf8').toString('base64');

const GLOBAL_INDEX = `
categories:
  - ten: work-style
    index: skills/work-style/index.yaml
    trigger: ["phối hợp"]
`;
const CATEGORY_INDEX = `
leaves:
  - ten: scope-control
    path: skills/work-style/subskills/scope-control/SKILL.md
    trigger: ["kiểm soát phạm vi"]
`;

test('Skills UI: page auto-loads tree when brainRepo already configured, no click needed', async t => {
  const connector = {
    call: async (m, name, a) => {
      if (name !== 'get_file_contents') throw new Error('unexpected tool ' + name);
      if (a.path === 'skills/index.yaml') return envelope({ content: b64(GLOBAL_INDEX) });
      if (a.path === 'skills/work-style/index.yaml') return envelope({ content: b64(CATEGORY_INDEX) });
      throw new Error('unexpected path ' + a.path);
    }
  };
  const x = await fixture(t, connector);
  x.hub.store.put('settings', 'main', {
    name: 'Gen-hub',
    retention: 30,
    onboarded: true,
    brainRepo: 'acme/brain'
  });
  x.hub.store.put('mcp', 'mcp-gh-test', {
    id: 'mcp-gh-test',
    provider: 'github',
    name: 'GitHub',
    on: true,
    status: 'connected',
    secret: x.hub.store.seal({ token: 'test-token' }),
    tools: []
  });

  const chromiumPath =
    process.env.PLAYWRIGHT_CHROMIUM_PATH ||
    process.env.CHROMIUM_PATH ||
    (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : chromium.executablePath());

  const browser = await chromium.launch({ executablePath: chromiumPath, headless: true });
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(8000);

  await page.goto(x.origin);
  await page.fill('#login [name=username]', 'owner');
  await page.fill('#login [name=password]', 'owner-password-123');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('.sidebar');

  // Navigate straight to #skills via hash (no full reload) — must auto-load, no button click.
  await page.click('.sidebar a[href="#skills"]');
  await page.waitForSelector('.card:has-text("work-style")', { timeout: 8000 });
  assert(await page.locator('.card:has-text("work-style")').isVisible());

  // Category starts collapsed; expand to confirm the leaf loaded from the real fetch too.
  await page.click('.card:has-text("work-style")');
  await page.waitForSelector('text=scope-control');
  assert(await page.locator('text=scope-control').isVisible());
});
