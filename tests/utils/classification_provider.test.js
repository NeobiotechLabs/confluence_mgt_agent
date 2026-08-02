'use strict';
// classification_provider 체인 테스트.
// 체인: human → structural → inline-llm(본문) → fallback(미분류+의견). rule 단계 제거됨.
// deps 주입으로 네트워크·디스크 완전 차단.
const test = require('node:test');
const assert = require('node:assert');

const { classifyPage, fallback, structuralCheck } = require('../../scripts/utils/classification_provider');

const aaTree = {
  unsortedFolderId: 'u-1',
  flat: [{ id: 'f-42', title: 'AI 관련' }, { id: 'f-7', title: 'MPS 이력 (전사)' }],
  tree: {},
  toText: () => '<tree>',
  hasFolder: (id) => ['f-42', 'f-7', 'u-1'].includes(id),
};

const baseCtx = { title: 'AI 회의록', body: '본문', sourceSpace: 'SD', ancestors: [], existingLabels: [] };

const HAS_KEY = 'test-anthropic-key';
process.env.ANTHROPIC_API_KEY = HAS_KEY;

test('chain: humanClassifier hit이면 즉시 반환 (structural/llm 미호출)', async () => {
  const calls = [];
  const humanClassifier = {
    classify: async () => { calls.push('human'); return { ok: true, source: 'human', folderId: 'f-human', labels: ['human-classified'], reason: 'dec-001' }; },
  };
  const llm = { callLLM: async () => { calls.push('llm'); return { ok: true, folderId: 'x', confidence: 'high' }; } };
  const out = await classifyPage({ ...baseCtx, currentFolderId: 'f-42' }, aaTree, { humanClassifier, llm });
  assert.strictEqual(out.source, 'human');
  assert.deepStrictEqual(calls, ['human']);
});

test('chain: human throw 시 structural로 안전하게 진행', async () => {
  const humanClassifier = { classify: async () => { throw new Error('human-boom'); } };
  const out = await classifyPage({ ...baseCtx, currentFolderId: 'f-42' }, aaTree, { humanClassifier });
  assert.strictEqual(out.source, 'structural');
  assert.strictEqual(out.folderId, 'f-42');
});

test('structural: 유효 폴더에 이미 있으면 유지 — llm 호출 없음', async () => {
  let llmCalled = false;
  const llm = { callLLM: async () => { llmCalled = true; return { ok: true, folderId: 'f-7', confidence: 'high' }; } };
  const out = await classifyPage({ ...baseCtx, currentFolderId: 'f-42' }, aaTree, { llm });
  assert.strictEqual(out.source, 'structural');
  assert.strictEqual(out.folderId, 'f-42');
  assert.strictEqual(out.folderTitle, 'AI 관련');
  assert.strictEqual(llmCalled, false);
});

test('structural: 현재 폴더가 미분류(u-1)면 유지하지 않고 llm으로', async () => {
  const llm = { callLLM: async () => ({ ok: true, source: 'inline-llm', folderId: 'f-7', labels: [], reason: 'r', confidence: 'high' }) };
  const out = await classifyPage({ ...baseCtx, currentFolderId: 'u-1' }, aaTree, { llm });
  assert.strictEqual(out.source, 'inline-llm');
  assert.strictEqual(out.folderId, 'f-7');
});

test('structural: hasFolder가 없는 스텁 트리(report 경로)에서는 발동 안 함', () => {
  const stub = { unsortedFolderId: 'u-1' };
  assert.strictEqual(structuralCheck({ currentFolderId: 'f-42' }, stub), null);
});

test('structural: currentFolderId가 트리 미지 폴더면 null → 체인 계속', async () => {
  const llm = { callLLM: async () => ({ ok: true, folderId: 'f-7', labels: [], reason: 'r', confidence: 'high' }) };
  const out = await classifyPage({ ...baseCtx, currentFolderId: 'ghost' }, aaTree, { llm });
  assert.strictEqual(out.source, 'inline-llm');
});

test('chain: llm high-confidence hit → 정규화 결과 + confidence + folderTitle 해석', async () => {
  let received = null;
  const llm = {
    callLLM: async (arg) => { received = arg; return { ok: true, source: 'inline-llm', folderId: 'f-7', labels: ['group-rnd'], reason: 'MPS 본문', confidence: 'high' }; },
  };
  const out = await classifyPage(baseCtx, aaTree, { llm });
  assert.strictEqual(out.source, 'inline-llm');
  assert.strictEqual(out.folderId, 'f-7');
  assert.strictEqual(out.folderTitle, 'MPS 이력 (전사)');
  assert.strictEqual(out.confidence, 'high');
  assert.deepStrictEqual(out.labels, ['group-rnd']);
  assert.ok(received.ctx === baseCtx && received.aaTree === aaTree, 'deps.llm은 {ctx, aaTree}로 호출');
});

