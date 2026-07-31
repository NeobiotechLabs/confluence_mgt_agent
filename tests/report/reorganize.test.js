// tests/report/reorganize.test.js
// 재상정(regression): 스페이스 홈페이지(parentId=null)는 절대 이동 대상이 아니며,
// 홈페이지 ID 미해결 시에는 이동 전체가 스킵(degraded)되어야 한다.
// deps 주입으로 네트워크 없이 밀폐(hermetic) 검증한다.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { runReorganize } = require(path.join(__dirname, '..', '..', 'scripts', 'reorganize_aa_space.js'));

function makePages() {
  return [
    { id: 'home', title: 'AA 홈', parentId: null, labels: [] },                // 스페이스 홈페이지
    { id: 'o1', title: '고아1', parentId: 'home', labels: [] },                 // 홈페이지 직속 자식(고아 → 이동 대상)
    { id: 'i1', title: '폴더안', parentId: 'folder1', labels: [] },             // 이미 폴더 안
    { id: 'f1', title: '폴더', parentId: 'home', labels: ['is-folder'] },        // 폴더 자체
    { id: 'r1', title: '리포트', parentId: 'folderX', labels: ['bot-report'] },  // 봇 생성 리포트(P6)
  ];
}

const fakeTree = { byId: {}, unsortedFolderId: 'unsorted' };
const decision = { ok: true, folderId: 'dest', folderTitle: '목적지', source: 'rule', reason: 'test-rule', labels: [] };

test('reorganize: 홈페이지(parentId=null)는 분류·이동 대상에서 제외된다', async () => {
  const classified = [];
  const moves = [];
  const result = await runReorganize({
    dryRun: false,
    pages: makePages(),
    aaTree: fakeTree,
    homePageId: 'home',
    deps: {
      classify: async (ctx) => { classified.push(ctx.pageId); return decision; },
      move: async (id, to) => { moves.push([id, to]); },
    },
  });

  assert.deepStrictEqual(classified, ['o1'], '홈페이지 직속 고아만 분류 체인에 들어가야 한다');
  assert.deepStrictEqual(moves, [['o1', 'dest']], 'o1만 이동되어야 한다');
  assert.strictEqual(result.moved.length, 1);
  assert.strictEqual(result.moved[0].page.id, 'o1');
  assert.ok(!result.degraded);
  assert.ok(result.moved.every(m => m.page.id !== 'home'), '홈페이지는 moved에 나타나면 안 된다');
});

test('reorganize: dry-run에서도 홈페이지는 moved에 기록되지 않는다', async () => {
  const result = await runReorganize({
    dryRun: true,
    pages: makePages(),
    aaTree: fakeTree,
    homePageId: 'home',
    deps: {
      classify: async () => decision,
      move: async () => { throw new Error('dry-run에서 move 호출 금지'); },
    },
  });
  assert.ok(result.moved.every(m => m.page.id !== 'home'));
  assert.strictEqual(result.moved.length, 1);
  assert.strictEqual(result.moved[0].dryRun, true);
});

test('reorganize: 홈페이지 ID 미해결(null) → 이동 전체 스킵(degraded), 분류 시도 0건', async () => {
  let classifyCalls = 0;
  const result = await runReorganize({
    dryRun: false,
    pages: makePages(),
    aaTree: fakeTree,
    homePageId: null, // 명시적 미해결 — 네트워크 폴백으로 빠지면 안 된다
    deps: {
      classify: async () => { classifyCalls++; return decision; },
      move: async () => { throw new Error('degraded에서 move 호출 금지'); },
    },
  });
  assert.strictEqual(classifyCalls, 0, '분류 체인 자체가 실행되지 않아야 한다');
  assert.deepStrictEqual(result.moved, []);
  assert.deepStrictEqual(result.failed, []);
  assert.strictEqual(result.degraded, true);
  assert.strictEqual(result.skippedCount, 5);
});

// Gap 3: human-classified 라벨이 붙은 페이지는 재이동 금지
test('reorganize: human-classified 라벨이 있으면 분류 체인 진입 없이 스킵', async () => {
  const pagesWithHuman = [
    { id: 'home', title: 'AA 홈', parentId: null, labels: [] },
    { id: 'h1', title: '휴먼결정페이지', parentId: 'home', labels: ['human-classified'] }, // 최상위지만 human-classified
    { id: 'o1', title: '일반고아', parentId: 'home', labels: [] },
  ];
  const classified = [];
  const moves = [];
  const result = await runReorganize({
    dryRun: false,
    pages: pagesWithHuman,
    aaTree: fakeTree,
    homePageId: 'home',
    deps: {
      classify: async (ctx) => { classified.push(ctx.pageId); return decision; },
      move: async (id, to) => { moves.push([id, to]); },
    },
  });
  assert.ok(!classified.includes('h1'), 'human-classified는 분류 체인 진입 금지');
  assert.deepStrictEqual(classified, ['o1']);
  assert.deepStrictEqual(moves, [['o1', 'dest']]);
  assert.strictEqual(result.skippedCount, 2); // home + h1
});

