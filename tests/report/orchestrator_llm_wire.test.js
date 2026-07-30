// tests/report/orchestrator_llm_wire.test.js
'use strict';
// 작업 9 (Phase 2-B) — runMisplacementRecommend의 llmResults 와이어업 TDD.
// 정책: reference/classification_rules.md §8 (사용자 결정 2026-07-30).
//
// §8-3 (Phase 2-B) 변경:
//   - runMisplacementRecommend는 의심 후보(KB 카테고리 ≠ parentId)에 대해서만 classifyPage를 호출.
//   - classifyPage 결과를 llmResults에 캐싱 → runMisplacementRecommend가 동일 page에 대해 reason/suggestedFolderFor를 재계산.
//   - 의도: LLM reason 어휘 가중치(정확히 +0.35, 유사 +0.20 등)로 confidence 가중.
//
// 핵심 최적화:
//   - KB categoryOf(page) === page.parentId (이미 일치) → classifyPage 호출 안 함 (비용/rate limit 절감)
//   - KB categoryOf(page) === null (KB 모름) → classifyPage 호출 안 함 (Phase 3 자리표시)
//   - KB categoryOf(page) !== page.parentId (의심) → classifyPage 호출 → suggestedFolderId = llmResult.folderId
//
// 옵션 추가:
//   classifyDeps?: { ruleClassifier, llm, systemHasKey } — 기본값: llm=null → 미호출, KB 폴더만 사용

const test = require('node:test');
const assert = require('node:assert');
const { runMisplacementRecommend } = require('../../scripts/report_aa_daily');

test('RED 1 — 의심 후보(KB ≠ parent)에만 classifyPage가 호출된다 (rate limit 절감)', async () => {
  const calls = [];
  const fakeLLM = {
    async callLLM({ ctx }) {
      calls.push(ctx.page.id);
      return { ok: true, folderId: 'F-A', folderTitle: '캘리브', reason: '정확히 일치', labels: [] };
    },
  };
  const pages = [
    { id: 'p1', title: '캘리브 회의록', parentId: 'F-B', labels: [], ancestors: [] }, // 의심
    { id: 'p2', title: '캘리브 회의록', parentId: 'F-A', labels: [], ancestors: [] }, // 일치 → skip
    { id: 'p3', title: '잡페이지', parentId: 'F-X', labels: [], ancestors: [] },      // KB null → skip
  ];
  const advisories = [];
  await runMisplacementRecommend({
    pages,
    history: [],
    todayStr: '2026-07-30',
    kb: { rules: [{ id: 'F-A', match: { title_patterns: ['^캘리브'] } }] },
    llmResults: {},
    unsortedFolderId: 'F-UNS',
    advisories,
    classifyDeps: {
      ruleClassifier: null,
      llm: fakeLLM,
      systemHasKey: true,
    },
  });
  // p1만 호출 (p2는 KB=parent → skip, p3는 KB null → skip)
  assert.deepStrictEqual(calls, ['p1']);
});

test('RED 2 — LLM reason "정확히 일치"면 confidence가 0.5 + 0.35 = 0.85', async () => {
  const fakeLLM = {
    async callLLM() {
      return { ok: true, folderId: 'F-A', folderTitle: '캘리브', reason: '제목이 정확히 일치', labels: [] };
    },
  };
  const pages = [{ id: 'p1', title: '캘리브 회의록', parentId: 'F-B', labels: [], ancestors: [] }];
  const advisories = [];
  const out = await runMisplacementRecommend({
    pages,
    history: [],
    todayStr: '2026-07-30',
    kb: { rules: [{ id: 'F-A', match: { title_patterns: ['^캘리브'] } }] },
    llmResults: {},
    unsortedFolderId: 'F-UNS',
    advisories,
    classifyDeps: { ruleClassifier: null, llm: fakeLLM, systemHasKey: true },
  });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].confidence, 0.85);
});

