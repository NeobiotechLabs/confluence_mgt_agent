'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  loadDroppedCache,
  saveDroppedCache,
  consultDroppedCache,
  mergeDroppedCache,
  shouldReevaluate,
  hashFor,
} = require('../../scripts/migrator/dropped_cache');

// ── loadDroppedCache ─────────────────────────────────────────────────────
test('loadDroppedCache: 파일 부재 → []', () => {
  const file = path.join(os.tmpdir(), `dropped-missing-${Date.now()}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  assert.deepStrictEqual(loadDroppedCache(file), []);
});

test('loadDroppedCache: 깨진 JSON → []', () => {
  const file = path.join(os.tmpdir(), `dropped-bad-${Date.now()}.json`);
  fs.writeFileSync(file, '{not json', 'utf8');
  assert.deepStrictEqual(loadDroppedCache(file), []);
});

test('loadDroppedCache: 객체이지만 배열 아님 → []', () => {
  const file = path.join(os.tmpdir(), `dropped-obj-${Date.now()}.json`);
  fs.writeFileSync(file, '{"foo": 1}', 'utf8');
  assert.deepStrictEqual(loadDroppedCache(file), []);
});

test('loadDroppedCache: pageId 없는 항목은 skip', () => {
  const file = path.join(os.tmpdir(), `dropped-schema-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify([{ pageId: '1' }, { foo: 1 }, null]), 'utf8');
  const out = loadDroppedCache(file);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].pageId, '1');
});

// ── saveDroppedCache ─────────────────────────────────────────────────────
test('saveDroppedCache: 원자적 쓰기 + 부모 디렉터리 자동 생성', () => {
  const dir = path.join(os.tmpdir(), `dropped-dir-${Date.now()}`);
  const file = path.join(dir, 'sub', 'dropped.json');
  saveDroppedCache(file, [{ pageId: '1', hash: 'h', reason: 'r', firstSeen: '2026-08-01', lastSeen: '2026-08-01', nextReevalAt: '2026-08-08' }]);
  assert.ok(fs.existsSync(file));
  const loaded = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(loaded.length, 1);
  assert.strictEqual(loaded[0].pageId, '1');
  // .tmp 잔존 없음
  assert.ok(!fs.existsSync(file + '.tmp'));
});

// ── shouldReevaluate ────────────────────────────────────────────────────
test('shouldReevaluate: nextReevalAt <= today → true', () => {
  assert.strictEqual(shouldReevaluate({ nextReevalAt: '2026-08-02' }, '2026-08-02'), true);
  assert.strictEqual(shouldReevaluate({ nextReevalAt: '2026-08-01' }, '2026-08-02'), true);
});

test('shouldReevaluate: nextReevalAt > today → false', () => {
  assert.strictEqual(shouldReevaluate({ nextReevalAt: '2026-08-09' }, '2026-08-02'), false);
});

// ── consultDroppedCache ─────────────────────────────────────────────────
test('consultDroppedCache: 캐시 미스 → {cached:false, reevaluate:false}', () => {
  const r = consultDroppedCache('p1', 'h1', '2026-08-02', []);
  assert.deepStrictEqual(r, { cached: false, reevaluate: false });
});

test('consultDroppedCache: 캐시 적중 + 재평가 미도래 → cached, !reevaluate', () => {
  const cache = [{ pageId: 'p1', hash: 'h1', nextReevalAt: '2026-08-09' }];
  const r = consultDroppedCache('p1', 'h1', '2026-08-02', cache);
  assert.strictEqual(r.cached, true);
  assert.strictEqual(r.reevaluate, false);
  assert.strictEqual(r.entry.pageId, 'p1');
});

test('consultDroppedCache: 캐시 적중 + 재평가 도래 → cached, reevaluate', () => {
  const cache = [{ pageId: 'p1', hash: 'h1', nextReevalAt: '2026-08-01' }];
  const r = consultDroppedCache('p1', 'h1', '2026-08-02', cache);
  assert.strictEqual(r.cached, true);
  assert.strictEqual(r.reevaluate, true);
});

// ── mergeDroppedCache ───────────────────────────────────────────────────
test('mergeDroppedCache: 새 항목 upsert', () => {
  const out = mergeDroppedCache([], [{ pageId: 'p1', hash: 'h1', reason: 'r', firstSeen: '2026-08-02', lastSeen: '2026-08-02', nextReevalAt: '2026-08-09' }]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].pageId, 'p1');
});

test('mergeDroppedCache: 기존 항목 lastSeen + nextReevalAt 갱신, firstSeen 유지', () => {
  const cache = [{ pageId: 'p1', hash: 'h1', reason: 'r', firstSeen: '2026-07-20', lastSeen: '2026-07-20', nextReevalAt: '2026-07-27' }];
  const out = mergeDroppedCache(cache, [{ pageId: 'p1', hash: 'h1', reason: 'r2', firstSeen: '2026-07-20', lastSeen: '2026-08-02', nextReevalAt: '2026-08-09' }]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].firstSeen, '2026-07-20');
  assert.strictEqual(out[0].lastSeen, '2026-08-02');
  assert.strictEqual(out[0].reason, 'r2');
});

test('mergeDroppedCache: {remove:true} → 제거', () => {
  const cache = [{ pageId: 'p1', hash: 'h1' }, { pageId: 'p2', hash: 'h2' }];
  const out = mergeDroppedCache(cache, [{ remove: true, pageId: 'p1', hash: 'h1' }]);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].pageId, 'p2');
});

// ── hashFor ─────────────────────────────────────────────────────────────
test('hashFor: 동일 입력 → 동일 hash', () => {
  const a = hashFor({ id: '1', title: 'T', body: 'B' });
  const b = hashFor({ id: '1', title: 'T', body: 'B' });
  assert.strictEqual(a, b);
  assert.strictEqual(a.length, 16);
});

test('hashFor: 다른 body → 다른 hash', () => {
  const a = hashFor({ id: '1', title: 'T', body: 'B1' });
  const b = hashFor({ id: '1', title: 'T', body: 'B2' });
  assert.notStrictEqual(a, b);
});
