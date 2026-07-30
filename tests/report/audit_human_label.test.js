// tests/report/audit_human_label.test.js
// Gap 3: runAudit가 휴먼 이동 감지 시 commitDecision 호출 + human-classified 라벨 부착.
// deps 주입으로 디스크·네트워크 완전 차단.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { runAudit } = require(path.join(__dirname, '..', '..', 'scripts', 'audit_aa_space.js'));

const fakeTree = {
  unsortedFolderId: 'unsorted',
  flat: [{ id: 'f1', title: '기술문서' }],
  tree: {},
  toText: () => '',
  hasFolder: () => true,
};

test('audit: 휴먼 이동 감지 시 commitDecision + addLabels(human-classified) 호출', async () => {
  // 페이지: 이전 parent=111 → 현재 parent=222 (이동 발생)
  // 그리고 rule이 이 페이지를 모르거나(rule miss) 또는 rule과 다른 폴더로 이동한 경우
  const pages = [
    {
      id: 'p1',
      title: '휴먼이 옮긴 페이지',
      parentId: '222',
      labels: ['last-parent-111'], // 이전 parent=111, 현재=222 → 이동 감지
    },
  ];

  const commitCalls = [];
  const labelCalls = [];
  const stampCalls = [];

  const result = await runAudit({
    dryRun: false,
    pages,
    aaTree: fakeTree,
    homePageId: 'home-id',
    deps: {
      commitDecision: (page, move) => {
        commitCalls.push({ pageId: page.id, to: move.to });
      },
      addLabels: async (pageId, labels) => {
        labelCalls.push({ pageId, labels });
      },
      deleteLabel: async () => {},
      postLabel: async (pid, name) => { stampCalls.push([pid, name]); },
    },
  });

  // commitDecision 호출됨
  assert.strictEqual(commitCalls.length, 1);
  assert.strictEqual(commitCalls[0].pageId, 'p1');
  assert.strictEqual(commitCalls[0].to, '222');

  // addLabels 호출됨 — human-classified
  assert.strictEqual(labelCalls.length, 1);
  assert.strictEqual(labelCalls[0].pageId, 'p1');
  assert.deepStrictEqual(labelCalls[0].labels, ['human-classified']);

  // humanMoves에 기록됨
  assert.strictEqual(result.humanMoves.length, 1);
  assert.strictEqual(result.humanMoves[0].page.id, 'p1');
  assert.strictEqual(result.humanMoves[0].committed, true);
});

test('audit: 이동 없으면 commitDecision/addLabels 호출 안됨', async () => {
  const pages = [
    {
      id: 'p1',
      title: '그대로 있는 페이지',
      parentId: '222',
      labels: ['last-parent-222'], // 이전=현재 → 이동 없음
    },
  ];

  const commitCalls = [];
  const labelCalls = [];

  await runAudit({
    dryRun: false,
    pages,
    aaTree: fakeTree,
    homePageId: 'home-id',
    deps: {
      commitDecision: (page, move) => { commitCalls.push({ pageId: page.id }); },
      addLabels: async (pageId, labels) => { labelCalls.push({ pageId }); },
      deleteLabel: async () => {},
      postLabel: async () => {},
    },
  });

  assert.strictEqual(commitCalls.length, 0);
  assert.strictEqual(labelCalls.length, 0);
});

test('audit: dryRun이면 commitDecision/addLabels 호출 안됨 (stampLastParent는 실행)', async () => {
  const pages = [
    {
      id: 'p1',
      title: '휴먼이동',
      parentId: '222',
      labels: ['last-parent-111'],
    },
  ];

  const commitCalls = [];
  const labelCalls = [];
  const stampCalls = [];

  await runAudit({
    dryRun: true,
    pages,
    aaTree: fakeTree,
    homePageId: 'home-id',
    deps: {
      commitDecision: () => { commitCalls.push(1); },
      addLabels: async () => { labelCalls.push(1); },
      deleteLabel: async () => {},
      postLabel: async (pid, name) => { stampCalls.push([pid, name]); },
    },
  });

  // dryRun에서는 commitDecision/addLabels 금지
  assert.strictEqual(commitCalls.length, 0, 'dryRun에서 commitDecision 금지');
  assert.strictEqual(labelCalls.length, 0, 'dryRun에서 addLabels 금지');
  // stampLastParent는 dryRun에서도 실행되어야 함 (CI에서도 라벨 갱신 필요)
  assert.ok(stampCalls.length > 0, 'stampLastParent는 dryRun에서도 실행');
});
