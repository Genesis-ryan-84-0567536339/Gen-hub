import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { createHub } from '../server/app.mjs';
import { formatNotification } from '../public/notifications.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Issue #34: /api/state exposes update info with current revision and timestamps', async t => {
  const currentRev = '1111111111111111111111111111111111111111';
  const currentUpdated = '2026-09-10T10:00:00.000Z';

  const x = await fixture(t, null, {
    revision: currentRev,
    updatedAt: currentUpdated
  });

  const res = await x.call('/api/state');
  assert.equal(res.status, 200);
  assert.ok(res.data.update, 'state should contain update object');
  assert.equal(res.data.update.revision, currentRev);
  assert.equal(res.data.update.updatedAt, currentUpdated);
  assert.equal(res.data.update.hasUpdate, false);
});

test('Issue #34: revision upgrade detection preserves previous version and records system.update audit', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'genhub-upgrade-test-'));
  const rev1 = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555';
  const rev2 = 'ffff66667777888899990000aaaabbbbccccdddd';

  try {
    // 1. Initial startup on rev1
    const hub1 = createHub({ dir, revision: rev1, updatedAt: '2026-09-10T08:00:00.000Z' });
    assert.equal(hub1.store.get('system', 'version')?.revision, rev1);
    assert.equal(hub1.store.get('system', 'previous_version'), null);
    hub1.close();

    // 2. Restart on rev2 (simulating auto-update container restart)
    const hub2 = createHub({ dir, revision: rev2, updatedAt: '2026-09-10T09:00:00.000Z' });
    assert.equal(hub2.store.get('system', 'version')?.revision, rev2);
    const prev = hub2.store.get('system', 'previous_version');
    assert.ok(prev, 'previous_version must be saved');
    assert.equal(prev.revision, rev1);

    // Verify audit log
    const logs = hub2.store.logs(10);
    const updateLog = logs.find(l => l.tool === 'system.update');
    assert.ok(updateLog, 'system.update audit log must be recorded');
    assert.equal(updateLog.actor, 'system');
    assert.equal(updateLog.input?.previous, rev1);
    assert.equal(updateLog.output?.revision, rev2);

    hub2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Issue #34: POST /api/check-update triggers immediate check and identifies new revision and CI status', async t => {
  const currentRev = '1111111111111111111111111111111111111111';
  const remoteRev = '2222222222222222222222222222222222222222';
  let fetchCount = 0;

  const mockFetch = async (url, opts) => {
    fetchCount++;
    if (url.includes('/commits/main')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          sha: remoteRev,
          commit: {
            message: 'feat: new dashboard capability (#36)',
            committer: { date: '2026-09-10T11:00:00Z' }
          }
        })
      };
    }
    if (url.includes('/actions/workflows/ci.yml/runs')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          workflow_runs: [
            {
              head_sha: remoteRev,
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
    fetchFn: mockFetch
  });

  const res = await x.call('/api/check-update', 'POST');
  assert.equal(res.status, 200);
  assert.equal(res.data.hasUpdate, true);
  assert.equal(res.data.latestRevision, remoteRev);
  assert.equal(res.data.latestCommitMessage, 'feat: new dashboard capability (#36)');
  assert.equal(res.data.ciStatus, 'success');
  assert.equal(res.data.error, null);

  // Check that /api/state now reflects hasUpdate
  const stateRes = await x.call('/api/state');
  assert.equal(stateRes.status, 200);
  assert.equal(stateRes.data.update.hasUpdate, true);
  assert.equal(stateRes.data.update.latestRevision, remoteRev);

  // Check audit record
  const logs = x.hub.store.logs(5);
  const checkLog = logs.find(l => l.tool === 'system.check_update');
  assert.ok(checkLog, 'system.check_update must be logged in audit');
  assert.equal(checkLog.output.hasUpdate, true);
});

