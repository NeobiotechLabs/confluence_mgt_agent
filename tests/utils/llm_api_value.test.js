'use strict';
const test = require('node:test');
const assert = require('node:assert');

const { callLLMForMigrationValue } = require('../../scripts/utils/llm_api');

function fakeClient(toolInput) {
  return {
    messages: {
      create: async () => ({
        content: toolInput === null
          ? [{ type: 'text', text: 'no tool use' }]
          : [{ type: 'tool_use', name: 'select_migration_value', input: toolInput }],
      }),
    },
  };
}

test('callLLMForMigrationValue: 정상 — verdict=dropped', async () => {
  const r = await callLLMForMigrationValue({
    client: fakeClient({ verdict: 'dropped', reason: '개인 메모' }),
    title: 'T', body: 'B', treeText: 'tree',
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.verdict, 'dropped');
  assert.strictEqual(r.reason, '개인 메모');
});

test('callLLMForMigrationValue: 정상 — unclassified + suggestedFolderId', async () => {
  const r = await callLLMForMigrationValue({
    client: fakeClient({ verdict: 'unclassified', reason: '둘 다', suggestedFolderId: '102' }),
    title: 'T', body: 'B', treeText: 'tree',
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.verdict, 'unclassified');
  assert.strictEqual(r.suggestedFolderId, '102');
});

test('callLLMForMigrationValue: tool_use 없음 → ok=false', async () => {
  const r = await callLLMForMigrationValue({
    client: fakeClient(null),
    title: 'T', body: 'B', treeText: 'tree',
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-tool-use');
});

test('callLLMForMigrationValue: client 없음 → ok=false, reason=no-client', async () => {
  const r = await callLLMForMigrationValue({
    client: null, title: 'T', body: 'B', treeText: 'tree',
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-client');
});

test('callLLMForMigrationValue: client throw → ok=false, reason=api-error:…', async () => {
  const r = await callLLMForMigrationValue({
    client: { messages: { create: async () => { throw new Error('boom'); } } },
    title: 'T', body: 'B', treeText: 'tree',
  });
  assert.strictEqual(r.ok, false);
  assert.ok(r.reason.startsWith('api-error:'));
});
