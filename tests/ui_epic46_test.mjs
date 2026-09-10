import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { fixture } from './helpers.mjs';

test('Issue #46: GitHub MCP 46 tools responsive layout, no horizontal overflow, and title tooltip', async t => {
  const x = await fixture(t);
  x.hub.store.put('settings', 'main', { name: 'Gen-hub', retention: 30, onboarded: true });

  // Official GitHub MCP tools simulation (46 tools with long English descriptions)
  const officialGithubTools = [
    {
      name: 'add_issue_comment',
      description: 'Add a new comment to an existing issue in a repository.',
      inputSchema: { type: 'object', properties: {} },
      permission: { status: 'ok' },
      published: true,
      annotations: { readOnlyHint: false }
    },
    {
      name: 'add_review_comment',
      description:
        "Add review comment to the requester's latest pending pull request review. A pending review needs to already exist to call this (check with the user if not sure).",
      inputSchema: { type: 'object', properties: {} },
      permission: { status: 'ok' },
      published: true,
      annotations: { readOnlyHint: false }
    },
    {
      name: 'cancel_workflow_run',
      description:
        'Cancels a workflow run for a repository. Requires admin or write permission to the repository.',
      inputSchema: { type: 'object', properties: {} },
      permission: { status: 'ok' },
      published: false,
      annotations: { readOnlyHint: false }
    },
    {
      name: 'create_branch',
      description:
        'Create a new git branch in the specified repository from an existing reference or the default branch.',
      inputSchema: { type: 'object', properties: {} },
      permission: { status: 'ok' },
      published: false,
      annotations: { readOnlyHint: false }
    },
    {
      name: 'create_commit',
      description:
        'Creates a new commit with the specified changes. If parent commit is not specified, HEAD is used. If multiple branches exist, changes are made to the current or specified branch.',
      inputSchema: { type: 'object', properties: {} },
      permission: { status: 'ok' },
      published: false,
      annotations: { readOnlyHint: false }
    },
    {
      name: 'create_pull_request',
      description:
        'Creates a new pull request in a repository from the specified head branch into the base branch.',
      inputSchema: { type: 'object', properties: {} },
      permission: { status: 'ok' },
      published: false,
      annotations: { readOnlyHint: false }
    },
    {
      name: 'get_file_contents',
      description:
        'Gets the contents of a file or directory from a repository. For file contents, returns base64 encoded content for binary files or text for text files.',
      inputSchema: { type: 'object', properties: {} },
      permission: { status: 'ok' },
      published: true,
      annotations: { readOnlyHint: true }
    },
    {
      name: 'search_code',
      description:
        'Search for code in repositories. You can search for terms in file contents or paths using GitHub search syntax.',
      inputSchema: { type: 'object', properties: {} },
      permission: { status: 'ok' },
      published: true,
      annotations: { readOnlyHint: true }
    }
  ];

  // Fill up to 46 tools with varying descriptions
  for (let i = officialGithubTools.length + 1; i <= 46; i++) {
    officialGithubTools.push({
      name: `github_operation_tool_${i}`,
      description: `Comprehensive API operation for GitHub resource ${i}. Provides advanced querying, structured payload delivery, filtering parameters, and fine-grained repository manipulation.`,
      inputSchema: { type: 'object', properties: {} },
      permission: { status: 'ok' },
      published: i % 3 === 0,
      annotations: { readOnlyHint: i % 2 === 0 }
    });
  }

  // Create GitHub MCP connector and test agent
  const mcp = (await x.call('/api/mcps', 'POST', { provider: 'github-mcp' })).data;
  const mcpRecord = x.hub.store.get('mcp', mcp.id);
  mcpRecord.status = 'connected';
  mcpRecord.tools = officialGithubTools;
  x.hub.store.put('mcp', mcp.id, mcpRecord);

  const agent = (await x.call('/api/agents', 'POST', { name: 'Coder Pilot' })).data;

  const chromiumPath =
    process.env.PLAYWRIGHT_CHROMIUM_PATH ||
    process.env.CHROMIUM_PATH ||
    '/usr/bin/google-chrome' ||
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

  // 1. Log in
  await page.goto(x.origin);
  await page.fill('#login [name=username]', 'owner');
  await page.fill('#login [name=password]', 'owner-password-123');
  await page.click('#login button[type=submit]');
  await page.waitForSelector('.topbar');
  assert.equal(errors.length, 0, 'No console errors after login: ' + errors.join('; '));

  // 2. Navigate to MCPs and select GitHub MCP
  await page.click('.sidebar a[href="#mcps"]');
  await page.waitForSelector('.entity-layout');
  await page.click(`[data-action="select:mcps:${mcp.id}"]`);

  // Switch to "Tool" tab
  await page.click('[data-action="detail-tab:tools"]');
  await page.waitForSelector('.toolgroup');

  // Verify all 46 tools are rendered
  const toolRowCount = await page.locator('.toolgroup .toolrow').count();
  assert.equal(toolRowCount, 46, 'Must display all 46 tools from GitHub MCP');

  // Verify tool description has title attribute matching full text
  const reviewCommentDesc = page.locator('.toolrow:has(b:text-is("add_review_comment")) p');
  const descTitle = await reviewCommentDesc.getAttribute('title');
  const expectedDesc =
    "Add review comment to the requester's latest pending pull request review. A pending review needs to already exist to call this (check with the user if not sure).";
  assert.equal(
    descTitle,
    expectedDesc,
    'Title attribute must contain the full unabridged description'
  );

  // 3. Test responsive viewports: 1440x900, 1280x800, 1024x768, 840x700, 600x800, 375x667
  const viewports = [
    { w: 1440, h: 900, name: 'desktop-wide' },
    { w: 1280, h: 800, name: 'desktop-laptop' },
    { w: 1024, h: 768, name: 'desktop-compact' },
    { w: 840, h: 700, name: 'tablet-single-col' },
    { w: 600, h: 800, name: 'phablet' },
    { w: 375, h: 667, name: 'mobile-portrait' }
  ];

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.waitForTimeout(50);

    const audit = await page.evaluate(() => {
      const detail = document.getElementById('entity-detail');
      const cardpad = detail.querySelector('.cardpad');
      const toolgroup = detail.querySelector('.toolgroup');
      const rows = Array.from(detail.querySelectorAll('.toolrow'));
      const detailRect = detail.getBoundingClientRect();

      let overflowRows = 0;
      let pushedOutSwitches = 0;
      let squishedActionWidths = 0;
      const issues = [];

      rows.forEach((r, idx) => {
        if (r.scrollWidth > r.clientWidth + 1.5) {
          overflowRows++;
          issues.push(`Row ${idx} scrollWidth=${r.scrollWidth} > clientWidth=${r.clientWidth}`);
        }
        const actions = r.children[1];
        const sw = actions?.querySelector('.switch');
        if (sw) {
          const swRect = sw.getBoundingClientRect();
          if (swRect.right > detailRect.right + 1.5) {
            pushedOutSwitches++;
            issues.push(
              `Row ${idx} switch right=${swRect.right} > detailRight=${detailRect.right}`
            );
          }
        }
        if (actions) {
          const actionsRect = actions.getBoundingClientRect();
          // Actions contains at least badge (min ~60px) + badge (min ~60px) + switch (~32px) + gap -> min ~160px
          if (actionsRect.width < 140) {
            squishedActionWidths++;
            issues.push(`Row ${idx} actions width squished: ${actionsRect.width}px`);
          }
        }
      });

      return {
        detailHasOverflow: detail.scrollWidth > detail.clientWidth + 1.5,
        cardpadHasOverflow: cardpad.scrollWidth > cardpad.clientWidth + 1.5,
        toolgroupHasOverflow: toolgroup.scrollWidth > toolgroup.clientWidth + 1.5,
        overflowRows,
        pushedOutSwitches,
        squishedActionWidths,
        issues
      };
    });

    assert.equal(
      audit.detailHasOverflow,
      false,
      `[${vp.name}] #entity-detail must not horizontally overflow`
    );
    assert.equal(
      audit.cardpadHasOverflow,
      false,
      `[${vp.name}] .cardpad must not horizontally overflow`
    );
    assert.equal(
      audit.toolgroupHasOverflow,
      false,
      `[${vp.name}] .toolgroup must not horizontally overflow`
    );
    assert.equal(
      audit.overflowRows,
      0,
      `[${vp.name}] No toolrow should overflow: ${audit.issues.join('; ')}`
    );
    assert.equal(
      audit.pushedOutSwitches,
      0,
      `[${vp.name}] No switch should be pushed out: ${audit.issues.join('; ')}`
    );
    assert.equal(
      audit.squishedActionWidths,
      0,
      `[${vp.name}] Actions container must not be squished: ${audit.issues.join('; ')}`
    );
  }

  // 4. Verify line-clamp and style metrics on desktop
  await page.setViewportSize({ width: 1280, height: 800 });
  const rowStyles = await page.evaluate(() => {
    const row =
      Array.from(document.querySelectorAll('.toolrow')).find(
        r => r.querySelector('b')?.textContent === 'add_review_comment'
      ) || document.querySelector('.toolrow');
    const c1 = row.children[0];
    const c2 = row.children[1];
    const p = c1.querySelector('p');
    const s1 = window.getComputedStyle(c1);
    const s2 = window.getComputedStyle(c2);
    const sp = window.getComputedStyle(p);
    return {
      c1FlexGrow: s1.flexGrow,
      c1MinWidth: s1.minWidth,
      c2FlexShrink: s2.flexShrink,
      pLineClamp: sp.webkitLineClamp,
      pOverflow: sp.overflow
    };
  });

  assert.equal(rowStyles.c1FlexGrow, '1', 'Tool text container must have flex-grow: 1');
  assert.equal(rowStyles.c1MinWidth, '0px', 'Tool text container must have min-width: 0');
  assert.equal(rowStyles.c2FlexShrink, '0', 'Tool actions container must have flex-shrink: 0');
  assert.equal(rowStyles.pLineClamp, '2', 'Tool description must have line-clamp 2');
  assert.equal(rowStyles.pOverflow, 'hidden', 'Tool description must have overflow: hidden');

  // 5. Test switch toggling functionality
  const switchLocator = page.locator('.toolrow:has(b:text-is("create_pull_request")) .switch');
  const wasChecked = await switchLocator.getAttribute('aria-checked');
  assert.equal(wasChecked, 'false', 'create_pull_request starts unpublished');

  await switchLocator.click();
  await page.waitForTimeout(200);

  const isNowChecked = await switchLocator.getAttribute('aria-checked');
  assert.equal(isNowChecked, 'true', 'Switch toggles to published');

  // 6. Test Agent permissions tab (grantRows with 46 tools)
  await page.click('.sidebar a[href="#agents"]');
  await page.waitForSelector('.entity-layout');
  await page.click(`[data-action="select:agents:${agent.id}"]`);
  await page.click('[data-action="detail-tab:grants"]');
  await page.waitForSelector('#grants .toolgroup');

  const agentToolCount = await page.locator('#grants .toolrow').count();
  // Tools that are published: add_issue_comment, add_review_comment, get_file_contents, search_code, create_pull_request (just toggled) + any published among the other 38 tools
  assert.ok(agentToolCount > 0, 'Agent permissions tab must render tool rows');

  // Check no overflow in agent permissions tab
  const agentTabAudit = await page.evaluate(() => {
    const detail = document.getElementById('entity-detail');
    const rows = Array.from(detail.querySelectorAll('.toolrow'));
    let overflow = 0;
    rows.forEach(r => {
      if (r.scrollWidth > r.clientWidth + 1.5) overflow++;
    });
    return { detailOverflow: detail.scrollWidth > detail.clientWidth + 1.5, rowOverflow: overflow };
  });

  assert.equal(
    agentTabAudit.detailOverflow,
    false,
    'Agent detail panel must not overflow horizontally'
  );
  assert.equal(agentTabAudit.rowOverflow, 0, 'No tool row in agent permissions should overflow');

  assert.equal(
    errors.length,
    0,
    'No JavaScript errors occurred during entire test: ' + errors.join('; ')
  );
});