test('Issue #34: 30-minute caching avoids duplicate remote fetches unless force=true', async t => {
  const currentRev = '1111111111111111111111111111111111111111';
  let commitFetches = 0;

  const mockFetch = async (url) => {
    if (url.includes('/commits/main')) {
      commitFetches++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          sha: currentRev,
          commit: {
            message: 'chore: maintain Gen-hub',
            committer: { date: '2026-09-10T09:00:00Z' }
          }
        })
      };
    }
    return { ok: true, status: 200, json: async () => ({ workflow_runs: [] }) };
  };

  const x = await fixture(t, null, {
    revision: currentRev,
    fetchFn: mockFetch
  });

  // 1. Initial check
  await x.hub.checkRemoteUpdate(true);
  assert.equal(commitFetches, 1);

  // 2. Non-forced check within TTL should hit cache
  const cachedResult = await x.hub.checkRemoteUpdate(false);
  assert.equal(commitFetches, 1, 'commit fetch count must not increase on cached check');
  assert.equal(cachedResult.hasUpdate, false);

  // 3. Forced check bypasses cache
  await x.hub.checkRemoteUpdate(true);
  assert.equal(commitFetches, 2, 'forced check must query remote API');
});

test('Issue #34: handles GitHub API rate limits and network errors gracefully', async t => {
  const currentRev = '1111111111111111111111111111111111111111';

  // Rate limited mock
  const rateLimitFetch = async () => ({
    ok: false,
    status: 403,
    json: async () => ({ message: 'API rate limit exceeded' })
  });

  const x = await fixture(t, null, {
    revision: currentRev,
    fetchFn: rateLimitFetch
  });

  const res = await x.call('/api/check-update', 'POST');
  assert.equal(res.status, 200, 'must not return 500 when rate limited');
  assert.ok(res.data.error.includes('rate limit') || res.data.error.includes('Giới hạn'), 'must report rate limit error');
  assert.equal(res.data.hasUpdate, false);

  // Network error mock
  const networkErrorFetch = async () => {
    throw new Error('ETIMEDOUT: Connection timed out');
  };

  const xNet = await fixture(t, null, {
    revision: currentRev,
    fetchFn: networkErrorFetch
  });

  const resNet = await xNet.call('/api/check-update', 'POST');
  assert.equal(resNet.status, 200, 'must not crash on network error');
  assert.ok(resNet.data.error.includes('ETIMEDOUT'));
});

test('Issue #34: formatNotification formats system.update and system.check_update logs', () => {
  const updateNotif = formatNotification({
    id: 101,
    created: '2026-09-10T12:00:00.000Z',
    actor: 'system',
    mcp: 'hub',
    tool: 'system.update',
    status: 'success',
    input: { previous: '1111111111111111111111111111111111111111' },
    output: { revision: '2222222222222222222222222222222222222222' }
  });

  assert.equal(updateNotif.title, 'Gen-hub đã cập nhật');
  assert.ok(updateNotif.message.includes('2222222'));
  assert.equal(updateNotif.level, 'info');
  assert.equal(updateNotif.icon, 'shield');

  const checkNotifHasUpdate = formatNotification({
    id: 102,
    created: '2026-09-10T12:05:00.000Z',
    actor: 'owner',
    mcp: 'hub',
    tool: 'system.check_update',
    status: 'success',
    input: {},
    output: { hasUpdate: true, latestRevision: '3333333333333333333333333333333333333333' }
  });

  assert.equal(checkNotifHasUpdate.title, 'Kiểm tra cập nhật');
  assert.ok(checkNotifHasUpdate.message.includes('3333333'));

  const checkNotifNoUpdate = formatNotification({
    id: 103,
    created: '2026-09-10T12:10:00.000Z',
    actor: 'owner',
    mcp: 'hub',
    tool: 'system.check_update',
    status: 'success',
    input: {},
    output: { hasUpdate: false }
  });

  assert.equal(checkNotifNoUpdate.title, 'Kiểm tra cập nhật');
  assert.ok(checkNotifNoUpdate.message.includes('mới nhất'));
});