// ── Task 6: 본문 fetch + fallback 의견 코멘트 ────────────────────────────────
test('reorganize: fetchBody는 분류 후보(고아)에만 호출된다', async () => {
  const fetched = [];
  await runReorganize({
    dryRun: true,
    pages: makePages(),
    aaTree: fakeTree,
    homePageId: 'home',
    deps: {
      classify: async () => decision,
      move: async () => {},
      fetchBody: async (id) => { fetched.push(id); return 'BODY'; },
    },
  });
  assert.deepStrictEqual(fetched, ['o1'], '고아 o1만 본문 fetch — 폴더/보고서/폴더안 페이지는 안 됨');
});

test('reorganize: ctx.body에 fetch 결과가 담겨 classify에 전달된다', async () => {
  let receivedCtx = null;
  await runReorganize({
    dryRun: true,
    pages: makePages(),
    aaTree: fakeTree,
    homePageId: 'home',
    deps: {
      classify: async (ctx) => { receivedCtx = ctx; return decision; },
      move: async () => {},
      fetchBody: async () => '<p>본문HTML</p>',
    },
  });
  assert.strictEqual(receivedCtx.body, '<p>본문HTML</p>');
  assert.strictEqual(receivedCtx.currentFolderId, 'home');
});

test('reorganize: fallback+의견 이동 시 코멘트 첨부 (exec), dry-run에서는 안 함', async () => {
  const comments = [];
  const fallbackDecision = {
    ok: true, source: 'fallback', folderId: 'unsorted', folderTitle: '미분류',
    labels: ['needs-review'], reason: 'low-confidence', llmOpinion: 'DN과 Device 경합', suggestedFolderId: 'f-dn',
  };
  const opts = (dryRun) => ({
    dryRun,
    pages: makePages(),
    aaTree: fakeTree,
    homePageId: 'home',
    deps: {
      classify: async () => fallbackDecision,
      move: async () => {},
      fetchBody: async () => 'b',
      comment: async (pid, html) => { comments.push([pid, html]); },
    },
  });
  await runReorganize(opts(false));
  assert.strictEqual(comments.length, 1);
  assert.strictEqual(comments[0][0], 'o1');
  assert.ok(comments[0][1].includes('DN과 Device 경합'), '의견 본문 포함');
  assert.ok(comments[0][1].includes('f-dn'), '잠정 후보 포함');

  comments.length = 0;
  await runReorganize(opts(true));
  assert.strictEqual(comments.length, 0, 'dry-run에서는 코멘트 금지');
});

test('reorganize: fallback이어도 의견이 null이면 코멘트 없음', async () => {
  const comments = [];
  await runReorganize({
    dryRun: false,
    pages: makePages(),
    aaTree: fakeTree,
    homePageId: 'home',
    deps: {
      classify: async () => ({ ok: true, source: 'fallback', folderId: 'unsorted', labels: ['needs-review'], reason: 'llm-skipped-no-key', llmOpinion: null }),
      move: async () => {},
      fetchBody: async () => '',
      comment: async (pid, html) => { comments.push([pid, html]); },
    },
  });
  assert.strictEqual(comments.length, 0);
});

test('reorganize: fetchBody throw → 해당 페이지 failed[] 기록, 진행 계속', async () => {
  const result = await runReorganize({
    dryRun: true,
    pages: makePages(),
    aaTree: fakeTree,
    homePageId: 'home',
    deps: {
      classify: async () => decision,
      move: async () => {},
      fetchBody: async () => { throw new Error('fetch-boom'); },
    },
  });
  assert.strictEqual(result.failed.length, 1);
  assert.match(result.failed[0].error, /fetch-boom/);
});

// formatOpinionComment 단위 검증
const { formatOpinionComment } = require(path.join(__dirname, '..', '..', 'scripts', 'reorganize_aa_space.js'));
test('formatOpinionComment: 의견·후보를 이스케이프해 포함', () => {
  const html = formatOpinionComment({ llmOpinion: '<b>위험</b> & 경합', suggestedFolderId: 'f-1', reason: 'low-confidence' });
  assert.ok(html.includes('&lt;b&gt;위험&lt;/b&gt; &amp; 경합'), 'HTML 이스케이프');
  assert.ok(html.includes('f-1'));
  assert.ok(html.includes('자동 분류 보류'));
});
