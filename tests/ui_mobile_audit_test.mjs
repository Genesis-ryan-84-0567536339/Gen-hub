import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { fixture } from './helpers.mjs';

test('Mobile Audit Log: card layout, status/tool/latency top-row, compact toolbar at 390x844 (Issue #82)', async t => {
  const x = await fixture(t);

  // Seed several diverse audit rows
  x.hub.store.audit('owner', 'hub', 'vault.list', 'success', {}, {}, 12);
  x.hub.store.audit('agent-1', 'mcp-1', 'list_issues', 'success', { repo: 'Gen-hub' }, {}, 45);
  x.hub.store.audit('agent-1', 'mcp-1', 'create_issue', 'error', { title: 'Bug' }, { error: 'Conflict' }, 120, 'Conflict', {
    errorCategory: 'upstream_tool_conflict'
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

  // 1. Mobile viewport 390x844 (iPhone 12/13 standard)
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(7000);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));

  // Log in
  await page.goto(x.origin);
  await page.fill('#login [name=username]', 'owner');
  await page.fill('#login [name=password]', 'owner-password-123');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('.topbar');

  // Navigate to #audit
  await page.goto(x.origin + '/#audit');
  await page.waitForSelector('.card#results .audit-row');

  // 2. Check no horizontal overflow across the entire page
  const pageMetrics = await page.evaluate(() => {
    const docScrollWidth = document.documentElement.scrollWidth;
    const innerWidth = window.innerWidth;
    const tablewrap = document.querySelector('.audit-tablewrap');
    const overflowing = [];

    document.querySelectorAll('*').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.right > window.innerWidth + 1) {
        overflowing.push({
          tag: el.tagName,
          className: el.className,
          id: el.id,
          right: rect.right
        });
      }
    });

    return {
      docScrollWidth,
      innerWidth,
      tablewrapScrollWidth: tablewrap?.scrollWidth,
      tablewrapClientWidth: tablewrap?.clientWidth,
      overflowingCount: overflowing.length,
      overflowing
    };
  });

  assert.equal(pageMetrics.docScrollWidth, 390, 'document.scrollWidth must not exceed viewport 390px');
  assert.equal(
    pageMetrics.overflowingCount,
    0,
    `No element should overflow viewport horizontally (found: ${JSON.stringify(pageMetrics.overflowing)})`
  );
  assert.ok(
    pageMetrics.tablewrapScrollWidth <= pageMetrics.tablewrapClientWidth,
    'tablewrap must not require horizontal scrolling'
  );

  // 3. Check card layout: status/tool/latency on top row, time/actor on secondary row
  const cards = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.audit-row'));
    return rows.map(r => {
      const toolEl = r.querySelector('.col-tool');
      const statusEl = r.querySelector('.col-status');
      const latencyEl = r.querySelector('.col-latency');
      const timeEl = r.querySelector('.col-time');
      const actorEl = r.querySelector('.col-actor');
      const actionEl = r.querySelector('.col-action');

      const toolRect = toolEl?.getBoundingClientRect();
      const statusRect = statusEl?.getBoundingClientRect();
      const latencyRect = latencyEl?.getBoundingClientRect();
      const timeRect = timeEl?.getBoundingClientRect();
      const actorRect = actorEl?.getBoundingClientRect();
      const actionRect = actionEl?.getBoundingClientRect();

      return {
        toolText: toolEl?.querySelector('.mono')?.innerText.trim(),
        toolRect: { x: toolRect?.x, y: toolRect?.y, right: toolRect?.right, width: toolRect?.width },
        statusRect: { x: statusRect?.x, y: statusRect?.y, right: statusRect?.right, width: statusRect?.width },
        latencyRect: { x: latencyRect?.x, y: latencyRect?.y, right: latencyRect?.right, width: latencyRect?.width },
        timeRect: { x: timeRect?.x, y: timeRect?.y, right: timeRect?.right },
        actorRect: { x: actorRect?.x, y: actorRect?.y, right: actorRect?.right },
        actionRect: { x: actionRect?.x, y: actionRect?.y, right: actionRect?.right }
      };
    });
  });

  assert.ok(cards.length >= 3, 'Must render at least 3 audit log cards');

  for (const card of cards) {
    // Tool, status, latency visible without scrolling (all right <= 390 and x >= 0)
    assert.ok(card.toolRect.x >= 0 && card.toolRect.right <= 390, 'Tool must be fully within viewport');
    assert.ok(card.statusRect.x >= 0 && card.statusRect.right <= 390, 'Status must be fully within viewport');
    assert.ok(card.latencyRect.x >= 0 && card.latencyRect.right <= 390, 'Latency must be fully within viewport');

    // Tool, status, and latency are on the top row of the card
    const yDeltaToolStatus = Math.abs(card.toolRect.y - card.statusRect.y);
    const yDeltaStatusLatency = Math.abs(card.statusRect.y - card.latencyRect.y);
    assert.ok(yDeltaToolStatus < 15, `Tool and status should be on the top row (delta: ${yDeltaToolStatus})`);
    assert.ok(yDeltaStatusLatency < 15, `Status and latency should be on the top row (delta: ${yDeltaStatusLatency})`);

    // Time and actor are on secondary row below the top row
    assert.ok(card.timeRect.y > card.toolRect.y + 15, 'Time must be on secondary row below tool');
    assert.ok(card.actorRect.y > card.toolRect.y + 15, 'Actor must be on secondary row below tool');
    assert.ok(card.timeRect.right <= 390, 'Time must fit within viewport');
    assert.ok(card.actorRect.right <= 390, 'Actor must fit within viewport');
  }

  // 4. Verify compact toolbar at 390px
  const toolbarMetrics = await page.evaluate(() => {
    const search = document.querySelector('.audit-toolbar .search')?.getBoundingClientRect();
    const selects = Array.from(document.querySelectorAll('.audit-toolbar select')).map(s => {
      const r = s.getBoundingClientRect();
      return { id: s.id, x: r.x, y: r.y, right: r.right, width: r.width };
    });
    return { search, selects };
  });

  assert.ok(toolbarMetrics.search.right <= 390, 'Search bar must fit in viewport');
  assert.equal(toolbarMetrics.selects.length, 4, 'Must have 4 filter selects');
  for (const s of toolbarMetrics.selects) {
    assert.ok(s.right <= 390, `Filter ${s.id} right (${s.right}) must be within 390px`);
    assert.ok(s.x >= 0, `Filter ${s.id} x (${s.x}) must be >= 0`);
  }
  // Filters form a clean 2x2 grid: row 1 has 2 selects, row 2 has 2 selects
  const row1 = toolbarMetrics.selects.filter(s => Math.abs(s.y - toolbarMetrics.selects[0].y) < 10);
  const row2 = toolbarMetrics.selects.filter(s => Math.abs(s.y - toolbarMetrics.selects[0].y) >= 10);
  assert.equal(row1.length, 2, 'First row of filters must have 2 selects');
  assert.equal(row2.length, 2, 'Second row of filters must have 2 selects');

  // 5. Test interaction: click Chi tiết opens modal properly within mobile viewport
  const firstDetailBtn = page.locator('.audit-row .col-action button').first();
  await firstDetailBtn.click();
  await page.waitForSelector('dialog#modal[open]');

  const modalMetrics = await page.evaluate(() => {
    const m = document.querySelector('dialog#modal[open]');
    const rect = m?.getBoundingClientRect();
    return {
      open: !!m,
      width: rect?.width,
      right: rect?.right,
      left: rect?.left
    };
  });
  assert.ok(modalMetrics.open, 'Detail modal should open on Chi tiết click');
  assert.ok(modalMetrics.right <= 390, 'Modal must fit within mobile viewport');
  assert.ok(modalMetrics.left >= 0, 'Modal must not overflow left');

  // Close modal
  await page.click('dialog#modal button[data-action="close"]');
  await page.waitForSelector('dialog#modal', { state: 'hidden' });

  // 6. Test filtering: change status filter to "error"
  await page.selectOption('#statusfilter', 'error');
  await page.waitForTimeout(400);

  const filteredCards = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.audit-row'));
    return rows.map(r => r.querySelector('.col-tool .mono')?.innerText.trim());
  });
  assert.ok(filteredCards.includes('create_issue'), 'Error filter must show create_issue');
  assert.ok(!filteredCards.includes('list_issues'), 'Error filter must hide list_issues');

  // 7. Verify desktop view: table layout is preserved on wide viewports (1440x900)
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);

  const desktopLayout = await page.evaluate(() => {
    const thead = document.querySelector('.audit-table thead');
    const table = document.querySelector('.audit-table');
    const ths = Array.from(document.querySelectorAll('.audit-table th')).map(t => t.innerText.trim());
    const theadDisplay = window.getComputedStyle(thead).display;
    const tableDisplay = window.getComputedStyle(table).display;
    return { theadDisplay, tableDisplay, ths };
  });

  assert.notEqual(desktopLayout.theadDisplay, 'none', 'Desktop view must display table header thead');
  assert.equal(desktopLayout.tableDisplay, 'table', 'Desktop view must render audit-table as table display');
  assert.deepEqual(
    desktopLayout.ths,
    ['THỜI GIAN', 'NGƯỜI THỰC HIỆN', 'CÔNG CỤ / THAO TÁC', 'KẾT QUẢ', 'XỬ LÝ', ''],
    'Desktop table must retain all 6 column headers'
  );

  assert.equal(pageErrors.length, 0, `No uncaught page errors: ${pageErrors.join(', ')}`);
});
