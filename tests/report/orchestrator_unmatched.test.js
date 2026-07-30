// tests/report/orchestrator_unmatched.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── runUnmatchedMerge (오케스트레이터용 통합 헬퍼) ────────────────────────────
// 책임:
//   1. KB 파일 로드(JSON.parse 실패 시 empty fallback)
//   2. loadUnmatchedState(prev) — 없으면 []
//   3. computeUnmatchedItems(pages, kb, todayStr, {unsortedFolderId, prevState})
//   4. saveUnmatchedState(filePath, items) — 실패 시 saveError 문자열 반환(throw 금지)
//   5. 부록 items[]에 그대로 들어갈 수 있는 형태의 {items, saveError, kbError} 반환
//
// pages = listAAPages 결과.
// dry-run에서는 saveUnmatchedState 호출 안 함(=filePath 부재도 OK).

const {
  runUnmatchedMerge,
} = require('../../scripts/report_aa_daily');

function tmpFile(name) {
  return path.join(os.tmpdir(), `${name}-${Date.now()}-${Math.random().toString(36).slice(2,8)}.json`);
}

function writeKB(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj), 'utf8');
}

const KB_FIXTURE = {
  rules: [
    { id: 'dn_dynamic_nav', sourceSpace: 'Device',
      match: { title_patterns: ['^DN_'] } },
    { id: 'catch_all_known', sourceSpace: '*', is_catch_all: true, match: {} },
  ],
};

test('runUnmatchedMerge: KB 정상 + unsorted 부모 1건 → items=1, saveUnmatchedState에 들어감', () => {
  const kbFile = tmpFile('kb');
  const stateFile = tmpFile('unmatched');
  writeKB(kbFile, KB_FIXTURE);
  const pages = [
    { id: 'p1', title: '캘리브레이션 회의록', parentId: 'u', ancestors: [] },
  ];
  const out = runUnmatchedMerge({
    kbPath: kbFile, statePath: stateFile, pages,
    todayStr: '2026-07-30', unsortedFolderId: 'u',
  });
  assert.strictEqual(out.kbError, null);
  assert.strictEqual(out.saveError, null);
  assert.strictEqual(out.items.length, 1);
  assert.strictEqual(out.items[0].kind, 'unmatched');
  assert.strictEqual(out.items[0].titleSnapshot, '캘리브레이션 회의록');
  // SSOT에 실제 저장됐는지 확인
  const onDisk = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.strictEqual(onDisk.length, 1);
  assert.strictEqual(onDisk[0].titleSnapshot, '캘리브레이션 회의록');
});

test('runUnmatchedMerge: KB 파일 없음 → items=[], kbError=null (단순히 empty rules 취급)', () => {
  const stateFile = tmpFile('unmatched-no-kb');
  const kbFile = tmpFile('kb-missing');
  const pages = [{ id: 'p1', title: '아무거나', parentId: 'u', ancestors: [] }];
  const out = runUnmatchedMerge({
    kbPath: kbFile, statePath: stateFile, pages,
    todayStr: '2026-07-30', unsortedFolderId: 'u',
  });
  assert.deepStrictEqual(out.items, []);
  assert.strictEqual(out.kbError, null);
});

test('runUnmatchedMerge: KB 파일이 깨진 JSON → items=[], kbError=null (graceful)', () => {
  const kbFile = tmpFile('kb-bad');
  fs.writeFileSync(kbFile, '{not json', 'utf8');
  const stateFile = tmpFile('unmatched-bad-kb');
  const pages = [{ id: 'p1', title: '아무거나', parentId: 'u', ancestors: [] }];
  const out = runUnmatchedMerge({
    kbPath: kbFile, statePath: stateFile, pages,
    todayStr: '2026-07-30', unsortedFolderId: 'u',
  });
  assert.deepStrictEqual(out.items, []);
  assert.strictEqual(out.kbError, null);
});

test('runUnmatchedMerge: dryRun=true → saveUnmatchedState 호출 안 함, stateFile 부재도 OK', () => {
  const kbFile = tmpFile('kb-dry');
  writeKB(kbFile, KB_FIXTURE);
  const pages = [{ id: 'p1', title: '캘리브레이션 회의록', parentId: 'u', ancestors: [] }];
  const out = runUnmatchedMerge({
    kbPath: kbFile, statePath: '/nonexistent/should/not/be/touched.json',
    pages, todayStr: '2026-07-30', unsortedFolderId: 'u',
    dryRun: true,
  });
  assert.strictEqual(out.items.length, 1);
  assert.strictEqual(out.saveError, null);
  assert.ok(!fs.existsSync('/nonexistent/should/not/be/touched.json'),
    'dry-run은 디스크에 쓰지 않아야 함');
});

test('runUnmatchedMerge: prevState 머지 — 두 번째 호출에서 seenCount 증가, firstSeen 보존', () => {
  const kbFile = tmpFile('kb-merge');
  const stateFile = tmpFile('unmatched-merge');
  writeKB(kbFile, KB_FIXTURE);
  const pages = [{ id: 'p1', title: '캘리브레이션 회의록', parentId: 'u', ancestors: [] }];

  // 1차
  const r1 = runUnmatchedMerge({
    kbPath: kbFile, statePath: stateFile, pages,
    todayStr: '2026-07-29', unsortedFolderId: 'u',
  });
  assert.strictEqual(r1.items[0].seenCount, 1);
  assert.strictEqual(r1.items[0].firstSeen, '2026-07-29');

  // 2차
  const r2 = runUnmatchedMerge({
    kbPath: kbFile, statePath: stateFile, pages,
    todayStr: '2026-07-30', unsortedFolderId: 'u',
  });
  assert.strictEqual(r2.items[0].seenCount, 2);
  assert.strictEqual(r2.items[0].firstSeen, '2026-07-29');
  assert.strictEqual(r2.items[0].lastSeen, '2026-07-30');
});

test('runUnmatchedMerge: unsortedFolderId 미존재(부모 불일치) → items=[]', () => {
  const kbFile = tmpFile('kb-no-target');
  writeKB(kbFile, KB_FIXTURE);
  const stateFile = tmpFile('unmatched-no-target');
  const pages = [{ id: 'p1', title: '아무거나', parentId: 'different', ancestors: [] }];
  const out = runUnmatchedMerge({
    kbPath: kbFile, statePath: stateFile, pages,
    todayStr: '2026-07-30', unsortedFolderId: 'u',
  });
  assert.deepStrictEqual(out.items, []);
});