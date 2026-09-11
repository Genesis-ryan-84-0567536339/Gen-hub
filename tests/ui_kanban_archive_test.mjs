import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { fixture } from './helpers.mjs';

const issue = (number, extra = {}) => ({
  number,
  title: 'Issue ' + number,
  state: 'open',
  labels: [],
  assignees: [],
  ...extra
});
const result = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });

test('Kanban Archive UI: Manual archive button archives all Done issues and updates board', async t => {
  const issuesList = [
    issue(10, { title: 'Finished task 10', state: 'closed' }),
    issue(20, { title: 'Finished task 20', state: 'closed' }),
    issue(30, { title: 'In progress task 30', labels: ['Status: In Progress'] })
  ];

  const x = await fixture(
    t,
    {
      call: async () => result(issuesList)
    },
    { fetchFn: async () => ({ ok: false, status: 503 }) }
  );

  const m = {
    id: 'mcp-gh',
    provider: 'github',
    name: 'GitHub',
    on: true,
    status: 'connected',
    auth: 'token',
    secret: x.hub.store.seal({ token: 'test-token' }),
    tools: [{ name: 'list_issues', published: false }]
  };
  x.hub.store.put('mcp', m.id, m);
  x.hub.store.put('settings', 'main', { name: 'Gen-hub', retention: 30, onboarded: true });
  x.hub.store.put('kanban', 'config', {
    repository: 'owner/project',
    connectorId: m.id,
    archived: [],
    doneObservedAt: {}
  });

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

  // 2. Navigate to Kanban
  await page.goto(x.origin + '/#kanban');
  await page.waitForSelector('.kanban-board');

  // 3. Verify initial Done column has 2 issues
  const doneCards = await page.locator('[data-column="Done"] .kanban-card').count();
  assert.equal(doneCards, 2, 'Done column should initially have 2 issues');

  // Check the button is visible and enabled
  const archiveBtn = page.locator('[data-column="Done"] button[data-action="kanban-archive-done"]');
  assert(await archiveBtn.isVisible(), 'Nút "Chuyển lưu trữ toàn bộ cột Done" phải hiển thị');
  assert(!(await archiveBtn.isDisabled()), 'Nút archive phải khả dụng khi có issue');

  // 4. Click the archive button
  await archiveBtn.click();

  // 5. Wait for toast notification
  await page.waitForSelector('#toast.show');
  const toastMsg = await page.locator('#toast').innerText();
  assert.match(toastMsg, /Đã chuyển lưu trữ 2 issue cột Done/);

  // 6. Verify Done column now has 0 cards
  await page.waitForTimeout(500);
  const doneCardsAfter = await page.locator('[data-column="Done"] .kanban-card').count();
  assert.equal(doneCardsAfter, 0, 'Done column must have 0 cards after archive');

  // 7. Verify archive button is now disabled
  assert(await archiveBtn.isDisabled(), 'Nút archive phải bị disabled khi cột Done rỗng');

  // 8. In Progress card is still there
  const inProgressCards = await page.locator('[data-column="In Progress"] .kanban-card').count();
  assert.equal(inProgressCards, 1, 'In Progress column must still have 1 card');

  assert.equal(errors.length, 0, `Page errors: ${errors.join(', ')}`);
});
