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
