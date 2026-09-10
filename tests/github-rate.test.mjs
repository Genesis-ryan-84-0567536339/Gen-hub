import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';
import { githubRetryAt } from '../server/github-rate.mjs';

test('GitHub retry time distinguishes permission errors and supports reset/retry-after headers', () => {
  const now = Date.now();
  assert.equal(githubRetryAt({ status: 403, headers: new Headers() }, now), null);
  assert.equal(
    Date.parse(githubRetryAt({ status: 429, headers: new Headers({ 'retry-after': '120' }) }, now)),
    now + 120000
  );
  assert.equal(
    Date.parse(
      githubRetryAt(
        {
          status: 403,
          headers: new Headers({
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(Math.floor(now / 1000) + 3600)
          })
        },
        now
      )
    ),
    (Math.floor(now / 1000) + 3600) * 1000
  );
});
test('rate-limited CI cannot inherit an old success and even forced checks respect backoff', async t => {
  const current = 'a'.repeat(40),
    newer = 'b'.repeat(40);
  let requests = 0;
  const retry = Math.floor(Date.now() / 1000) + 3600;
  const x = await fixture(t, null, {
    revision: current,
    fetchFn: async url => {
      requests++;
      return url.includes('/commits/')
        ? { ok: true, status: 200, json: async () => ({ sha: newer }) }
        : {
            ok: false,
            status: 403,
            headers: new Headers({
              'x-ratelimit-remaining': '0',
              'x-ratelimit-reset': String(retry)
            })
          };
    }
  });
  x.hub.store.put('system', 'update_check', {
    latestRevision: 'c'.repeat(40),
    ciStatus: 'success',
    timestamp: 1
  });
  const response = await x.call('/api/check-update', 'POST');
  assert.equal(response.data.ciStatus, 'unknown');
  assert.equal(Date.parse(response.data.nextRetryAt), retry * 1000);
  assert.match(response.data.error, /tạm thời/);
  const count = requests;
  await x.call('/api/check-update', 'POST');
  assert.equal(requests, count);
});
