// tests/report/unmatched_state_io.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  loadUnmatchedState,
  saveUnmatchedState,
} = require('../../scripts/report/unmatched_state_io');

// ── loadUnmatchedState ──────────────────────────────────────────────────────
// reference/unmatched_pages.json SSOT. 없음/깨짐/스키마 위반은 모두 []로 우아 퇴화.
test('loadUnmatchedState: 파일 부재 → []', () => {
  const file = path.join(os.tmpdir(), `unmatched-missing-${Date.now()}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  const out = loadUnmatchedState(file);
  assert.deepStrictEqual(out, []);
});

test('loadUnmatchedState: 빈 배열 파일 → []', () => {
  const file = path.join(os.tmpdir(), `unmatched-empty-${Date.now()}.json`);
  fs.writeFileSync(file, '[]', 'utf8');
  const out = loadUnmatchedState(file);
  assert.deepStrictEqual(out, []);
});

test('loadUnmatchedState: 깨진 JSON → [] (크래시 없이 우아 퇴화)', () => {
  const file = path.join(os.tmpdir(), `unmatched-bad-${Date.now()}.json`);
  fs.writeFileSync(file, '{not json', 'utf8');
  const out = loadUnmatchedState(file);
  assert.deepStrictEqual(out, []);
});

test('loadUnmatchedState: 객체이지만 배열 아님 → []', () => {
  const file = path.join(os.tmpdir(), `unmatched-obj-${Date.now()}.json`);
  fs.writeFileSync(file, '{"foo": 1}', 'utf8');
  const out = loadUnmatchedState(file);
  assert.deepStrictEqual(out, []);
});

test('loadUnmatchedState: 유효 항목 → 그대로 디시리얼라이즈', () => {
  const file = path.join(os.tmpdir(), `unmatched-ok-${Date.now()}.json`);
  const seed = [
    { fingerprint: 'fp1', title: 'A', seenCount: 3, firstSeen: '2026-07-20', lastSeen: '2026-07-30' },
  ];
  fs.writeFileSync(file, JSON.stringify(seed), 'utf8');
  const out = loadUnmatchedState(file);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].fingerprint, 'fp1');
  assert.strictEqual(out[0].seenCount, 3);
});

// ── saveUnmatchedState ──────────────────────────────────────────────────────
// 원자적 덮어쓰기. 호출자 책임으로 mkdir -p.
test('saveUnmatchedState: 빈 배열 저장 → 파일은 []', () => {
  const file = path.join(os.tmpdir(), `unmatched-save-empty-${Date.now()}.json`);
  saveUnmatchedState(file, []);
  const txt = fs.readFileSync(file, 'utf8');
  assert.strictEqual(txt, '[]');
});

test('saveUnmatchedState: 항목 저장 후 다시 load하면 같은 값', () => {
  const file = path.join(os.tmpdir(), `unmatched-save-rt-${Date.now()}.json`);
  const items = [
    { fingerprint: 'fp1', title: 'A', seenCount: 2, firstSeen: '2026-07-20', lastSeen: '2026-07-30' },
    { fingerprint: 'fp2', title: 'B', seenCount: 1, firstSeen: '2026-07-30', lastSeen: '2026-07-30' },
  ];
  saveUnmatchedState(file, items);
  const back = loadUnmatchedState(file);
  assert.strictEqual(back.length, 2);
  assert.strictEqual(back[0].fingerprint, 'fp1');
  assert.strictEqual(back[1].seenCount, 1);
});

test('saveUnmatchedState: UTF-8 한글 안전', () => {
  const file = path.join(os.tmpdir(), `unmatched-save-utf8-${Date.now()}.json`);
  const items = [{ fingerprint: 'fp1', title: '캘리브레이션 회의록' }];
  saveUnmatchedState(file, items);
  const back = loadUnmatchedState(file);
  assert.strictEqual(back[0].title, '캘리브레이션 회의록');
});