test('RED 3 — 외부 llmResults가 fallback 폴더를 추천하면 잡음 제거 (confidence < 0.5)', async () => {
  // classifyPage 경로가 아니라 외부 llmResults 주입 시나리오.
  // Phase 2-B 코드에서는 자체적으로 fallback 폴더 skip하지만, 외부 주입은 신뢰.
  const pages = [{ id: 'p1', title: '캘리브 회의록', parentId: 'F-B', labels: [], ancestors: [] }];
  const advisories = [];
  const out = await runMisplacementRecommend({
    pages,
    history: [],
    todayStr: '2026-07-30',
    kb: { rules: [{ id: 'F-A', match: { title_patterns: ['^캘리브'] } }] },
    llmResults: { p1: { folderId: 'F-UNS', source: 'fallback', reason: '분류 불가' } },
    unsortedFolderId: 'F-UNS',
    advisories,
    // classifyDeps 미지정 → 외부 llmResults 사용
  });
  // LLM이 미분류 폴더 추천 + reason "분류 불가" → confidence 0.30 < threshold 0.5 → skip
  assert.strictEqual(out.length, 0);
});

test('RED 4 — classifyDeps 없으면 llmResults/llm 호출 없이 KB 폴더만 사용 (기존 호환)', async () => {
  // llmResults에 이미 결과가 있으면 (외부에서 주입) 그걸 사용. classifyDeps 없으면 호출 안 함.
  const pages = [{ id: 'p1', title: '캘리브 회의록', parentId: 'F-B', labels: [], ancestors: [] }];
  const advisories = [];
  const out = await runMisplacementRecommend({
    pages,
    history: [],
    todayStr: '2026-07-30',
    kb: { rules: [{ id: 'F-A', match: { title_patterns: ['^캘리브'] } }] },
    llmResults: { p1: { folderId: 'F-A', source: 'inline-llm', reason: '정확히 일치' } },
    unsortedFolderId: 'F-UNS',
    advisories,
    // classifyDeps 미지정 → 호출 없음, llmResults 사용
  });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].confidence, 0.85);
});

test('RED 5 — classifyDeps에 systemHasKey=false면 LLM 호출 skip (CI/오프라인)', async () => {
  let called = false;
  const fakeLLM = {
    async callLLM() { called = true; return { ok: true, folderId: 'F-A', reason: 'ok' }; },
  };
  const pages = [{ id: 'p1', title: '캘리브 회의록', parentId: 'F-B', labels: [], ancestors: [] }];
  const advisories = [];
  await runMisplacementRecommend({
    pages,
    history: [],
    todayStr: '2026-07-30',
    kb: { rules: [{ id: 'F-A', match: { title_patterns: ['^캘리브'] } }] },
    llmResults: {},
    unsortedFolderId: 'F-UNS',
    advisories,
    classifyDeps: { ruleClassifier: null, llm: fakeLLM, systemHasKey: false },
  });
  assert.strictEqual(called, false);
});

test('RED 6 — classifyPage throw 시 per-page catch로 흡수, runMisplacementRecommend는 계속 (크래시 없음)', async () => {
  const fakeLLM = {
    async callLLM() { throw new Error('rate limit'); },
  };
  const pages = [
    { id: 'p1', title: '캘리브 회의록', parentId: 'F-B', labels: [], ancestors: [] },
    { id: 'p2', title: '캘리브 회의록', parentId: 'F-C', labels: [], ancestors: [] },
  ];
  const advisories = [];
  // throw가 났지만 runMisplacementRecommend가 Promise reject 없이 완료 (per-page catch 검증)
  const out = await runMisplacementRecommend({
    pages,
    history: [],
    todayStr: '2026-07-30',
    kb: { rules: [{ id: 'F-A', match: { title_patterns: ['^캘리브'] } }] },
    llmResults: {},
    unsortedFolderId: 'F-UNS',
    advisories,
    classifyDeps: { ruleClassifier: null, llm: fakeLLM, systemHasKey: true },
  });
  // throw 흡수 → llmResults 비어 있음 → reason='' → confidence 0.5 (base) → threshold 통과 → 2건 진입
  // KB 폴더(F-A)가 suggestedFolderId로 잡힘. (LLM reason 없으므로 가중치 0)
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].suggestedFolderId, 'F-A');
  assert.strictEqual(out[0].confidence, 0.5);
  // throw도 promiserejection도 안 일어남 (위 await 자체가 성공 = 검증)
});