test('chain: llm이 트리 미지 folderId를 주면 fallback + 의견 보존', async () => {
  const llm = { callLLM: async () => ({ ok: true, folderId: 'not-in-tree', reason: '환상의 폴더', confidence: 'high' }) };
  const out = await classifyPage(baseCtx, aaTree, { llm });
  assert.strictEqual(out.source, 'fallback');
  assert.strictEqual(out.folderId, 'u-1');
  assert.strictEqual(out.reason, 'LLM이 알 수 없는 폴더 지정');
  assert.strictEqual(out.llmOpinion, '환상의 폴더');
});

test('chain: llm low-confidence miss → fallback + opinion + suggestedFolderId', async () => {
  // reason 정규화: 'low-confidence' (시스템 코드)는 reason으로 노출되지 않고
  // opinion(한국어 자연어) → reason으로 매핑되어 부록에 사람이 읽을 수 있는 텍스트로 노출.
  const llm = { callLLM: async () => ({ ok: false, source: 'miss', reason: 'low-confidence', opinion: 'DN과 Device 경합', suggestedFolderId: 'f-42' }) };
  const out = await classifyPage(baseCtx, aaTree, { llm });
  assert.strictEqual(out.source, 'fallback');
  assert.strictEqual(out.folderId, 'u-1');
  assert.deepStrictEqual(out.labels, ['needs-review']);
  assert.strictEqual(out.reason, 'DN과 Device 경합', 'reason은 opinion(한국어 자연어)으로 매핑');
  assert.strictEqual(out.llmOpinion, 'DN과 Device 경합');
  assert.strictEqual(out.suggestedFolderId, 'f-42');
});

test('chain: 기계적 miss(no-tool-use) → fallback, 의견 없으면 분류 실패', async () => {
  const llm = { callLLM: async () => ({ ok: false, source: 'miss', reason: 'no-tool-use', opinion: null }) };
  const out = await classifyPage(baseCtx, aaTree, { llm });
  assert.strictEqual(out.source, 'fallback');
  assert.strictEqual(out.reason, '분류 실패', 'opinion 없으면 분류 실패');
  assert.strictEqual(out.llmOpinion, null);
});

test('chain: ANTHROPIC_API_KEY 없으면 llm skip → fallback(llm-skipped-no-key)', async () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    let llmCalled = false;
    const llm = { callLLM: async () => { llmCalled = true; return { ok: false }; } };
    const out = await classifyPage(baseCtx, aaTree, { llm });
    assert.strictEqual(out.source, 'fallback');
    assert.strictEqual(out.reason, 'API 키 없음으로 LLM 건너뜀');
    assert.strictEqual(llmCalled, false, '키 없으면 LLM 호출 금지');
  } finally {
    process.env.ANTHROPIC_API_KEY = prev;
  }
});

test('chain: llm throw 시 fallback으로 흡수', async () => {
  const llm = { callLLM: async () => { throw new Error('llm-boom'); } };
  const out = await classifyPage(baseCtx, aaTree, { llm });
  assert.strictEqual(out.source, 'fallback');
  assert.strictEqual(out.folderId, 'u-1');
});

test('chain: ruleClassifier를 deps에 넘겨도 무시된다 (rule 단계 제거)', async () => {
  let ruleCalled = false;
  const ruleClassifier = { classify: async () => { ruleCalled = true; return { ok: true, folderId: 'f-42' }; } };
  const llm = { callLLM: async () => ({ ok: true, folderId: 'f-7', labels: [], reason: 'r', confidence: 'high' }) };
  const out = await classifyPage(baseCtx, aaTree, { ruleClassifier, llm });
  assert.strictEqual(ruleCalled, false);
  assert.strictEqual(out.source, 'inline-llm');
});

test('fallback: info 없으면 기본 reason, labels는 needs-review', () => {
  const out = fallback(aaTree);
  assert.strictEqual(out.source, 'fallback');
  assert.strictEqual(out.folderId, 'u-1');
  assert.strictEqual(out.folderTitle, '미분류');
  assert.deepStrictEqual(out.labels, ['needs-review']);
  assert.strictEqual(out.reason, '분류 실패');
  assert.strictEqual(out.llmOpinion, null);
  assert.strictEqual(out.suggestedFolderId, null);
});
