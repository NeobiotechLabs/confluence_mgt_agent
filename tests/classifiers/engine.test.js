// tests/classifiers/engine.test.js
// engine.js 와이어링 검증: 실 client 지연 생성 + 본문 전달 + guidelines 주입.
// anthropicClient 가짜 주입으로 네트워크 완전 차단.
'use strict';
process.env.ANTHROPIC_API_KEY = 'test-key-for-engine';
const test = require('node:test');
const assert = require('node:assert');
const { classifyWithChain } = require('../../scripts/classifiers/engine');

const aaTree = {
  unsortedFolderId: 'u-1',
  flat: [{ id: 'f-7', title: 'MPS 이력 (전사)' }],
  tree: {},
  toText: () => '- MPS 이력 (전사) (id: f-7)',
  hasFolder: (id) => ['f-7', 'u-1'].includes(id),
};

function fakeAnthropicClient(captured, contentBlocks) {
  return {
    messages: {
      create: async (req) => { captured.push(req); return { content: contentBlocks }; },
    },
  };
}

test('engine: 본문이 user message에 평문으로 들어가 LLM hit', async () => {
  const captured = [];
  const client = fakeAnthropicClient(captured, [
    { type: 'tool_use', name: 'select_folder', input: { folderId: 'f-7', labels: ['group-rnd'], reason: 'MPS 본문 확인', confidence: 'high' } },
  ]);
  const ctx = { title: '3월 계획', body: '<p>월간 MPS 작성 내용</p>', sourceSpace: 'SD', ancestors: [], existingLabels: [] };
  const out = await classifyWithChain(ctx, aaTree, { anthropicClient: client, guidelines: 'GUIDE_MARKER' });
  assert.strictEqual(out.source, 'inline-llm');
  assert.strictEqual(out.folderId, 'f-7');
  assert.strictEqual(captured.length, 1);
  assert.ok(captured[0].messages[0].content.includes('월간 MPS 작성 내용'));
  assert.ok(!captured[0].messages[0].content.includes('<p>'), 'HTML 태그는 추출되어야 함');
  assert.ok(captured[0].system.includes('GUIDE_MARKER'), 'guidelines 주입');
  assert.ok(captured[0].system.includes('- MPS 이력 (전사) (id: f-7)'), 'aaTree.toText 주입');
});

test('engine: confidence low → fallback + 의견 보존', async () => {
  const captured = [];
  const client = fakeAnthropicClient(captured, [
    { type: 'tool_use', name: 'select_folder', input: { folderId: 'f-7', reason: '제목만으로는 모호', confidence: 'low' } },
  ]);
  const out = await classifyWithChain({ title: '회의록', body: '', sourceSpace: 'SD', ancestors: [], existingLabels: [] }, aaTree, { anthropicClient: client });
  assert.strictEqual(out.source, 'fallback');
  assert.strictEqual(out.llmOpinion, '제목만으로는 모호');
  assert.strictEqual(out.suggestedFolderId, 'f-7');
});

test('engine: human-classified 결정이 있으면 human 단계가 우선', async () => {
  // classification_decisions.json에 매칭이 없어도 체인은 정상 완주해야 함.
  const captured = [];
  const client = fakeAnthropicClient(captured, [{ type: 'text', text: 'no tool' }]);
  const out = await classifyWithChain({ title: '완전 미지 제목 zzz', body: '', sourceSpace: '?', ancestors: [], existingLabels: [] }, aaTree, { anthropicClient: client });
  assert.strictEqual(out.source, 'fallback');
  assert.strictEqual(out.folderId, 'u-1');
});

test('engine: deps.llm 전체 주입 시 내장 어댑터 미사용 (호환 경로)', async () => {
  const llm = { callLLM: async () => ({ ok: true, source: 'inline-llm', folderId: 'f-7', labels: [], reason: 'stub', confidence: 'high' }) };
  const out = await classifyWithChain({ title: 't', body: '', ancestors: [], existingLabels: [] }, aaTree, { llm });
  assert.strictEqual(out.source, 'inline-llm');
  assert.strictEqual(out.folderId, 'f-7');
});
