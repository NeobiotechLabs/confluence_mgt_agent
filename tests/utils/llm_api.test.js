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

// ── Task 3: callLLMForClassification + 확장 정규화 ──────────────────────────
const { callLLMForClassification } = require('../../scripts/utils/llm_api');

test('callLLM: 성공 결과에 confidence passthrough', async () => {
  const client = fakeClient([
    { type: 'tool_use', name: 'select_folder', input: { folderId: 'F-1', confidence: 'high', reason: 'r' } },
  ]);
  const out = await callLLM({ client, system: 's', user: 'u', tools: [], model: 'm' });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.confidence, 'high');
});

test('callLLM: no-folder-id miss는 모델 reason을 opinion에 담는다', async () => {
  const client = fakeClient([
    { type: 'tool_use', name: 'select_folder', input: { reason: '본문이 MPS처럼 보임' } },
  ]);
  const out = await callLLM({ client, system: 's', user: 'u', tools: [], model: 'm' });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'no-folder-id');
  assert.strictEqual(out.opinion, '본문이 MPS처럼 보임');
});

test('callLLMForClassification: system/user/tools를 조립해서 callFn에 전달', async () => {
  let received = null;
  const callFn = async (arg) => { received = arg; return { ok: true, source: 'inline-llm', folderId: 'F-9', labels: ['group-ai'], reason: '명확', confidence: 'high' }; };
  const out = await callLLMForClassification({
    client: {}, title: '월간 MPS', body: '<p>MPS 본문</p>',
    treeText: '- MPS 이력 (id: F-9)', guidelines: 'GUIDE', callFn,
  });
  assert.ok(received.system.includes('GUIDE'));
  assert.ok(received.system.includes('- MPS 이력 (id: F-9)'));
  assert.ok(received.user.includes('월간 MPS'));
  assert.ok(received.user.includes('MPS 본문'), 'HTML이 추출된 평문이 들어가야 함');
  assert.ok(!received.user.includes('<p>'), '태그는 들어가면 안 됨');
  assert.strictEqual(received.tools.length, 1);
  assert.strictEqual(received.tools[0].name, 'select_folder');
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.folderId, 'F-9');
  assert.strictEqual(out.confidence, 'high');
});

test('callLLMForClassification: confidence low → miss + opinion + suggestedFolderId', async () => {
  const callFn = async () => ({ ok: true, source: 'inline-llm', folderId: 'F-3', labels: [], reason: '둘 다 비슷', confidence: 'low' });
  const out = await callLLMForClassification({ client: {}, title: 't', body: '', treeText: '', guidelines: '', callFn });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'low-confidence');
  assert.strictEqual(out.opinion, '둘 다 비슷');
  assert.strictEqual(out.suggestedFolderId, 'F-3');
});

test('callLLMForClassification: confidence 미상(undefined)은 low로 취급', async () => {
  const callFn = async () => ({ ok: true, source: 'inline-llm', folderId: 'F-3', labels: [], reason: 'r' });
  const out = await callLLMForClassification({ client: {}, title: 't', body: '', treeText: '', guidelines: '', callFn });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'low-confidence');
});

test('callLLMForClassification: callFn miss는 reason/opinion 통과 (의견 없으면 일반화 텍스트)', async () => {
  const callFn = async () => ({ ok: false, source: 'miss', reason: 'no-tool-use', opinion: null });
  const out = await callLLMForClassification({ client: {}, title: 't', body: '', treeText: '', guidelines: '', callFn });
  assert.strictEqual(out.ok, false);
  // reason은 시스템 진단값('no-tool-use')으로 보존 — classification_provider가 fallback reason으로 사용.
  assert.strictEqual(out.reason, 'no-tool-use');
  // opinion이 null이면 sanitizeReason 기본값으로 치환.
  assert.strictEqual(out.opinion, '분류 근거는 폴더 적합성만으로 충분');
});

test('callLLMForClassification: 기본 callFn은 callLLM — client 없으면 no-client miss', async () => {
  const out = await callLLMForClassification({ client: null, title: 't', body: '', treeText: '', guidelines: '' });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.reason, 'no-client');
});