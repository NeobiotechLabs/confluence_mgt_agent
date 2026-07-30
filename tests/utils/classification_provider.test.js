'use strict';
// classification_provider 체인 테스트.
// deps.ruleClassifier / deps.llm 주입으로 네트워크·디스크 완전 차단.
const test = require('node:test');
const assert = require('node:assert');

const { classifyPage } = require('../../scripts/utils/classification_provider');

const aaTree = {
  unsortedFolderId: 'u-1',
  flat: [{ id: 'f-42', title: 'AI 관련' }],
  tree: {},
  toText: () => '<tree>',
  hasFolder: (id) => ['f-42', 'u-1'].includes(id),
};

const baseCtx = { title: 'AI 회의록', sourceSpace: 'SD', ancestors: [], existingLabels: [] };

// 대부분의 테스트는 LLM 단계 활성 상태를 가정. ANTHROPIC_API_KEY 키 없을 때 skip을 검증하는
// 테스트는 그 케이스에서만 명시적으로 키를 unset.
const HAS_KEY = 'test-anthropic-key';
process.env.ANTHROPIC_API_KEY = HAS_KEY;

test('chain: rule hit이면 llm은 호출되지 않는다', async () => {
  const calls = [];
  const ruleClassifier = {
    classify: async () => {
      calls.push('rule');
      return { ok: true, source: 'rule', folderId: 'f-42', labels: ['team-center'], reason: 'rule-match' };
    },
  };
  const llm = { callLLM: async () => { calls.push('llm'); return { ok: true, folderId: 'x' }; } };
  const out = await classifyPage(baseCtx, aaTree, { ruleClassifier, llm });
  assert.strictEqual(out.source, 'rule');
  assert.strictEqual(out.folderId, 'f-42');
  assert.deepStrictEqual(calls, ['rule']);
});

test('chain: rule miss → llm hit', async () => {
  const ruleClassifier = { classify: async () => ({ ok: false, source: 'miss' }) };
  let received = null;
  const llm = {
    callLLM: async (arg) => {
      received = arg;
      return { ok: true, source: 'inline-llm', folderId: 'f-42', labels: ['team-ai'], reason: 'llm-match' };
    },
  };
  const out = await classifyPage(baseCtx, aaTree, { ruleClassifier, llm });
  assert.strictEqual(out.source, 'inline-llm');
  assert.strictEqual(out.folderId, 'f-42');
  assert.ok(received, 'llm이 호출되어야 함');
  assert.strictEqual(received.model, undefined); // caller가 model을 굳이 안 줘도 됨
});

test('chain: rule miss → llm miss → fallback(unsortedFolderId, needs-review)', async () => {
  const ruleClassifier = { classify: async () => ({ ok: false, source: 'miss' }) };
  const llm = { callLLM: async () => ({ ok: false, source: 'miss', reason: 'no-tool-use' }) };
  const out = await classifyPage(baseCtx, aaTree, { ruleClassifier, llm });
  assert.strictEqual(out.source, 'fallback');
  assert.strictEqual(out.folderId, 'u-1');
  assert.deepStrictEqual(out.labels, ['needs-review']);
});

test('chain: ANTHROPIC_API_KEY 없으면 llm 단계 skip → rule miss면 fallback', async () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const ruleClassifier = { classify: async () => ({ ok: false, source: 'miss' }) };
    let llmCalled = false;
    const llm = { callLLM: async () => { llmCalled = true; return { ok: false }; } };
    const out = await classifyPage(baseCtx, aaTree, { ruleClassifier, llm });
    assert.strictEqual(out.source, 'fallback');
    assert.strictEqual(llmCalled, false, '키 없으면 LLM 호출 금지');
  } finally {
    if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
  }
});

test('chain: rule classify throw 시 다음 단계(llm) 진행', async () => {
  const ruleClassifier = { classify: async () => { throw new Error('rule-boom'); } };
  const llm = {
    callLLM: async () => ({ ok: true, source: 'inline-llm', folderId: 'f-42', labels: [], reason: 'r' }),
  };
  const out = await classifyPage(baseCtx, aaTree, { ruleClassifier, llm });
  assert.strictEqual(out.source, 'inline-llm');
});

test('chain: llm이 folderId 없으면 fallback으로 안전하게 떨어진다', async () => {
  const ruleClassifier = { classify: async () => ({ ok: false, source: 'miss' }) };
  const llm = { callLLM: async () => ({ ok: true, folderId: null }) };
  const out = await classifyPage(baseCtx, aaTree, { ruleClassifier, llm });
  // llm이 {ok:true, folderId:null}를 주면 호출자가 방어 — provider도 보정
  assert.strictEqual(out.folderId, 'u-1');
  assert.strictEqual(out.source, 'fallback');
});