'use strict';
// assessMigrationValue 단일 책임 테스트.
// 분류(어디에 넣을지)와 가치(들일지 말지)는 다른 평가 기준이므로 LLM 호출을 분리한다.
// deps 주입으로 네트워크·외부 의존 완전 차단.
const test = require('node:test');
const assert = require('node:assert');

const { assessMigrationValue } = require('../../scripts/utils/migration_value');

function makeDeps(llmResult) {
  return {
    llm: { callLLMForMigrationValue: async () => llmResult },
  };
}

test('assessMigrationValue: verdict=create → 그대로 반환', async () => {
  const r = await assessMigrationValue(
    { pageId: 'p1', title: 'T', body: 'B' },
    { toText: () => 'tree', unsortedFolderId: '999' },
    makeDeps({ ok: true, verdict: 'create', reason: '보통 회의록' })
  );
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.verdict, 'create');
  assert.strictEqual(r.reason, '보통 회의록');
  assert.strictEqual(r.source, 'inline-llm-value');
});

test('assessMigrationValue: verdict=unclassified + suggestedFolderId 보존', async () => {
  const r = await assessMigrationValue(
    { pageId: 'p1', title: 'T', body: 'B' },
    { toText: () => 'tree', unsortedFolderId: '999' },
    makeDeps({ ok: true, verdict: 'unclassified', reason: '둘 다 가능', suggestedFolderId: '102' })
  );
  assert.strictEqual(r.verdict, 'unclassified');
  assert.strictEqual(r.suggestedFolderId, '102');
});

test('assessMigrationValue: verdict=dropped + reason 보존', async () => {
  const r = await assessMigrationValue(
    { pageId: 'p1', title: 'T', body: 'B' },
    { toText: () => 'tree', unsortedFolderId: '999' },
    makeDeps({ ok: true, verdict: 'dropped', reason: '개인 메모' })
  );
  assert.strictEqual(r.verdict, 'dropped');
  assert.strictEqual(r.reason, '개인 메모');
});

test('assessMigrationValue: LLM throw → {ok:false, verdict:create}', async () => {
  const r = await assessMigrationValue(
    { pageId: 'p1', title: 'T', body: 'B' },
    { toText: () => 'tree' },
    { llm: { callLLMForMigrationValue: async () => { throw new Error('boom'); } } }
  );
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.verdict, 'create');
  assert.ok(r.reason.includes('boom'));
});

test('assessMigrationValue: llm deps 없음 → verdict=create 보수 fallback', async () => {
  const r = await assessMigrationValue(
    { pageId: 'p1', title: 'T', body: 'B' },
    { toText: () => 'tree' },
    {} // no llm
  );
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.verdict, 'create');
  assert.strictEqual(r.reason, 'no-llm-deps');
});

test('assessMigrationValue: 모르는 verdict enum → create로 정규화', async () => {
  const r = await assessMigrationValue(
    { pageId: 'p1', title: 'T', body: 'B' },
    { toText: () => 'tree' },
    makeDeps({ ok: true, verdict: 'unknown', reason: 'x' })
  );
  assert.strictEqual(r.verdict, 'create');
  assert.ok(r.reason.includes('normalize'));
});

test('assessMigrationValue: verdict 누락 → create로 정규화', async () => {
  const r = await assessMigrationValue(
    { pageId: 'p1', title: 'T', body: 'B' },
    { toText: () => 'tree' },
    makeDeps({ ok: true, reason: 'x' })
  );
  assert.strictEqual(r.verdict, 'create');
});

test('assessMigrationValue: llm 응답 ok=false → create 보수 fallback', async () => {
  const r = await assessMigrationValue(
    { pageId: 'p1', title: 'T', body: 'B' },
    { toText: () => 'tree' },
    makeDeps({ ok: false, reason: 'no-folder-id' })
  );
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.verdict, 'create');
  assert.strictEqual(r.reason, 'no-folder-id');
});
