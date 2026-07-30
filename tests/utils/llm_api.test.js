'use strict';
// llm_api의 단위 테스트.
// deps.client 주입으로 네트워크 완전 차단.
const test = require('node:test');
const assert = require('node:assert');

const { callLLM } = require('../../scripts/utils/llm_api');

function fakeClient(contentBlocks) {
  return {
    messages: { create: async () => ({ content: contentBlocks }) },
  };
}

test('callLLM: tool_use 블록에서 folderId/labels/reason을 추출', async () => {
  const client = fakeClient([
    {
      type: 'tool_use',
      name: 'select_folder',
      input: { folderId: 'F-42', labels: ['team-center'], reason: 'AI 분류' },
    },
  ]);
  const out = await callLLM({
    client,
    system: 'sys',
    user: 'u',
    tools: [{ name: 'select_folder' }],
    model: 'claude-haiku-4-5-20251001',
  });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.folderId, 'F-42');
  assert.deepStrictEqual(out.labels, ['team-center']);
  assert.strictEqual(out.reason, 'AI 분류');
  assert.strictEqual(out.source, 'inline-llm');
});

test('callLLM: tool_use가 없으면 miss', async () => {
  const client = fakeClient([{ type: 'text', text: 'I cannot classify.' }]);
  const out = await callLLM({
    client,
    system: 'sys',
    user: 'u',
    tools: [{ name: 'select_folder' }],
    model: 'm',
  });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.source, 'miss');
});

test('callLLM: folderId 누락이면 miss', async () => {
  const client = fakeClient([
    { type: 'tool_use', name: 'select_folder', input: { labels: [] } },
  ]);
  const out = await callLLM({ client, system: 's', user: 'u', tools: [], model: 'm' });
  assert.strictEqual(out.ok, false);
});

test('callLLM: client throw 시 miss로 흡수 (per-page catch 호환)', async () => {
  const client = {
    messages: {
      create: async () => { throw new Error('boom 500'); },
    },
  };
  const out = await callLLM({ client, system: 's', user: 'u', tools: [], model: 'm' });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.source, 'miss');
  assert.match(out.reason, /boom/);
});