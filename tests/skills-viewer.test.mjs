import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';

const envelope = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }], isError: false });

function b64(str) {
  return Buffer.from(str, 'utf8').toString('base64');
}

const GLOBAL_INDEX = `
meta_skill:
  ten: meta-loader
  duong_dan: skills/meta-loader/SKILL.md
categories:
  - ten: work-style
    index: skills/work-style/index.yaml
    trigger:
      - "phối hợp"
`;

const CATEGORY_INDEX = `
leaves:
  - ten: scope-control
    path: skills/work-style/subskills/scope-control/SKILL.md
    trigger:
      - "kiểm soát phạm vi"
`;

test('Skills viewer: reads tree from GitHub, requires connector + brainRepo, rejects path traversal', async t => {
  const calls = [];
  const connector = {
    call: async (m, name, a) => {
      calls.push({ name, args: a });
      if (name === 'get_file_contents') {
        if (a.path === 'skills/index.yaml') return envelope({ content: b64(GLOBAL_INDEX) });
        if (a.path === 'skills/work-style/index.yaml') return envelope({ content: b64(CATEGORY_INDEX) });
        return envelope({ content: b64('---\nten: scope-control\n---\n# body') });
      }
      throw new Error('unexpected tool ' + name);
    }
  };
  const x = await fixture(t, connector);

  // 1. No GitHub connector -> clear error
  const noConn = await x.call('/api/skills');
  assert.equal(noConn.status, 400);

  // 2. Seed connected GitHub connector
  x.hub.store.put('mcp', 'mcp-gh-test', {
    id: 'mcp-gh-test',
    provider: 'github',
    name: 'GitHub',
    on: true,
    status: 'connected',
    secret: x.hub.store.seal({ token: 'test-token' }),
    tools: []
  });

  // 3. No brainRepo configured -> clear error
  const noRepo = await x.call('/api/skills');
  assert.equal(noRepo.status, 400);

  // 4. With repo query param, tree loads correctly
  const tree = await x.call('/api/skills?repo=' + encodeURIComponent('acme/brain'));
  assert.equal(tree.status, 200);
  assert.equal(tree.data.categories.length, 1);
  assert.equal(tree.data.categories[0].ten, 'work-style');
  assert.equal(tree.data.categories[0].leaves.length, 1);
  assert.equal(tree.data.categories[0].leaves[0].ten, 'scope-control');
  assert.deepEqual(calls.map(c => c.args.path), [
    'skills/index.yaml',
    'skills/work-style/index.yaml'
  ]);

  // 5. Persisted brainRepo used when no query param given
  await x.call('/api/settings', 'PATCH', { brainRepo: 'acme/brain' });
  const treeFromSetting = await x.call('/api/skills');
  assert.equal(treeFromSetting.status, 200);
  assert.equal(treeFromSetting.data.categories.length, 1);

  // 6. Leaf content fetch
  const leaf = await x.call(
    '/api/skills/leaf?path=' + encodeURIComponent('skills/work-style/subskills/scope-control/SKILL.md')
  );
  assert.equal(leaf.status, 200);
  assert.ok(leaf.data.content.includes('ten: scope-control'));

  // 7. Path traversal rejected
  const traversal = await x.call('/api/skills/leaf?path=' + encodeURIComponent('../../etc/passwd'));
  assert.equal(traversal.status, 400);
});

test('Skills viewer: works with provider github-mcp (shape captured from real production get_file_contents)', async t => {
  const connector = {
    call: async (m, name, a) => {
      if (name !== 'get_file_contents') throw new Error('unexpected tool ' + name);
      // Shape thật của remote MCP chính thức: item đầu là thông báo trạng thái,
      // nội dung thật nằm ở item type 'resource'.resource.text (plain text).
      const bodies = {
        'skills/index.yaml': GLOBAL_INDEX,
        'skills/work-style/index.yaml': CATEGORY_INDEX
      };
      return {
        content: [
          { type: 'text', text: 'successfully downloaded text file (SHA: abc)' },
          { type: 'resource', resource: { uri: 'x', mimeType: 'text/plain', text: bodies[a.path] || '' } }
        ]
      };
    }
  };
  const x = await fixture(t, connector);
  x.hub.store.put('mcp', 'mcp-gh-mcp-test', {
    id: 'mcp-gh-mcp-test',
    provider: 'github-mcp',
    name: 'GitHub MCP',
    on: true,
    status: 'connected',
    secret: x.hub.store.seal({ token: 'test-token' }),
    tools: []
  });
  const tree = await x.call('/api/skills?repo=' + encodeURIComponent('acme/brain'));
  assert.equal(tree.status, 200);
  assert.equal(tree.data.categories[0].ten, 'work-style');
  assert.equal(tree.data.categories[0].leaves[0].ten, 'scope-control');
});
